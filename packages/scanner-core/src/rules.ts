import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import type {
  CheckResult,
  Finding,
  ReportEvidence,
  ReportLocation,
  ReportLimitation,
  RuleId,
  Severity,
} from '../../report-contract/src/index';
import { RULE_DEFINITIONS } from '../../report-contract/src/index';
import { isEnvironmentFilename, isEnvironmentTemplateFilename } from './git';
import { analyzeSources } from './ast';
import type { GitInspection, PackageData, ProjectDetection, WalkResult, SourceAnalysis } from './types';

const require = createRequire(import.meta.url);
const semver = require('semver') as {
  validRange(value: string): string | null;
  intersects(left: string, right: string, options?: { includePrerelease?: boolean }): boolean;
};

const definitionById = new Map(RULE_DEFINITIONS.map((definition) => [definition.id, definition]));

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export function findingFingerprint(
  ruleId: RuleId,
  location: ReportLocation | undefined,
  evidence: ReportEvidence,
): string {
  // Line and column are deliberately excluded so a manual edit that moves a
  // finding does not manufacture a new identity. File and JSON-pointer context
  // remain useful for distinguishing repeated evidence in different inputs.
  const stableLocation = location
    ? { path: location.path, ...(location.jsonPointer ? { jsonPointer: location.jsonPointer } : {}) }
    : null;
  const input = `${ruleId}|${stableJson(stableLocation)}|${stableJson(evidence)}`;
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

function cleanLocation(path: string, values?: Partial<ReportLocation>): ReportLocation {
  const location: ReportLocation = { path };
  for (const key of ['line', 'column', 'endLine', 'endColumn', 'jsonPointer'] as const) {
    const value = values?.[key];
    if (value !== undefined) (location as unknown as Record<string, unknown>)[key] = value;
  }
  return location;
}

interface FindingInput {
  ruleId: RuleId;
  severity?: Severity;
  title?: string;
  message: string;
  location?: ReportLocation;
  evidence: ReportEvidence;
  explanation: string;
  nextSteps: string[];
}

function makeFinding(input: FindingInput): Finding {
  const severity = input.severity ?? definitionById.get(input.ruleId)?.defaultSeverity ?? 'warning';
  return {
    fingerprint: findingFingerprint(input.ruleId, input.location, input.evidence),
    ruleId: input.ruleId,
    severity,
    title: input.title ?? definitionById.get(input.ruleId)?.title ?? input.ruleId,
    message: input.message,
    ...(input.location ? { location: input.location } : {}),
    evidence: input.evidence,
    explanation: input.explanation,
    nextSteps: input.nextSteps,
  };
}

function check(
  ruleId: RuleId,
  status: CheckResult['status'],
  findings: Finding[] = [],
  extra: Partial<Pick<CheckResult, 'evaluatedInputs' | 'evidence' | 'limitations'>> = {},
): CheckResult {
  const definition = definitionById.get(ruleId)!;
  return {
    ruleId,
    title: definition.title,
    status,
    severity: definition.defaultSeverity,
    findings,
    ...extra,
  };
}

function notChecked(ruleId: RuleId, reason: string, path?: string): CheckResult {
  const limitation: ReportLimitation = { reason, ...(path ? { path } : {}) };
  return check(ruleId, 'not_checked', [], { limitations: [limitation] });
}

export function notApplicableChecks(): CheckResult[] {
  return RULE_DEFINITIONS.map((definition) => check(definition.id, 'not_applicable'));
}

function packageLocation(jsonPointer: string): ReportLocation {
  return cleanLocation('package.json', { jsonPointer });
}

export function runBuildScriptRule(packageData?: PackageData): CheckResult {
  const ruleId = 'package.build-script';
  if (!packageData) return notChecked(ruleId, 'package-json-unavailable', 'package.json');
  const script = packageData.scripts?.build;
  if (typeof script === 'string' && script.trim()) {
    return check(ruleId, 'passed', [], {
      evaluatedInputs: ['package.json'],
      evidence: { kind: 'build-script', present: true },
    });
  }
  const finding = makeFinding({
    ruleId,
    message: 'package.json does not declare a non-empty build script.',
    location: packageLocation('/scripts/build'),
    evidence: { kind: 'missing-build-script', key: 'build' },
    explanation: 'A deployment adapter needs an explicit build entry point to produce the Vite artifact.',
    nextSteps: ['Add a package.json scripts.build command such as "vite build".'],
  });
  return check(ruleId, 'finding', [finding], { evaluatedInputs: ['package.json'] });
}

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const LOCKFILE_MANAGERS: Record<string, string> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
};

function declaredPackageManager(packageData?: PackageData): string | undefined {
  if (typeof packageData?.packageManager !== 'string') return undefined;
  const match = packageData.packageManager.trim().match(/^([^@\s]+)(?:@|$)/);
  return match?.[1];
}

export function runLockfileRule(walk: WalkResult, packageData?: PackageData): CheckResult {
  const found = LOCKFILES.filter((path) => walk.files.has(path));
  const skipped = LOCKFILES.filter((path) => walk.skippedFiles.some((file) => file.path === path));
  if (skipped.length) {
    return check('package.lockfiles', 'not_checked', [], {
      evaluatedInputs: skipped,
      limitations: skipped.map((path) => ({ reason: 'lockfile-skipped', path })),
    });
  }

  const declared = declaredPackageManager(packageData);
  const findings: Finding[] = [];
  if (found.length === 0) {
    findings.push(makeFinding({
      ruleId: 'package.lockfiles',
      message: 'No supported dependency lockfile was found at the project root.',
      evidence: { kind: 'missing-lockfile', supported: LOCKFILES },
      explanation: 'A committed lockfile makes dependency resolution reproducible in deployment environments.',
      nextSteps: ['Commit the lockfile generated by the package manager used by this project.'],
    }));
  } else if (found.length > 1) {
    findings.push(makeFinding({
      ruleId: 'package.lockfiles',
      severity: 'error',
      message: `Multiple package-manager lockfiles were found: ${found.join(', ')}.`,
      evidence: { kind: 'conflicting-lockfiles', files: found },
      explanation: 'Competing lockfiles make it unclear which dependency graph a clean deployment should install.',
      nextSteps: ['Choose one package manager, remove unrelated lockfiles, and commit only the selected lockfile.'],
    }));
  }
  if (declared && found.length === 1 && LOCKFILE_MANAGERS[found[0]] !== declared) {
    findings.push(makeFinding({
      ruleId: 'package.lockfiles',
      severity: 'warning',
      message: `package.json declares ${declared}, but the lockfile belongs to ${LOCKFILE_MANAGERS[found[0]]}.`,
      evidence: { kind: 'package-manager-mismatch', declared, lockfile: found[0] },
      explanation: 'The package-manager declaration and lockfile should describe the same installation workflow.',
      nextSteps: ['Align package.json.packageManager with the lockfile you intend to use.'],
    }));
  }
  return check('package.lockfiles', findings.length ? 'finding' : 'passed', findings, {
    evaluatedInputs: [...found, ...(declared ? ['package.json#packageManager'] : [])],
    evidence: { kind: 'lockfiles', files: found, ...(declared ? { declaredPackageManager: declared } : {}) },
  });
}

interface NodeDeclaration {
  source: string;
  value: string;
  range: string;
}

function addNodeDeclaration(declarations: NodeDeclaration[], source: string, value: unknown): void {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return;
  const trimmed = String(value).trim().replace(/^v(?=\d)/i, '');
  const range = semver.validRange(trimmed);
  if (range) declarations.push({ source, value: trimmed, range });
  else declarations.push({ source, value: trimmed, range: '' });
}

function addDockerNodeDeclarations(declarations: NodeDeclaration[], walk: WalkResult): void {
  const dockerfile = walk.files.get('Dockerfile')?.text;
  if (dockerfile === undefined) return;
  for (const line of dockerfile.split(/\r?\n/)) {
    const match = line.match(/^\s*FROM\s+node:([^\s]+)(?:\s|$)/i);
    if (!match) continue;
    const tag = match[1];
    // Common Docker tags such as node:22-slim identify a major line even
    // though the suffix itself is not semver syntax.
    const normalized = tag.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
    addNodeDeclaration(
      declarations,
      'Dockerfile#FROM node',
      normalized ? (normalized[2] ? tag.replace(/-.*/, '') : `${normalized[1]}.x`) : tag,
    );
  }
}

function collectNodeDeclarations(walk: WalkResult, packageData?: PackageData): NodeDeclaration[] {
  const declarations: NodeDeclaration[] = [];
  addNodeDeclaration(declarations, 'package.json#/engines/node', packageData?.engines?.node);
  addNodeDeclaration(declarations, 'package.json#/volta/node', packageData?.volta?.node);
  for (const path of ['.nvmrc', '.node-version']) {
    const text = walk.files.get(path)?.text;
    if (text !== undefined) addNodeDeclaration(declarations, path, text.split(/\r?\n/, 1)[0]?.split('#', 1)[0]?.trim());
  }
  const toolVersions = walk.files.get('.tool-versions')?.text;
  if (toolVersions !== undefined) {
    const line = toolVersions.split(/\r?\n/).find((value) => /^\s*node(?:js)?\s+\S+/.test(value));
    if (line) addNodeDeclaration(declarations, '.tool-versions', line.trim().split(/\s+/, 2)[1]);
  }
  addDockerNodeDeclarations(declarations, walk);
  return declarations;
}

export function runNodeVersionRule(walk: WalkResult, packageData?: PackageData): CheckResult {
  const declarationPaths = new Set(['.nvmrc', '.node-version', '.tool-versions', 'package.json', 'Dockerfile']);
  const skippedDeclarations = walk.skippedFiles.filter((file) => declarationPaths.has(file.path));
  if (skippedDeclarations.length) {
    return check('runtime.node-version', 'not_checked', [], {
      evaluatedInputs: skippedDeclarations.map((file) => file.path),
      limitations: skippedDeclarations.map((file) => ({ reason: 'node-declaration-skipped', path: file.path })),
    });
  }
  const declarations = collectNodeDeclarations(walk, packageData);
  const evaluatedInputs = declarations.map((declaration) => declaration.source).sort();
  if (!declarations.length) {
    const finding = makeFinding({
      ruleId: 'runtime.node-version',
      message: 'No supported Node version declaration was found.',
       evidence: { kind: 'missing-node-declaration', supported: ['package.json#/engines/node', '.nvmrc', '.node-version', '.tool-versions', 'Dockerfile#FROM node'] },
      explanation: 'Declaring the Node runtime prevents a deployment from silently selecting an incompatible version.',
      nextSteps: ['Declare a compatible Node range in package.json engines.node or commit a Node version file.'],
    });
    return check('runtime.node-version', 'finding', [finding], { evaluatedInputs });
  }

  const invalid = declarations.filter((declaration) => !declaration.range);
  const findings: Finding[] = invalid.map((declaration) => makeFinding({
    ruleId: 'runtime.node-version',
    message: `The Node declaration in ${declaration.source} is not a valid semver range.`,
    evidence: { kind: 'invalid-node-range', source: declaration.source },
    explanation: 'Deployment tooling cannot reliably compare an invalid Node version declaration.',
    nextSteps: ['Use a semver range or a concrete Node version such as 22.19.0.'],
  }));

  const valid = declarations.filter((declaration) => declaration.range);
  let compatible = true;
  for (let index = 0; index < valid.length && compatible; index += 1) {
    for (let other = index + 1; other < valid.length; other += 1) {
      try {
        if (!semver.intersects(valid[index].range, valid[other].range, { includePrerelease: true })) {
          compatible = false;
          break;
        }
      } catch {
        compatible = false;
        break;
      }
    }
  }
  if (!compatible) {
    findings.push(makeFinding({
      ruleId: 'runtime.node-version',
      message: 'The declared Node version ranges do not overlap.',
      evidence: { kind: 'incompatible-node-ranges', declarations: valid.map(({ source, value }) => ({ source, value })) },
      explanation: 'Different deployment and local-runtime declarations could select incompatible Node versions.',
      nextSteps: ['Update the Node declarations so all declared ranges share at least one supported version.'],
    }));
  }
  return check('runtime.node-version', findings.length ? 'finding' : 'passed', findings, {
    evaluatedInputs,
    evidence: { kind: 'node-declarations', sources: declarations.map(({ source }) => source).sort() },
  });
}

function templateNames(walk: WalkResult): { names: Set<string>; paths: string[] } {
  const names = new Set<string>();
  const paths: string[] = [];
  for (const [path, file] of walk.files) {
    if (!isEnvironmentTemplateFilename(path)) continue;
    paths.push(path);
    for (const line of file.text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(VITE_[A-Za-z0-9_]+)\s*(?:=|$)/);
      if (match) names.add(match[1]);
    }
  }
  return { names, paths: paths.sort() };
}

export function runViteEnvRule(walk: WalkResult, analysis: SourceAnalysis = analyzeSources(walk)): CheckResult {
  const templates = templateNames(walk);
  const usedNames = [...new Set(analysis.envNames.map((entry) => entry.name))].sort();
  const missing = usedNames.filter((name) => !templates.names.has(name));
  const findings = missing.map((name) => {
    const usage = analysis.envNames.find((entry) => entry.name === name)!;
    return makeFinding({
      ruleId: 'source.vite-env',
      message: `The Vite environment name ${name} is used in source but absent from an environment template.`,
      location: cleanLocation(usage.path, usage),
      evidence: { kind: 'missing-vite-env', name },
      explanation: 'Vite only exposes explicitly prefixed variables, and a template documents the names deployment must provide.',
      nextSteps: [`Add ${name}= to a committed .env.example, .env.sample, or .env.template file.`],
    });
  });
  const limitations = analysis.limitations;
  const status: CheckResult['status'] = findings.length
    ? 'finding'
    : analysis.sourceFiles.length === 0
      ? 'not_applicable'
      : analysis.parsedFiles.length === 0 && limitations.length > 0
        ? 'not_checked'
        : usedNames.length === 0
          ? (limitations.length ? 'not_checked' : 'not_applicable')
          : limitations.length
            ? 'not_checked'
            : 'passed';
  return check('source.vite-env', status, findings, {
    evaluatedInputs: [...analysis.parsedFiles, ...templates.paths].sort(),
    evidence: { kind: 'vite-env-usage', usedNames, templateNames: [...templates.names].sort() },
    ...(limitations.length ? { limitations } : {}),
  });
}

export function runLocalhostRule(walk: WalkResult, analysis: SourceAnalysis = analyzeSources(walk)): CheckResult {
  const findings = analysis.loopbackUrls.map((url) => makeFinding({
    ruleId: 'source.localhost-url',
    message: `A literal loopback URL (${url.host}${url.port ? `:${url.port}` : ''}) is present in source.`,
    location: cleanLocation(url.path, url),
    evidence: { kind: 'loopback-url', host: url.host, ...(url.port ? { port: url.port } : {}), protocol: url.protocol },
    explanation: 'A loopback endpoint works on a developer machine but is usually unreachable from a deployed browser or service.',
    nextSteps: ['Replace the literal loopback URL with a deployment-configured environment value.'],
  }));
  const limitations = analysis.limitations;
  const status: CheckResult['status'] = findings.length
    ? 'finding'
    : analysis.sourceFiles.length === 0
      ? 'not_applicable'
      : analysis.parsedFiles.length === 0 && limitations.length > 0
        ? 'not_checked'
        : limitations.length
          ? 'not_checked'
          : 'passed';
  return check('source.localhost-url', status, findings, {
    evaluatedInputs: analysis.parsedFiles,
    evidence: { kind: 'loopback-url-scan', filesScanned: analysis.parsedFiles.length },
    ...(limitations.length ? { limitations } : {}),
  });
}

export function runTrackedEnvRule(git: GitInspection): CheckResult {
  if (!git.available) {
    return check('git.tracked-env', 'not_checked', [], {
      evidence: { kind: 'git-unavailable' },
      limitations: git.limitations.length > 0
        ? git.limitations
        : [{ reason: git.repository ? 'git-inspection-unavailable' : 'not-a-git-repository' }],
    });
  }
  const tracked = git.trackedFiles.filter(isEnvironmentFilename);
  const findings = tracked.map((path) => makeFinding({
    ruleId: 'git.tracked-env',
    severity: 'error',
    message: `A non-template environment file is tracked by Git: ${path}.`,
    location: cleanLocation(path),
    evidence: { kind: 'tracked-environment-file', path },
    explanation: 'Tracked environment files commonly contain deployment secrets and are not suitable for a source repository.',
    nextSteps: [`Remove ${path} from Git tracking and provide a committed template with placeholder names instead.`],
  }));
  return check('git.tracked-env', findings.length ? 'finding' : 'passed', findings, {
    evaluatedInputs: git.trackedFiles,
    evidence: { kind: 'git-tracked-filenames', filesInspected: git.trackedFiles.length },
    ...(git.limitations.length ? { limitations: git.limitations } : {}),
  });
}

export async function runRules(
  walk: WalkResult,
  detection: ProjectDetection,
  git: GitInspection,
): Promise<CheckResult[]> {
  const analysis = analyzeSources(walk);
  return [
    runBuildScriptRule(detection.packageData),
    runLockfileRule(walk, detection.packageData),
    runNodeVersionRule(walk, detection.packageData),
    runViteEnvRule(walk, analysis),
    runLocalhostRule(walk, analysis),
    runTrackedEnvRule(git),
  ];
}

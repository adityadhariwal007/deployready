import type { Finding, ScanReport } from '../../../packages/report-contract/src';

const lockfileFinding: Finding = {
  fingerprint: 'sample-lockfile',
  ruleId: 'package.lockfiles',
  severity: 'warning',
  title: 'No dependency lockfile found',
  message: 'The project does not include a package-lock, pnpm-lock, or yarn lockfile.',
  location: { path: 'package.json', jsonPointer: '/scripts' },
  evidence: { kind: 'package-json', observed: 'no lockfile in project root' },
  explanation: 'A lockfile records the exact dependency graph used during installation. Without one, two builds can resolve different versions.',
  nextSteps: ['Create a lockfile with the package manager used by the project.', 'Commit the lockfile alongside package.json.'],
};

const envTemplateFinding: Finding = {
  fingerprint: 'sample-env-template',
  ruleId: 'source.vite-env',
  severity: 'warning',
  title: 'Environment template is incomplete',
  message: 'A referenced VITE_API_URL is not documented in the environment template.',
  location: { path: '.env.example', line: 3 },
  evidence: { kind: 'source-snippet', path: 'src/config.ts', line: 8, snippet: 'import.meta.env.VITE_API_URL (value omitted)' },
  explanation: 'A template helps deployment operators configure required public variables without exposing secret values.',
  nextSteps: ['Document VITE_API_URL in .env.example.', 'Keep credentials out of templates and source control.'],
};

const sampleReport: ScanReport = {
  schemaVersion: '1.0',
  reportType: 'deployready.scan',
  reportId: 'sample-after-2026-01',
  scanner: {
    name: 'DeployReady',
    version: '0.1.0',
    rulesetVersion: '1.0',
    runtime: 'node 22.19.0',
    generatedAt: '2026-01-15T10:30:00.000Z',
    durationMs: 184,
  },
  project: { kind: 'vite-react', label: 'Acme storefront · synthetic sample', identity: 'acme-storefront-sample' },
  summary: {
    findingCount: 2,
    bySeverity: { error: 0, warning: 2, info: 0 },
    byStatus: { passed: 3, finding: 2, not_checked: 1, not_applicable: 0 },
    partial: true,
  },
  checks: [
    { ruleId: 'package.build-script', title: 'Build script', status: 'passed', severity: 'error', findings: [], evaluatedInputs: ['package.json'], evidence: { kind: 'package-json', script: 'build' } },
    { ruleId: 'package.lockfiles', title: 'Dependency lockfile', status: 'finding', severity: 'warning', findings: [lockfileFinding], evaluatedInputs: ['package.json'] },
    { ruleId: 'runtime.node-version', title: 'Node version declaration', status: 'passed', severity: 'warning', findings: [], evaluatedInputs: ['.nvmrc', 'package.json'], evidence: { kind: 'version-file', path: '.nvmrc', value: '22.19.0' } },
    { ruleId: 'source.vite-env', title: 'Vite environment template', status: 'finding', severity: 'warning', findings: [envTemplateFinding], evaluatedInputs: ['src/config.ts', '.env.example'] },
    { ruleId: 'source.localhost-url', title: 'Localhost URL', status: 'not_checked', severity: 'warning', findings: [], evaluatedInputs: [], limitations: [{ reason: 'No source files were supplied for this synthetic sample.', path: 'src/' }] },
    { ruleId: 'git.tracked-env', title: 'Tracked environment file', status: 'passed', severity: 'error', findings: [], evaluatedInputs: ['.gitignore'], evidence: { kind: 'gitignore', path: '.env' } },
  ],
  coverage: {
    checksTotal: 6,
    checksEvaluated: 5,
    checksNotChecked: 1,
    filesConsidered: 7,
    skippedFiles: [],
    limits: { maxFileBytes: 500000, maxFiles: 1000, maxTotalBytes: 5000000 },
  },
  limitations: [{ reason: 'The Localhost URL check was not evaluated because this synthetic sample has no source files under src/.', path: 'src/' }],
};

const baselineBuildFinding: Finding = {
  fingerprint: 'sample-build-script',
  ruleId: 'package.build-script',
  severity: 'error',
  title: 'Build script is missing',
  message: 'package.json does not define a build script.',
  location: { path: 'package.json', jsonPointer: '/scripts/build' },
  evidence: { kind: 'package-json', field: 'scripts.build', observed: 'missing' },
  explanation: 'A reproducible build command is the handoff between a project and its deployment environment.',
  nextSteps: ['Add a build script that produces the production artifact.', 'Run the command in CI before deployment.'],
};

const baselineTrackedEnvFinding: Finding = {
  fingerprint: 'sample-tracked-env',
  ruleId: 'git.tracked-env',
  severity: 'error',
  title: 'Environment file may be tracked',
  message: 'The ignore rules do not cover the environment file pattern.',
  location: { path: '.gitignore' },
  evidence: { kind: 'gitignore', expected: '.env', observed: 'not present' },
  explanation: 'Ignoring local environment files reduces the chance of committing credentials or machine-specific settings.',
  nextSteps: ['Add .env and .env.* to .gitignore.', 'Review repository history before rotating any exposed credentials.'],
};

const baselineNodeFinding: Finding = {
  fingerprint: 'sample-node-version',
  ruleId: 'runtime.node-version',
  severity: 'warning',
  title: 'Node version is not declared',
  message: 'No supported Node version declaration was found.',
  location: { path: 'package.json', jsonPointer: '/engines/node' },
  evidence: { kind: 'version-file', observed: 'missing' },
  explanation: 'Declaring the runtime keeps local, CI, and deployment environments aligned.',
  nextSteps: ['Add an engines.node range or commit a version file.', 'Use the same major version in CI.'],
};

export const SAMPLE_REPORT = sampleReport;
export const SAMPLE_BASELINE_REPORT: ScanReport = {
  ...sampleReport,
  reportId: 'sample-before-2026-01',
  project: { ...sampleReport.project, label: 'Acme storefront · synthetic baseline' },
  summary: { findingCount: 5, bySeverity: { error: 2, warning: 3, info: 0 }, byStatus: { passed: 1, finding: 5, not_checked: 0, not_applicable: 0 }, partial: false },
  checks: sampleReport.checks.map((check) => {
    if (check.ruleId === 'package.build-script') return { ...check, status: 'finding' as const, findings: [baselineBuildFinding] };
    if (check.ruleId === 'runtime.node-version') return { ...check, status: 'finding' as const, findings: [baselineNodeFinding] };
    if (check.ruleId === 'git.tracked-env') return { ...check, status: 'finding' as const, findings: [baselineTrackedEnvFinding] };
    if (check.ruleId === 'source.localhost-url') return { ...check, status: 'passed' as const, evaluatedInputs: ['src/'] };
    return check;
  }),
  coverage: { ...sampleReport.coverage, checksEvaluated: 6, checksNotChecked: 0 },
  limitations: [],
};

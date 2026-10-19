import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compareReports,
  reportHasCoverageGaps,
  type ComparisonResult,
} from '../../comparison/src/index';
import {
  validateReport,
  type CoverageLimits,
  type Finding,
  type ScanReport,
  type Severity,
} from '../../report-contract/src/index';

export type OutputFormat = 'pretty' | 'json';
export type FailOn = 'none' | Severity;

export interface CliIO {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  stdin?: string;
  cwd?: string;
}

export interface CliOptions {
  format: OutputFormat;
  output?: string;
  failOn: FailOn;
  strictCoverage: boolean;
  limits?: Partial<CoverageLimits>;
}

interface ParsedCommand {
  name: 'scan' | 'validate-report' | 'compare' | 'help';
  positionals: string[];
  options: CliOptions;
}

export const EXIT_CODES = {
  ok: 0,
  findings: 1,
  invalidInput: 2,
  executionError: 3,
  partial: 4,
} as const;

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };

function output(io: CliIO, text: string): void {
  (io.stdout ?? ((value: string) => process.stdout.write(value)))(text);
}

function errorOutput(io: CliIO, text: string): void {
  (io.stderr ?? ((value: string) => process.stderr.write(value)))(text);
}

function usage(): string {
  return [
    'DeployReady — offline deployment configuration inspection',
    '',
    'Usage:',
    '  deployready scan [project] [options]',
    '  deployready validate-report <report> [options]',
    '  deployready compare <baseline> <current> [options]',
    '',
    'Options:',
    '  --format <pretty|json>       Output format (default: pretty)',
    '  --output, -o <path>         Write output to a file',
    '  --fail-on <error|warning|info|none>',
    '                              Exit 1 when matching findings exist (default: error)',
    '  --strict-coverage            Fail partial or skipped scans',
    '  --max-file-bytes <n>        Scanner coverage limit',
    '  --max-files <n>             Scanner coverage limit',
    '  --max-total-bytes <n>       Scanner coverage limit',
    '  --help                       Show this help',
  ].join('\n');
}

function invalidOption(message: string): Error {
  return new Error(`invalid command line: ${message}`);
}

function parseOptions(args: string[]): { positionals: string[]; options: CliOptions; help: boolean } {
  const positionals: string[] = [];
  const options: CliOptions = {
    format: 'pretty',
    failOn: 'error',
    strictCoverage: false,
  };
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--strict-coverage') {
      options.strictCoverage = true;
      continue;
    }

    const consumeValue = (name: string, inline?: string, allowDash = false): string => {
      const value = inline ?? args[++index];
      if (!value || (!allowDash && value.startsWith('-'))) throw invalidOption(`${name} needs a value`);
      return value;
    };

    if (argument === '--format' || argument.startsWith('--format=')) {
      const value = consumeValue('--format', argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : undefined);
      if (value !== 'pretty' && value !== 'json') throw invalidOption(`unsupported format "${value}"`);
      options.format = value;
      continue;
    }
    if (argument === '--output' || argument === '-o' || argument.startsWith('--output=')) {
      options.output = consumeValue('--output', argument.startsWith('--output=') ? argument.slice(argument.indexOf('=') + 1) : undefined, true);
      continue;
    }
    if (argument === '--fail-on' || argument.startsWith('--fail-on=')) {
      const value = consumeValue('--fail-on', argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : undefined);
      if (value !== 'none' && value !== 'error' && value !== 'warning' && value !== 'info') {
        throw invalidOption(`unsupported --fail-on value "${value}"`);
      }
      options.failOn = value;
      continue;
    }
    const limitOptions: Record<string, keyof CoverageLimits> = {
      '--max-file-bytes': 'maxFileBytes',
      '--max-files': 'maxFiles',
      '--max-total-bytes': 'maxTotalBytes',
    };
    const limitName = Object.keys(limitOptions).find((name) => argument === name || argument.startsWith(`${name}=`));
    if (limitName) {
      const value = consumeValue(limitName, argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : undefined);
      if (!/^\d+$/.test(value) || Number(value) < 1) throw invalidOption(`${limitName} must be a positive integer`);
      options.limits = { ...options.limits, [limitOptions[limitName]]: Number(value) };
      continue;
    }
    if (argument !== '-' && argument.startsWith('-')) throw invalidOption(`unknown option "${argument}"`);
    positionals.push(argument);
  }

  return { positionals, options, help };
}

function parseCommand(argv: string[]): ParsedCommand {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { name: 'help', positionals: [], options: { format: 'pretty', failOn: 'error', strictCoverage: false } };
  }
  const command = argv[0];
  if (command !== 'scan' && command !== 'validate-report' && command !== 'compare') {
    throw invalidOption(`unknown command "${command}"`);
  }
  const parsed = parseOptions(argv.slice(1));
  if (parsed.help) return { name: 'help', positionals: [], options: parsed.options };
  return { name: command, positionals: parsed.positionals, options: parsed.options };
}

function looksLikeAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

/** Return absolute path-valued strings that would make a report machine-local. */
export function findAbsolutePaths(value: unknown, pathStack: string[] = []): string[] {
  const found: string[] = [];
  if (typeof value === 'string') {
    if (looksLikeAbsolutePath(value)) found.push(`${pathStack.join('.') || '(root)'}: ${value}`);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...findAbsolutePaths(item, [...pathStack, String(index)])));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.push(...findAbsolutePaths(item, [...pathStack, key]));
    }
  }
  return found;
}

function makePortableString(value: string, root: string): string {
  if (!looksLikeAbsolutePath(value)) return value;
  // Windows paths are not resolvable on a POSIX runner, but stripping the
  // drive/root still guarantees that a report does not publish an absolute
  // machine path.
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) {
    return value.replace(/^[A-Za-z]:[\\/]?/, '').replace(/^\\+/, '').replaceAll('\\', '/');
  }
  const portable = relative(root, value);
  return (portable || '.').split(sep).join('/');
}

/** Deep-copy a scanner result while making all absolute path values relative. */
export function makeReportPortable<T>(value: T, root: string): T {
  if (typeof value === 'string') return makePortableString(value, root) as T;
  if (Array.isArray(value)) return value.map((item) => makeReportPortable(item, root)) as T;
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = makeReportPortable(item, root);
    return copy as T;
  }
  return value;
}

interface InputReportResult {
  report?: ScanReport;
  errors: string[];
}

export interface ReportInputValidation {
  valid: boolean;
  report?: ScanReport;
  errors: string[];
}

export function validatePortableReport(value: unknown): ReportInputValidation {
  const validation = validateReport(value);
  if (!validation.valid || !validation.report) {
    return { valid: false, errors: validation.errors.map((message) => `invalid report: ${message}`) };
  }
  const absolutePaths = findAbsolutePaths(validation.report);
  if (absolutePaths.length > 0) {
    return { valid: false, errors: ['report contains absolute path(s):', ...absolutePaths] };
  }
  return { valid: true, report: validation.report, errors: [] };
}

async function readReport(input: string, io: CliIO): Promise<InputReportResult> {
  let text: string;
  try {
    text = input === '-' ? io.stdin ?? '' : await readFile(input, 'utf8');
  } catch (error) {
    return { errors: [`cannot read report "${input}": ${error instanceof Error ? error.message : String(error)}`] };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { errors: [`invalid JSON in "${input}": ${error instanceof Error ? error.message : String(error)}`] };
  }

  const validation = validatePortableReport(value);
  return validation.valid && validation.report
    ? { report: validation.report, errors: [] }
    : { errors: validation.errors };
}

function findingCountBySeverity(findings: Finding[]): Record<Severity, number> {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

function shouldFail(findings: Finding[], failOn: FailOn): boolean {
  if (failOn === 'none') return false;
  return findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn]);
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatScanPretty(report: ScanReport): string {
  const counts = findingCountBySeverity(report.checks.flatMap((check) => check.findings));
  const lines = [
    `DeployReady scan: ${report.project.label}`,
    `Project: ${report.project.kind} (${report.project.identity})`,
    `Findings: ${report.summary.findingCount} (error ${counts.error}, warning ${counts.warning}, info ${counts.info})`,
    `Checks: ${report.coverage.checksEvaluated}/${report.coverage.checksTotal} evaluated`,
  ];
  if (reportHasCoverageGaps(report)) lines.push('Coverage: partial');
  for (const check of report.checks) {
    lines.push(`- ${check.ruleId}: ${check.status}${check.findings.length ? ` (${check.findings.length} finding${check.findings.length === 1 ? '' : 's'})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatValidationPretty(valid: boolean, errors: string[]): string {
  return valid ? 'Valid DeployReady report\n' : `Invalid DeployReady report\n${errors.map((error) => `- ${error}`).join('\n')}\n`;
}

function formatComparisonPretty(result: ComparisonResult): string {
  const lines = [
    `DeployReady comparison: ${result.current.project.label}`,
    `New: ${result.newFindings.length}`,
    `Remaining: ${result.remainingFindings.length}`,
    `Resolved: ${result.resolvedFindings.length}`,
    `Cannot verify: ${result.cannotVerifyFindings.length}`,
  ];
  if (result.coverage.baselinePartial || result.coverage.currentPartial) lines.push('Coverage: partial');
  for (const change of result.changes) lines.push(`- ${change.status}: ${change.ruleId} (${change.fingerprint})`);
  return `${lines.join('\n')}\n`;
}

async function writeResult(value: unknown, format: OutputFormat, outputPath: string | undefined, io: CliIO, prettyFormatter?: () => string): Promise<void> {
  const text = format === 'json' ? jsonText(value) : (prettyFormatter?.() ?? jsonText(value));
  if (!outputPath || outputPath === '-') {
    output(io, text);
    return;
  }
  await mkdir(dirname(resolve(io.cwd ?? process.cwd(), outputPath)), { recursive: true });
  await writeFile(resolve(io.cwd ?? process.cwd(), outputPath), text, 'utf8');
}

async function loadScanner(): Promise<Record<string, unknown>> {
  // Keep this dynamic so the CLI remains usable while scanner-core is built as
  // a sibling package. The adapter accepts the expected scanProject API and a
  // couple of harmless aliases used by early scanner-core builds.
  const moduleUrl = new URL('../../scanner-core/src/index.ts', import.meta.url);
  return (await import(moduleUrl.href)) as Record<string, unknown>;
}

async function scanProject(projectRoot: string, scannerOptions: Partial<CoverageLimits> = {}): Promise<unknown> {
  const scanner = await loadScanner();
  const candidate = scanner.scanProject ?? scanner.scan ?? scanner.runScan ?? scanner.default;
  if (typeof candidate !== 'function') throw new Error('scanner-core does not expose scanProject');

  const options = { rootDir: projectRoot, projectPath: projectRoot, limits: scannerOptions };
  let result: unknown;
  try {
    // scanner-core's public API is scanProject(rootDir, options). A fallback
    // object form keeps the CLI compatible with the initial public prototype.
    result = await (candidate as (root: string, options?: unknown) => Promise<unknown>)(projectRoot, options);
  } catch (firstError) {
    try {
      result = await (candidate as (options: unknown) => Promise<unknown>)(options);
    } catch {
      throw firstError;
    }
  }
  if (result && typeof result === 'object' && 'report' in result) {
    return (result as { report: unknown }).report;
  }
  return result;
}

async function runScan(parsed: ParsedCommand, io: CliIO): Promise<number> {
  if (parsed.positionals.length > 1) {
    errorOutput(io, 'scan accepts at most one project path\n');
    return EXIT_CODES.invalidInput;
  }
  const cwd = io.cwd ?? process.cwd();
  const projectRoot = resolve(cwd, parsed.positionals[0] ?? '.');
  let rawReport: unknown;
  try {
    rawReport = await scanProject(projectRoot, parsed.options.limits);
  } catch (error) {
    errorOutput(io, `scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_CODES.executionError;
  }

  const portable = makeReportPortable(rawReport, projectRoot);
  const validation = validateReport(portable);
  if (!validation.valid || !validation.report) {
    errorOutput(io, `scanner produced an invalid report\n${validation.errors.map((item) => `- ${item}`).join('\n')}\n`);
    return EXIT_CODES.executionError;
  }
  const report = validation.report;
  await writeResult(report, parsed.options.format, parsed.options.output, io, () => formatScanPretty(report));
  const findings = report.checks.flatMap((check) => check.findings);
  if (parsed.options.strictCoverage && reportHasCoverageGaps(report)) return EXIT_CODES.partial;
  if (shouldFail(findings, parsed.options.failOn)) return EXIT_CODES.findings;
  return EXIT_CODES.ok;
}

async function runValidate(parsed: ParsedCommand, io: CliIO): Promise<number> {
  if (parsed.positionals.length !== 1) {
    errorOutput(io, 'validate-report requires exactly one report path\n');
    return EXIT_CODES.invalidInput;
  }
  const input = parsed.positionals[0] === '-' ? '-' : resolve(io.cwd ?? process.cwd(), parsed.positionals[0]);
  const result = await readReport(input, io);
  const valid = result.errors.length === 0;
  const value = parsed.options.format === 'json' ? { valid, errors: result.errors } : undefined;
  if (value) await writeResult(value, 'json', parsed.options.output, io);
  else await writeResult(value, 'pretty', parsed.options.output, io, () => formatValidationPretty(valid, result.errors));
  return valid ? EXIT_CODES.ok : EXIT_CODES.invalidInput;
}

async function runCompare(parsed: ParsedCommand, io: CliIO): Promise<number> {
  if (parsed.positionals.length !== 2) {
    errorOutput(io, 'compare requires a baseline and current report path\n');
    return EXIT_CODES.invalidInput;
  }
  const cwd = io.cwd ?? process.cwd();
  const baselineInput = parsed.positionals[0] === '-' ? '-' : resolve(cwd, parsed.positionals[0]);
  const currentInput = parsed.positionals[1] === '-' ? '-' : resolve(cwd, parsed.positionals[1]);
  const [baselineResult, currentResult] = await Promise.all([
    readReport(baselineInput, io),
    readReport(currentInput, io),
  ]);
  const errors = [...baselineResult.errors, ...currentResult.errors];
  if (errors.length > 0) {
    const value = { valid: false, errors };
    await writeResult(value, parsed.options.format, parsed.options.output, io, () => `Cannot compare reports\n${errors.map((item) => `- ${item}`).join('\n')}\n`);
    return EXIT_CODES.invalidInput;
  }

  const result = compareReports(baselineResult.report!, currentResult.report!, { strictCoverage: parsed.options.strictCoverage });
  if (!result.compatible) {
    await writeResult({ compatible: false, errors: result.errors }, parsed.options.format, parsed.options.output, io, () => `Reports are incompatible\n${result.errors.map((item) => `- ${item}`).join('\n')}\n`);
    return EXIT_CODES.invalidInput;
  }
  await writeResult(result, parsed.options.format, parsed.options.output, io, () => formatComparisonPretty(result));

  const currentFindings = [...result.newFindings, ...result.remainingFindings];
  const strictCoverageFailure = parsed.options.strictCoverage && (
    result.coverage.baselinePartial || result.coverage.currentPartial || result.cannotVerifyFindings.length > 0
  );
  if (strictCoverageFailure) return EXIT_CODES.partial;
  return shouldFail(currentFindings, parsed.options.failOn) ? EXIT_CODES.findings : EXIT_CODES.ok;
}

/** Run the CLI without terminating the host process; useful for tests and embedding. */
export async function runCli(argv: string[] = process.argv.slice(2), io: CliIO = {}): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(argv);
  } catch (error) {
    errorOutput(io, `${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return EXIT_CODES.invalidInput;
  }
  if (parsed.name === 'help') {
    output(io, `${usage()}\n`);
    return EXIT_CODES.ok;
  }
  try {
    if (parsed.name === 'scan') return await runScan(parsed, io);
    if (parsed.name === 'validate-report') return await runValidate(parsed, io);
    return await runCompare(parsed, io);
  } catch (error) {
    errorOutput(io, `command failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_CODES.executionError;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return runCli(argv);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(pathToFileURL(entryPath)) === entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const code = await main();
  process.exitCode = code;
}

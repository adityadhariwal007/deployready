export const REPORT_SCHEMA_VERSION = '1.0' as const;
export const REPORT_TYPE = 'deployready.scan' as const;

export type CheckStatus = 'passed' | 'finding' | 'not_checked' | 'not_applicable';
export type Severity = 'error' | 'warning' | 'info';
export type ProjectKind = 'vite-react' | 'vite-react-heuristic' | 'unsupported';
export type RuleId =
  | 'package.build-script'
  | 'package.lockfiles'
  | 'runtime.node-version'
  | 'source.vite-env'
  | 'source.localhost-url'
  | 'git.tracked-env';

export interface ReportLocation {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  jsonPointer?: string;
}

export interface ReportEvidence {
  kind: string;
  [key: string]: unknown;
}

export interface ReportLimitation {
  reason: string;
  path?: string;
  detail?: string;
}

export interface Finding {
  fingerprint: string;
  ruleId: RuleId;
  severity: Severity;
  title: string;
  message: string;
  location?: ReportLocation;
  evidence: ReportEvidence;
  explanation: string;
  nextSteps: string[];
}

export interface CheckResult {
  ruleId: RuleId;
  title: string;
  status: CheckStatus;
  severity: Severity;
  findings: Finding[];
  evaluatedInputs?: string[];
  evidence?: ReportEvidence;
  limitations?: ReportLimitation[];
}

export interface ScannerMetadata {
  name: 'DeployReady';
  version: string;
  rulesetVersion: string;
  runtime: string;
  generatedAt: string;
  durationMs: number;
}

export interface ProjectMetadata {
  kind: ProjectKind;
  label: string;
  identity: string;
}

export interface Summary {
  findingCount: number;
  bySeverity: Record<Severity, number>;
  byStatus: Record<CheckStatus, number>;
  partial: boolean;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface CoverageLimits {
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
}

export interface Coverage {
  checksTotal: number;
  checksEvaluated: number;
  checksNotChecked: number;
  filesConsidered: number;
  skippedFiles: SkippedFile[];
  limits: CoverageLimits;
}

export interface ScanReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  reportType: typeof REPORT_TYPE;
  reportId: string;
  scanner: ScannerMetadata;
  project: ProjectMetadata;
  summary: Summary;
  checks: CheckResult[];
  coverage: Coverage;
  limitations: ReportLimitation[];
}

export interface RuleDefinition {
  id: RuleId;
  title: string;
  defaultSeverity: Severity;
}

export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  { id: 'package.build-script', title: 'Build script', defaultSeverity: 'error' },
  { id: 'package.lockfiles', title: 'Dependency lockfile', defaultSeverity: 'warning' },
  { id: 'runtime.node-version', title: 'Node version declaration', defaultSeverity: 'warning' },
  { id: 'source.vite-env', title: 'Vite environment template', defaultSeverity: 'warning' },
  { id: 'source.localhost-url', title: 'Localhost URL', defaultSeverity: 'warning' },
  { id: 'git.tracked-env', title: 'Tracked environment file', defaultSeverity: 'error' },
];

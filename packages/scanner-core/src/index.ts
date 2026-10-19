import { createHash } from 'node:crypto';
import process from 'node:process';
import {
  REPORT_SCHEMA_VERSION,
  REPORT_TYPE,
  RULE_DEFINITIONS,
  type CheckResult,
  type ScanReport,
  type Severity,
} from '../../report-contract/src/index';
import { detectProject } from './detector';
import { listTrackedFiles } from './git';
import { notApplicableChecks, runRules } from './rules';
import type { ScannerOptions } from './types';
import { walkProject } from './walker';

const SCANNER_VERSION = '0.1.0';
const RULESET_VERSION = '1.0';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function summarize(checks: CheckResult[]) {
  const bySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const byStatus = { passed: 0, finding: 0, not_checked: 0, not_applicable: 0 };
  let findingCount = 0;
  for (const check of checks) {
    byStatus[check.status] += 1;
    findingCount += check.findings.length;
    for (const finding of check.findings) bySeverity[finding.severity] += 1;
  }
  return { findingCount, bySeverity, byStatus };
}

export async function scanProject(rootDir: string, options?: Omit<ScannerOptions, 'rootDir'>): Promise<ScanReport>;
export async function scanProject(options: ScannerOptions): Promise<ScanReport>;
export async function scanProject(
  rootOrOptions: string | ScannerOptions,
  optionOverrides: Omit<ScannerOptions, 'rootDir'> = {},
): Promise<ScanReport> {
  const options: ScannerOptions = typeof rootOrOptions === 'string'
    ? { rootDir: rootOrOptions, ...optionOverrides }
    : rootOrOptions;
  const startedAt = Date.now();
  const walk = await walkProject(options.rootDir, options.limits);
  const detection = await detectProject(options.rootDir, walk);
  let checks: CheckResult[];
  if (detection.project.kind === 'unsupported') {
    checks = notApplicableChecks();
  } else {
    const git = await (options.gitFileLister ?? listTrackedFiles)(walk.rootDir);
    checks = await runRules(walk, detection, git);
  }

  const rootLimitations = [...walk.limitations, ...detection.limitations];
  const sourceLimitations = checks.flatMap((check) => check.limitations ?? []);
  const allLimitations = [...rootLimitations, ...sourceLimitations];
  const summary = summarize(checks);
  const partial = allLimitations.length > 0
    || walk.skippedFiles.length > 0
    || summary.byStatus.not_checked > 0;
  const reportId = `scan:${hash(`${detection.project.identity}|${checks.map((check) => check.findings.map((finding) => finding.fingerprint).join(',')).join('|')}`)}`;
  const generatedAt = new Date().toISOString();

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportType: REPORT_TYPE,
    reportId,
    scanner: {
      name: 'DeployReady',
      version: SCANNER_VERSION,
      rulesetVersion: RULESET_VERSION,
      runtime: process.version,
      generatedAt,
      durationMs: Math.max(0, Date.now() - startedAt),
    },
    project: detection.project,
    summary: { ...summary, partial },
    checks,
    coverage: {
      checksTotal: RULE_DEFINITIONS.length,
      checksEvaluated: checks.length - summary.byStatus.not_checked,
      checksNotChecked: summary.byStatus.not_checked,
      filesConsidered: walk.filesConsidered,
      skippedFiles: walk.skippedFiles,
      limits: walk.limits,
    },
    limitations: allLimitations,
  };
}

export const scan = scanProject;
export { detectProject } from './detector';
export { listTrackedFiles, isEnvironmentFilename, isEnvironmentTemplateFilename } from './git';
export { analyzeSources, isSourceFile } from './ast';
export {
  findingFingerprint,
  notApplicableChecks,
  runBuildScriptRule,
  runLockfileRule,
  runNodeVersionRule,
  runViteEnvRule,
  runLocalhostRule,
  runTrackedEnvRule,
  runRules,
} from './rules';
export { walkProject, mergeCoverageLimits, relativeSafe } from './walker';
export * from './types';

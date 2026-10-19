import type {
  CheckResult,
  CheckStatus,
  Finding,
  ScanReport,
} from '../../report-contract/src/index';

/** The outcome of matching one finding from the baseline to the current scan. */
export type FindingChange = 'new' | 'resolved' | 'remaining' | 'cannot-verify';
export type ComparisonStatus = FindingChange;

export interface ComparisonFinding {
  status: FindingChange;
  fingerprint: string;
  ruleId: Finding['ruleId'];
  finding?: Finding;
  previous?: Finding;
}
export type FindingComparison = ComparisonFinding;

export interface CompatibilityResult {
  compatible: boolean;
  errors: string[];
}

export interface ComparisonCoverage {
  baselinePartial: boolean;
  currentPartial: boolean;
  currentSkippedChecks: string[];
  currentNotCheckedCount: number;
  strict: boolean;
}

export function reportHasCoverageGaps(report: ScanReport): boolean {
  return report.summary.partial
    || report.coverage.checksNotChecked > 0
    || report.coverage.skippedFiles.length > 0
    || report.checks.some((check) => check.status === 'not_checked');
}

export interface ComparisonResult extends CompatibilityResult {
  baseline: ScanReport;
  current: ScanReport;
  changes: ComparisonFinding[];
  newFindings: Finding[];
  resolvedFindings: Finding[];
  remainingFindings: Finding[];
  cannotVerifyFindings: Finding[];
  coverage: ComparisonCoverage;
  /** Convenience aliases for consumers that prefer the status names. */
  new: Finding[];
  resolved: Finding[];
  remaining: Finding[];
  cannotVerify: Finding[];
}

export interface CompareOptions {
  strictCoverage?: boolean;
}

const STATUS_ORDER: Record<FindingChange, number> = {
  new: 0,
  remaining: 1,
  'cannot-verify': 2,
  resolved: 3,
};

/**
 * Reports can only be compared when they describe the same project and report
 * contract. Scanner versions are deliberately not part of this check: a
 * ruleset upgrade can be compared as long as both reports use the same frozen
 * report schema and project identity.
 */
export function checkCompatibility(baseline: ScanReport, current: ScanReport): CompatibilityResult {
  const errors: string[] = [];

  if (baseline.schemaVersion !== current.schemaVersion) {
    errors.push(`schema versions differ (${baseline.schemaVersion} vs ${current.schemaVersion})`);
  }
  if (baseline.reportType !== current.reportType) {
    errors.push(`report types differ (${baseline.reportType} vs ${current.reportType})`);
  }
  if (baseline.project.identity !== current.project.identity) {
    errors.push('reports describe different projects (project identity differs)');
  }
  if (baseline.project.kind !== current.project.kind) {
    errors.push(`project kinds differ (${baseline.project.kind} vs ${current.project.kind})`);
  }

  return { compatible: errors.length === 0, errors };
}

function findingKey(finding: Finding): string {
  // A rule is part of the identity. This prevents an accidental fingerprint
  // collision between rules from making a finding appear resolved.
  return `${finding.ruleId}\u0000${finding.fingerprint}`;
}

function stableFindingSort(a: Finding, b: Finding): number {
  const left = JSON.stringify({
    ruleId: a.ruleId,
    fingerprint: a.fingerprint,
    location: a.location,
    message: a.message,
  });
  const right = JSON.stringify({
    ruleId: b.ruleId,
    fingerprint: b.fingerprint,
    location: b.location,
    message: b.message,
  });
  return left.localeCompare(right);
}

function byFindingKey(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of [...findings].sort(stableFindingSort)) {
    const key = findingKey(finding);
    const values = grouped.get(key);
    if (values) values.push(finding);
    else grouped.set(key, [finding]);
  }
  return grouped;
}

function allFindings(report: ScanReport): Finding[] {
  return report.checks.flatMap((check) => check.findings);
}

function checkMap(report: ScanReport): Map<string, CheckResult> {
  const checks = new Map<string, CheckResult>();
  for (const check of report.checks) {
    const existing = checks.get(check.ruleId);
    // Duplicate rule entries are outside the intended contract shape. If one
    // is present, retain the conservative coverage interpretation regardless
    // of input order.
    if (!existing || check.status === 'not_checked' || existing.status !== 'not_checked') {
      checks.set(check.ruleId, check);
    }
  }
  return checks;
}

function checkIsSkipped(check: CheckResult | undefined): boolean {
  return !check || check.status === 'not_checked';
}

function makeChange(
  status: FindingChange,
  finding: Finding | undefined,
  previous: Finding | undefined,
): ComparisonFinding {
  const selected = finding ?? previous;
  if (!selected) {
    throw new Error('A comparison change must have a finding');
  }
  return {
    status,
    fingerprint: selected.fingerprint,
    ruleId: selected.ruleId,
    ...(finding ? { finding } : {}),
    ...(previous ? { previous } : {}),
  };
}

/**
 * Compare two validated reports. Matching is deterministic and fingerprint
 * based; duplicate fingerprints are paired in a stable order. A baseline
 * finding whose current check is skipped is never called resolved.
 */
export function compareReports(
  baseline: ScanReport,
  current: ScanReport,
  options: CompareOptions = {},
): ComparisonResult {
  const compatibility = checkCompatibility(baseline, current);
  const currentChecks = checkMap(current);
  const baselineGroups = byFindingKey(allFindings(baseline));
  const currentGroups = byFindingKey(allFindings(current));
  const changes: ComparisonFinding[] = [];

  const keys = [...new Set([...baselineGroups.keys(), ...currentGroups.keys()])].sort();
  for (const key of keys) {
    const previous = baselineGroups.get(key) ?? [];
    const next = currentGroups.get(key) ?? [];
    const pairs = Math.min(previous.length, next.length);
    const representative = previous[0] ?? next[0];
    const skipped = checkIsSkipped(currentChecks.get(representative.ruleId));

    for (let index = 0; index < pairs; index += 1) {
      changes.push(
        makeChange(skipped ? 'cannot-verify' : 'remaining', next[index], previous[index]),
      );
    }
    for (let index = pairs; index < next.length; index += 1) {
      // A malformed report can contain findings under a not_checked check.
      // Preserve the uncertainty instead of presenting it as a new verified
      // finding.
      changes.push(makeChange(skipped ? 'cannot-verify' : 'new', next[index], undefined));
    }
    for (let index = pairs; index < previous.length; index += 1) {
      changes.push(
        makeChange(skipped ? 'cannot-verify' : 'resolved', undefined, previous[index]),
      );
    }
  }

  changes.sort((a, b) => {
    const statusDelta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDelta !== 0) return statusDelta;
    return `${a.ruleId}\u0000${a.fingerprint}`.localeCompare(`${b.ruleId}\u0000${b.fingerprint}`);
  });

  const select = (status: FindingChange): Finding[] =>
    changes
      .filter((change) => change.status === status)
      .map((change) => change.finding ?? change.previous)
      .filter((finding): finding is Finding => Boolean(finding));

  const currentSkippedChecks = current.checks
    .filter((check) => check.status === 'not_checked')
    .map((check) => check.ruleId)
    .sort();
  const coverage: ComparisonCoverage = {
    baselinePartial: reportHasCoverageGaps(baseline),
    currentPartial: reportHasCoverageGaps(current),
    currentSkippedChecks,
    currentNotCheckedCount: current.coverage.checksNotChecked,
    strict: options.strictCoverage === true,
  };

  return {
    ...compatibility,
    baseline,
    current,
    changes,
    newFindings: select('new'),
    resolvedFindings: select('resolved'),
    remainingFindings: select('remaining'),
    cannotVerifyFindings: select('cannot-verify'),
    coverage,
    new: select('new'),
    resolved: select('resolved'),
    remaining: select('remaining'),
    cannotVerify: select('cannot-verify'),
  };
}

export { allFindings };

// Keep these names available to callers that use the noun rather than the
// verb. They are aliases, not separate implementations.
export const compareReport = compareReports;
export const areReportsCompatible = checkCompatibility;

export function isCheckSkipped(status: CheckStatus): boolean {
  return status === 'not_checked';
}

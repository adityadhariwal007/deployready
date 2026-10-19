import type { CheckStatus, RuleId, ScanReport } from '../../../packages/report-contract/src';
import { compareReports as compareContractReports } from '../../../packages/comparison/src';

export interface ComparisonRow {
  ruleId: RuleId;
  title: string;
  before: CheckStatus | 'missing';
  after: CheckStatus | 'missing';
  beforeFindings: number;
  afterFindings: number;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  changed: number;
  resolved: number;
  introduced: number;
  unchanged: number;
  cannotVerify: number;
  compatible: boolean;
  errors: string[];
}

export function compareReports(before: ScanReport, after: ScanReport): ComparisonResult {
  const checks = new Map<RuleId, { before?: ScanReport['checks'][number]; after?: ScanReport['checks'][number] }>();
  for (const check of before.checks) {
    checks.set(check.ruleId, { before: check });
  }
  for (const check of after.checks) {
    checks.set(check.ruleId, { ...checks.get(check.ruleId), after: check });
  }

  const rows: ComparisonRow[] = Array.from(checks.entries()).map(([ruleId, pair]) => ({
    ruleId,
    title: pair.after?.title ?? pair.before?.title ?? ruleId,
    before: (pair.before?.status ?? 'missing') as ComparisonRow['before'],
    after: (pair.after?.status ?? 'missing') as ComparisonRow['after'],
    beforeFindings: pair.before?.findings.length ?? 0,
    afterFindings: pair.after?.findings.length ?? 0,
  }));
  const contractResult = compareContractReports(before, after);
  const changedRows = rows.filter((row) => row.before !== row.after || row.beforeFindings !== row.afterFindings);

  return {
    rows,
    changed: changedRows.length,
    resolved: contractResult.resolvedFindings.length,
    introduced: contractResult.newFindings.length,
    unchanged: rows.length - changedRows.length,
    cannotVerify: contractResult.cannotVerifyFindings.length,
    compatible: contractResult.compatible,
    errors: contractResult.errors,
  };
}

import { describe, expect, it } from 'vitest';
import type { Finding, ScanReport } from '../../packages/report-contract/src/index';
import { compareReports } from '../../packages/comparison/src/index';

function finding(fingerprint: string, ruleId: Finding['ruleId'] = 'package.build-script'): Finding {
  return {
    fingerprint,
    ruleId,
    severity: 'error',
    title: 'Build script',
    message: `message ${fingerprint}`,
    evidence: { kind: 'test' },
    explanation: 'test',
    nextSteps: ['test'],
  };
}

function report(findings: Finding[], status: 'passed' | 'finding' | 'not_checked' = findings.length ? 'finding' : 'passed'): ScanReport {
  const check = {
    ruleId: 'package.build-script' as const,
    title: 'Build script',
    status,
    severity: 'error' as const,
    findings,
  };
  return {
    schemaVersion: '1.0',
    reportType: 'deployready.scan',
    reportId: 'test',
    scanner: {
      name: 'DeployReady',
      version: 'test',
      rulesetVersion: 'test',
      runtime: 'test',
      generatedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 0,
    },
    project: { kind: 'vite-react', label: 'test', identity: 'same' },
    summary: {
      findingCount: findings.length,
      bySeverity: { error: findings.length, warning: 0, info: 0 },
      byStatus: { passed: status === 'passed' ? 1 : 0, finding: status === 'finding' ? 1 : 0, not_checked: status === 'not_checked' ? 1 : 0, not_applicable: 0 },
      partial: status === 'not_checked',
    },
    checks: [check],
    coverage: {
      checksTotal: 1,
      checksEvaluated: status === 'not_checked' ? 0 : 1,
      checksNotChecked: status === 'not_checked' ? 1 : 0,
      filesConsidered: 1,
      skippedFiles: [],
      limits: { maxFileBytes: 1, maxFiles: 1, maxTotalBytes: 1 },
    },
    limitations: [],
  };
}

describe('compareReports', () => {
  it('classifies new, resolved, and remaining findings deterministically', () => {
    const result = compareReports(report([finding('old'), finding('same')]), report([finding('same'), finding('new')]));
    expect(result.newFindings.map((item) => item.fingerprint)).toEqual(['new']);
    expect(result.resolvedFindings.map((item) => item.fingerprint)).toEqual(['old']);
    expect(result.remainingFindings.map((item) => item.fingerprint)).toEqual(['same']);
  });

  it('does not resolve a finding when the current check was skipped', () => {
    const result = compareReports(report([finding('old')]), report([], 'not_checked'));
    expect(result.resolvedFindings).toHaveLength(0);
    expect(result.cannotVerifyFindings.map((item) => item.fingerprint)).toEqual(['old']);
  });

  it('rejects reports from different projects', () => {
    const current = report([]);
    current.project.identity = 'different';
    expect(compareReports(report([]), current).compatible).toBe(false);
  });
});

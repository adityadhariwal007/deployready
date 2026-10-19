import { describe, expect, it } from 'vitest';
import { validateReport, type ScanReport } from '../packages/report-contract/src';

function validReport(): ScanReport {
  return {
    schemaVersion: '1.0',
    reportType: 'deployready.scan',
    reportId: 'contract-test',
    scanner: {
      name: 'DeployReady',
      version: 'test',
      rulesetVersion: '1.0',
      runtime: 'node-test',
      generatedAt: '2026-10-19T00:00:00.000Z',
      durationMs: 1,
    },
    project: { kind: 'vite-react', label: 'contract-test', identity: 'npm:contract-test' },
    summary: {
      findingCount: 0,
      bySeverity: { error: 0, warning: 0, info: 0 },
      byStatus: { passed: 1, finding: 0, not_checked: 0, not_applicable: 0 },
      partial: false,
    },
    checks: [{
      ruleId: 'package.build-script',
      title: 'Build script',
      status: 'passed',
      severity: 'error',
      findings: [],
    }],
    coverage: {
      checksTotal: 1,
      checksEvaluated: 1,
      checksNotChecked: 0,
      filesConsidered: 1,
      skippedFiles: [],
      limits: { maxFileBytes: 100, maxFiles: 10, maxTotalBytes: 1000 },
    },
    limitations: [],
  };
}

describe('report contract', () => {
  it('accepts a valid versioned report', () => {
    expect(validateReport(validReport())).toMatchObject({ valid: true, errors: [] });
  });

  it('rejects an unsupported schema version before rendering', () => {
    const report = { ...validReport(), schemaVersion: '2.0' };
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('schemaVersion');
  });

  it('rejects an absolute path in the structural contract when it is supplied as a location', () => {
    const report = validReport();
    report.checks[0] = {
      ...report.checks[0],
      status: 'finding',
      findings: [{
        fingerprint: 'absolute-path',
        ruleId: 'package.build-script',
        severity: 'error',
        title: 'Bad path',
        message: 'bad path',
        location: { path: '/Users/example/package.json' },
        evidence: { kind: 'test' },
        explanation: 'test',
        nextSteps: ['test'],
      }],
    };
    expect(validateReport(report).valid).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { parseReportText } from '../../apps/dashboard/src/reportBoundary';
import { SAMPLE_REPORT } from '../../apps/dashboard/src/sampleReport';

describe('dashboard report input boundary', () => {
  it('accepts a report that matches the frozen contract', () => {
    const result = parseReportText(JSON.stringify(SAMPLE_REPORT));

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.report.reportType).toBe('deployready.scan');
      expect(result.report.checks).toHaveLength(6);
    }
  });

  it('distinguishes empty, malformed, and unsupported input', () => {
    expect(parseReportText('   ')).toMatchObject({ status: 'empty' });
    expect(parseReportText('{not-json')).toMatchObject({ status: 'malformed' });
    expect(parseReportText(JSON.stringify({ reportType: 'other-tool' }))).toMatchObject({ status: 'unsupported' });
  });

  it('rejects reports that would reveal absolute local paths', () => {
    const unsafe = structuredClone(SAMPLE_REPORT);
    unsafe.checks[0].findings = [{
      fingerprint: 'unsafe-path',
      ruleId: 'package.build-script',
      severity: 'error',
      title: 'Unsafe path',
      message: 'Unsafe path',
      location: { path: '/Users/example/project/package.json' },
      evidence: { kind: 'test' },
      explanation: 'test',
      nextSteps: ['test'],
    }];
    expect(parseReportText(JSON.stringify(unsafe))).toMatchObject({ status: 'unsupported' });
  });
});

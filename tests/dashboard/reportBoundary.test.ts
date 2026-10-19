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
});

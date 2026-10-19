import { describe, expect, it } from 'vitest';
import type { ScanReport } from '../../packages/report-contract/src/index';
import { EXIT_CODES, findAbsolutePaths, runCli } from '../../packages/cli/src/main';

function report(): ScanReport {
  return {
    schemaVersion: '1.0',
    reportType: 'deployready.scan',
    reportId: 'test',
    scanner: { name: 'DeployReady', version: 'test', rulesetVersion: 'test', runtime: 'test', generatedAt: '2026-01-01', durationMs: 0 },
    project: { kind: 'vite-react', label: 'test', identity: 'same' },
    summary: { findingCount: 0, bySeverity: { error: 0, warning: 0, info: 0 }, byStatus: { passed: 1, finding: 0, not_checked: 0, not_applicable: 0 }, partial: false },
    checks: [{ ruleId: 'package.build-script', title: 'Build script', status: 'passed', severity: 'error', findings: [] }],
    coverage: { checksTotal: 1, checksEvaluated: 1, checksNotChecked: 0, filesConsidered: 1, skippedFiles: [], limits: { maxFileBytes: 1, maxFiles: 1, maxTotalBytes: 1 } },
    limitations: [],
  };
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: (text: string) => { stdout += text; }, stderr: (text: string) => { stderr += text; } },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

describe('CLI input validation', () => {
  it('returns code 2 for malformed report input', async () => {
    const captureOutput = capture();
    const code = await runCli(['validate-report', '-', '--format', 'json'], { ...captureOutput.io, stdin: '{' });
    expect(code).toBe(EXIT_CODES.invalidInput);
    expect(JSON.parse(captureOutput.stdout).valid).toBe(false);
  });

  it('detects absolute paths before publishing reports', () => {
    expect(findAbsolutePaths({ location: { path: '/Users/example/project/package.json' } })).toHaveLength(1);
  });

  it('validates a frozen report contract', async () => {
    const captureOutput = capture();
    const code = await runCli(['validate-report', '-', '--format', 'json'], { ...captureOutput.io, stdin: JSON.stringify(report()) });
    expect(code).toBe(EXIT_CODES.ok);
    expect(JSON.parse(captureOutput.stdout)).toEqual({ valid: true, errors: [] });
  });
});

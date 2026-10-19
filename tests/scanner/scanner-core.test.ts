import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateReport } from '../../packages/report-contract/src/index';
import {
  analyzeSources,
  findingFingerprint,
  runLocalhostRule,
  runViteEnvRule,
  scanProject,
  walkProject,
} from '../../packages/scanner-core/src/index';

const fixtures = resolve(process.cwd(), 'fixtures/projects');

describe('scanner core', () => {
  it('reports a clean Vite React fixture with contract-valid output', async () => {
    const report = await scanProject(resolve(fixtures, 'clean-vite-react'), {
      gitFileLister: async () => ({
        available: true,
        repository: true,
        trackedFiles: ['.env.example', 'package.json', 'src/App.tsx'],
        limitations: [],
      }),
    });

    expect(report.project.kind).toBe('vite-react');
    expect(report.summary.findingCount).toBe(0);
    expect(report.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(validateReport(report).valid).toBe(true);
  });

  it('finds all six classes of broken configuration without reading target scripts', async () => {
    const report = await scanProject(resolve(fixtures, 'broken-vite-react'), {
      gitFileLister: async () => ({
        available: true,
        repository: true,
        trackedFiles: ['.env.example', '.env.local', 'package.json'],
        limitations: [],
      }),
    });

    expect(report.checks.find((check) => check.ruleId === 'package.build-script')?.status).toBe('finding');
    expect(report.checks.find((check) => check.ruleId === 'package.lockfiles')?.status).toBe('finding');
    expect(report.checks.find((check) => check.ruleId === 'runtime.node-version')?.status).toBe('finding');
    expect(report.checks.find((check) => check.ruleId === 'source.vite-env')?.status).toBe('finding');
    expect(report.checks.find((check) => check.ruleId === 'source.localhost-url')?.status).toBe('finding');
    expect(report.checks.find((check) => check.ruleId === 'git.tracked-env')?.status).toBe('finding');
    expect(report.summary.findingCount).toBeGreaterThanOrEqual(6);
    expect(validateReport(report).valid).toBe(true);
  });

  it('keeps the corrected fixture free of findings', async () => {
    const report = await scanProject(resolve(fixtures, 'corrected-vite-react'), {
      gitFileLister: async () => ({
        available: true,
        repository: true,
        trackedFiles: ['.env.template', 'package.json', 'src/App.tsx'],
        limitations: [],
      }),
    });
    expect(report.summary.findingCount).toBe(0);
    expect(report.checks.every((check) => check.status === 'passed')).toBe(true);
  });

  it('uses AST nodes, not comments or arbitrary text, for source rules', async () => {
    const walk = await walkProject(resolve(fixtures, 'clean-vite-react'));
    const app = walk.files.get('src/App.tsx')!;
    app.text += '\n// http://localhost:3000 and import.meta.env.VITE_COMMENT\n';
    const analysis = analyzeSources(walk);
    expect(analysis.loopbackUrls).toHaveLength(0);
    expect(analysis.envNames.map((entry) => entry.name)).toEqual(['VITE_API_URL']);
    expect(runLocalhostRule(walk, analysis).status).toBe('passed');
    expect(runViteEnvRule(walk, analysis).status).toBe('passed');
  });

  it('keeps finding fingerprints stable for the same evidence', () => {
    const evidence = { kind: 'loopback-url', host: 'localhost', port: 3000 };
    expect(findingFingerprint('source.localhost-url', { path: 'src/App.tsx', line: 2 }, evidence))
      .toBe(findingFingerprint('source.localhost-url', { path: 'src/App.tsx', line: 2 }, evidence));
  });

  it('reports bounded files as skipped coverage instead of reading past limits', async () => {
    const walk = await walkProject(resolve(fixtures, 'clean-vite-react'), { maxFileBytes: 10, maxFiles: 2, maxTotalBytes: 20 });
    expect(walk.skippedFiles.length).toBeGreaterThan(0);
    expect(walk.limits.maxFiles).toBe(2);
  });
});

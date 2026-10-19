// @vitest-environment jsdom
import { mkdtemp, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../apps/dashboard/src/App';
import { parseReportText } from '../../apps/dashboard/src/reportBoundary';
import type { ScanReport } from '../../packages/report-contract/src';

const fixtures = resolve(process.cwd(), 'fixtures/projects');
const execFileAsync = promisify(execFile);

async function generatedReportFiles(): Promise<{ broken: string; corrected: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'deployready-dashboard-'));
  const output = (name: string) => join(directory, name);
  for (const [fixture, name] of [['broken-vite-react', 'broken.json'], ['corrected-vite-react', 'corrected.json']] as const) {
    const cliPath = resolve(process.cwd(), 'packages/cli/src/main.ts');
    await execFileAsync(process.execPath, [
      '--import', 'tsx/esm', cliPath,
      'scan', resolve(fixtures, fixture), '--format', 'json', '--output', output(name), '--fail-on', 'none',
    ], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
  }
  return { broken: await readFile(output('broken.json'), 'utf8'), corrected: await readFile(output('corrected.json'), 'utf8') };
}

function reportFile(report: ScanReport, name: string): File {
  return new File([JSON.stringify(report)], name, { type: 'application/json' });
}

describe('dashboard with scanner-generated reports', () => {
  afterEach(() => document.body.replaceChildren());

  it('imports real CLI-exported broken output, filters it, and expands safe evidence', async () => {
    const user = userEvent.setup();
    const files = await generatedReportFiles();
    render(<App />);

    await user.upload(screen.getByLabelText('Import after JSON report'), new File([files.broken], 'broken.json', { type: 'application/json' }));
    expect(await screen.findByRole('heading', { name: 'broken-vite-react' })).toBeInTheDocument();
    expect(screen.getAllByText('broken.json')).toHaveLength(2);
    expect(screen.queryByText('Bundled synthetic sample')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Findings: 6. Finding instances recorded' })).toBeInTheDocument();

    const search = screen.getByPlaceholderText('Search checks or evidence');
    await user.type(search, 'localhost');
    expect(document.querySelectorAll('.check-card')).toHaveLength(1);
    expect(screen.getByText('2 findings')).toBeInTheDocument();

    await user.clear(search);
    await user.selectOptions(screen.getByLabelText(/Filter by status/), 'finding');
    expect(document.querySelectorAll('.check-card')).toHaveLength(5);
    await user.selectOptions(screen.getByLabelText(/Filter by severity/), 'error');
    expect(document.querySelectorAll('.check-card')).toHaveLength(1);

    const findingSummary = document.querySelector('.finding-details summary');
    expect(findingSummary).not.toBeNull();
    await user.click(findingSummary as HTMLElement);
    expect(screen.getAllByText('Why it matters').length).toBeGreaterThan(0);
    await user.click(screen.getAllByText('View safe evidence')[0]);
    expect(screen.getByText(/missing-build-script/)).toBeInTheDocument();
  });

  it('compares generated broken/corrected reports and preserves uncertainty for partial coverage', async () => {
    const user = userEvent.setup();
    const files = await generatedReportFiles();
    const brokenResult = parseReportText(files.broken);
    const correctedResult = parseReportText(files.corrected);
    if (brokenResult.status !== 'loaded' || correctedResult.status !== 'loaded') throw new Error('expected exported reports to validate');
    const broken = brokenResult.report;
    const corrected = correctedResult.report;
    const partial: ScanReport = structuredClone(corrected);
    const localhostCheck = partial.checks.find((check) => check.ruleId === 'source.localhost-url');
    if (!localhostCheck) throw new Error('expected localhost check');
    localhostCheck.status = 'not_checked';
    localhostCheck.findings = [];
    localhostCheck.limitations = [{ reason: 'synthetic parser interruption', path: 'src/App.tsx' }];
    partial.summary.partial = true;
    partial.summary.byStatus.passed -= 1;
    partial.summary.byStatus.not_checked += 1;
    partial.coverage.checksEvaluated -= 1;
    partial.coverage.checksNotChecked += 1;

    render(<App />);
    const afterInput = screen.getByLabelText('Import after JSON report');
    const beforeInput = screen.getByLabelText('Import before JSON report');
    await user.upload(afterInput, new File([files.broken], 'broken.json', { type: 'application/json' }));
    await user.upload(beforeInput, new File([files.broken], 'broken-before.json', { type: 'application/json' }));
    await user.upload(afterInput, new File([files.corrected], 'corrected.json', { type: 'application/json' }));

    expect((await screen.findByText('resolved findings')).parentElement?.textContent).toContain('6');
    expect(screen.getByText('cannot verify').parentElement?.textContent).toContain('0');

    await user.upload(afterInput, reportFile(partial, 'partial-corrected.json'));
    expect((await screen.findByText('cannot verify')).parentElement?.textContent).toContain('2');
    expect(screen.getByText('Partial scan')).toBeInTheDocument();

    await user.upload(afterInput, new File(['{not json'], 'malformed.json', { type: 'application/json' }));
    expect(await screen.findByText('Could not read this report')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'corrected-vite-react' })).toBeInTheDocument();

    await user.tab();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});

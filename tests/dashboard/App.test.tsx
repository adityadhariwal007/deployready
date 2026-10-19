// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../apps/dashboard/src/App';
import { render } from '@testing-library/react';

describe('DeployReady dashboard', () => {
  afterEach(() => cleanup());

  it('starts with a clearly labelled sample and honest scan summary', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Acme storefront · synthetic sample' })).toBeInTheDocument();
    expect(screen.getAllByText('Bundled synthetic sample').length).toBeGreaterThan(0);
    expect(screen.getByText('Partial scan')).toBeInTheDocument();
    expect(screen.getByText('DeployReady is an inspection tool.')).toBeInTheDocument();
    expect(screen.queryByText(/readiness percentage/i)).not.toBeInTheDocument();
  });

  it('keeps total, evaluated, affected, and finding counts distinct and consistent', () => {
    render(<App />);

    expect(screen.getByRole('article', { name: 'Findings: 2. Finding instances recorded' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Affected checks: 2. 2 of 6 checks have findings' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Checks: 6. 5 evaluated · 1 not checked' })).toBeInTheDocument();
    expect(document.querySelectorAll('.check-card')).toHaveLength(6);
    expect(document.querySelector('.coverage-count')?.textContent).toBe('5of 6 checks evaluated');
    expect(screen.getByText('The Localhost URL check was not evaluated because this synthetic sample has no source files under src/.')).toBeInTheDocument();
    expect(screen.queryByText(/source\/ was not available/i)).not.toBeInTheDocument();
  });

  it('reveals safe evidence, explanation, and next steps from keyboard-accessible details', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByText('No dependency lockfile found')[0]);
    expect(screen.getAllByText('Why it matters').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Next steps').length).toBeGreaterThan(0);
    await user.click(screen.getAllByText('View safe evidence')[0]);
    expect(screen.getByText(/no lockfile in project root/)).toBeInTheDocument();
  });

  it('keeps primary controls reachable by keyboard', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', 'DeployReady home');
    await user.tab();
    expect(document.activeElement?.tagName).toBe('BUTTON');
    expect(document.activeElement).toHaveTextContent('Import JSON report');
  });

  it('filters checks and supports a malformed import without replacing the current report', async () => {
    const user = userEvent.setup();
    render(<App />);

    const search = screen.getAllByPlaceholderText('Search checks or evidence')[0];
    await user.type(search, 'lockfile');
    expect(screen.getAllByText('Dependency lockfile').length).toBeGreaterThan(0);
    const visibleCheckCards = Array.from(document.querySelectorAll('.check-card'));
    expect(visibleCheckCards).toHaveLength(1);
    expect(visibleCheckCards[0]?.textContent).toContain('Dependency lockfile');

    const input = screen.getByLabelText('Import after JSON report') as HTMLInputElement;
    await user.upload(input, new File(['{not json'], 'bad.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByText('Could not read this report')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Acme storefront · synthetic sample' })).toBeInTheDocument();
  });

  it('supports an empty state and can restore the sample', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Clear report' }));
    expect(screen.getByRole('heading', { name: 'Bring a report into focus' })).toBeInTheDocument();
    expect(screen.getByText('No report loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load synthetic sample' }));
    expect(screen.getByRole('heading', { name: 'Acme storefront · synthetic sample' })).toBeInTheDocument();
  });

  it('selects a finding into an editable prompt and exposes copy feedback', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<App />);

    await user.click(screen.getAllByText('No dependency lockfile found')[0]);
    await user.click(screen.getAllByLabelText('Include in fix prompt')[0]);
    const preview = screen.getByLabelText('Fix prompt preview') as HTMLTextAreaElement;
    expect(preview.value).toContain('sample-lockfile');
    expect(screen.getByText('Selected static findings · 1 issue')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview.value));
    expect(screen.getByText('Copied the current prompt text.')).toBeInTheDocument();
  });

  it('imports the Lighthouse fixture and requires explicit project association', async () => {
    const user = userEvent.setup();
    const fixture = readFileSync(resolve(process.cwd(), 'fixtures/lighthouse/synthetic-lighthouse.json'), 'utf8');
    render(<App />);

    await user.upload(screen.getByLabelText('Import Lighthouse JSON'), new File([fixture], 'synthetic-lighthouse.json', { type: 'application/json' }));
    expect(await screen.findByRole('heading', { name: 'Lighthouse audit' })).toBeInTheDocument();
    expect(screen.getByText('Imported locally, not run here.')).toBeInTheDocument();
    const audit = screen.getByLabelText('Select Lighthouse audit Buttons have an accessible name') as HTMLInputElement;
    expect(audit).toBeDisabled();
    await user.click(screen.getByLabelText('Associate this export with the current project'));
    expect(audit).not.toBeDisabled();
    await user.click(audit);
    expect((screen.getByLabelText('Fix prompt preview') as HTMLTextAreaElement).value).toContain('button-name');
  });
});

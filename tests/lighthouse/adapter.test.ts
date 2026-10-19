import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseLighthouse,
  sanitizeLighthouseUrl,
} from '../../packages/lighthouse-adapter/src';

const fixturePath = resolve(process.cwd(), 'fixtures/lighthouse/synthetic-lighthouse.json');
const fixtureText = readFileSync(fixturePath, 'utf8');

describe('Lighthouse adapter', () => {
  it('loads an authentic-shaped synthetic export into the frozen adapter schema', () => {
    const result = parseLighthouse(fixtureText);
    expect(result.status).toBe('loaded');
    if (result.status !== 'loaded') return;

    expect(result.report.kind).toBe('lighthouse');
    expect(result.report.categories.map((category) => category.id)).toEqual([
      'performance', 'accessibility', 'best-practices', 'seo',
    ]);
    expect(result.report.categories.find((category) => category.id === 'performance')).toMatchObject({
      score: 91,
      scoreDisplay: '91%',
      auditCount: 2,
    });
    expect(result.report.requestedUrl).toBe('https://demo.invalid/account');
    expect(result.report.audits.find((audit) => audit.id === 'largest-contentful-paint')?.metric).toEqual({
      value: 2840,
      unit: 'millisecond',
      displayValue: '2.8 s',
    });
  });

  it('returns boundary errors for malformed JSON and unsupported objects', () => {
    expect(parseLighthouse('{"lighthouseVersion":')).toMatchObject({ status: 'malformed' });
    expect(parseLighthouse(JSON.stringify({ hello: 'world' }))).toMatchObject({ status: 'unsupported' });
    expect(parseLighthouse(JSON.stringify({ lighthouseVersion: '8.0.0', categories: {}, audits: {} }))).toMatchObject({ status: 'unsupported' });
  });

  it('preserves null scores and classifies manual and not-applicable audits', () => {
    const result = parseLighthouse(fixtureText);
    expect(result.status).toBe('loaded');
    if (result.status !== 'loaded') return;

    expect(result.report.categories.find((category) => category.id === 'seo')).toMatchObject({ score: null, scoreDisplay: 'Not scored' });
    expect(result.report.audits.find((audit) => audit.id === 'manual-seo-check')).toMatchObject({ state: 'manual', actionable: false, score: null });
    expect(result.report.audits.find((audit) => audit.id === 'document-title')).toMatchObject({ state: 'not_applicable', actionable: false });
    expect(result.report.audits.find((audit) => audit.id === 'button-name')).toMatchObject({ state: 'failed', actionable: true });
  });

  it('retains runtime errors and warnings without treating either as instructions', () => {
    const source = JSON.parse(fixtureText) as Record<string, unknown>;
    source.runtimeError = { code: 'NO_DOCUMENT', message: 'Navigation failed; token=do-not-export' };
    source.runWarnings = ['Warning from synthetic input; password=do-not-export'];
    const result = parseLighthouse(JSON.stringify(source));
    expect(result.status).toBe('loaded');
    if (result.status !== 'loaded') return;
    expect(result.report.runtimeError).toEqual({ code: 'NO_DOCUMENT', message: 'Navigation failed; token=[redacted]' });
    expect(result.report.runWarnings).toEqual(['Warning from synthetic input; password=[redacted]']);
  });

  it('redacts credentials, queries, fragments, and bounds evidence', () => {
    expect(sanitizeLighthouseUrl('https://alice:password@example.test/path?token=secret#private')).toBe('https://example.test/path');
    const source = JSON.parse(fixtureText) as Record<string, unknown>;
    const audits = source.audits as Record<string, Record<string, unknown>>;
    audits['button-name'].details = {
      items: [{ url: 'https://alice:password@example.test/path?token=secret#private', failureSummary: 'token=secret' }],
    };
    const result = parseLighthouse(JSON.stringify(source), { maxEvidenceItems: 1, maxEvidenceChars: 40 });
    expect(result.status).toBe('loaded');
    if (result.status !== 'loaded') return;
    const evidence = result.report.audits.find((audit) => audit.id === 'button-name')?.evidence ?? [];
    expect(evidence).toHaveLength(1);
    expect(evidence.join(' ')).not.toContain('secret');
    expect(evidence.join(' ')).not.toContain('password');
  });

  it('enforces the input size limit and records missing categories as a limitation', () => {
    expect(parseLighthouse(fixtureText, { maxBytes: 20 })).toMatchObject({ status: 'malformed' });
    const source = JSON.parse(fixtureText) as Record<string, unknown>;
    delete source.categories;
    const result = parseLighthouse(JSON.stringify(source));
    expect(result.status).toBe('loaded');
    if (result.status !== 'loaded') return;
    expect(result.report.categories).toEqual([]);
    expect(result.report.limitations).toContain('Lighthouse export did not include categories');
  });
});

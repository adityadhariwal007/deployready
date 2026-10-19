import {
  LIGHTHOUSE_ADAPTER_VERSION,
  LIGHTHOUSE_REPORT_KIND,
  type LighthouseAuditState,
  type LighthouseAuditSummary,
  type LighthouseCategoryId,
  type LighthouseCategorySummary,
  type LighthouseMetric,
  type LighthouseParseResult,
  type LighthouseReport,
} from './types';

/**
 * The adapter intentionally has no filesystem, Node, or Lighthouse runtime
 * dependency. A caller reads a local export and passes its text (or bytes) to
 * this function, which makes it suitable for the dashboard as well as tests.
 */
export type LighthouseInput = unknown;

export interface LighthouseParseOptions {
  /** Maximum UTF-8 input size. The default is deliberately finite. */
  maxBytes?: number;
  /** Alias kept for callers that name the limit after the input. */
  maxInputBytes?: number;
  maxAudits?: number;
  maxEvidenceItems?: number;
  maxEvidenceChars?: number;
}

export const DEFAULT_LIGHTHOUSE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_LIGHTHOUSE_MAX_AUDITS = 2_000;
export const DEFAULT_LIGHTHOUSE_MAX_EVIDENCE_ITEMS = 8;
export const DEFAULT_LIGHTHOUSE_MAX_EVIDENCE_CHARS = 2_000;

const CATEGORY_IDS: readonly LighthouseCategoryId[] = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
];

const CATEGORY_TITLES: Record<LighthouseCategoryId, string> = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  'best-practices': 'Best Practices',
  seo: 'SEO',
};

const SCORE_MODES = new Set([
  'binary',
  'numeric',
  'manual',
  'notApplicable',
  'informative',
  'error',
  'metricSavings',
  'notApplicable',
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, errors: string[], required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && value.length === 0)) {
    errors.push(`${field} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function finiteNumber(value: unknown, field: string, errors: string[], required = false): number | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${field} must be a finite number`);
    return undefined;
  }
  return value;
}

function boundedInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function limitText(value: string, max: number): string {
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}

/** Remove credentials, query parameters, and fragments before a URL enters a report. */
export function sanitizeLighthouseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (parsed.origin === 'null') return `${parsed.protocol}//${parsed.pathname}`;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

function redactSecrets(value: string): string {
  let result = value;
  // URLs are redacted before generic key/value handling so a token in a query
  // cannot be reintroduced by evidence formatting.
  result = result.replace(/https?:\/\/[^\s<>'"`]+/gi, (candidate) => {
    return sanitizeLighthouseUrl(candidate) ?? '[redacted URL]';
  });
  result = result.replace(/\b(?:bearer\s+)[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  result = result.replace(/\b(password|passwd|token|api[-_]?key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  return limitText(result, 500);
}

function pushEvidence(output: string[], value: unknown, maxItems: number, maxChars: number): void {
  if (output.length >= maxItems || typeof value !== 'string') return;
  const safe = redactSecrets(value);
  if (!safe || output.includes(safe)) return;
  const used = output.reduce((sum, item) => sum + item.length, 0);
  if (used >= maxChars) return;
  output.push(safe.slice(0, Math.max(0, maxChars - used)));
}

function collectEvidence(details: unknown, audit: UnknownRecord, options: Required<Pick<LighthouseParseOptions, 'maxEvidenceItems' | 'maxEvidenceChars'>>): string[] {
  const output: string[] = [];
  const add = (value: unknown) => pushEvidence(output, value, options.maxEvidenceItems, options.maxEvidenceChars);

  add(audit.displayValue);
  if (isRecord(details)) {
    add(details.overallSavingsMs === undefined ? undefined : `Estimated savings: ${String(details.overallSavingsMs)} ms`);
    add(details.overallSavingsBytes === undefined ? undefined : `Estimated savings: ${String(details.overallSavingsBytes)} bytes`);
    add(details.headings && Array.isArray(details.headings)
      ? details.headings.map((heading) => isRecord(heading) ? heading.label : undefined).filter((item): item is string => typeof item === 'string').join(' | ')
      : undefined);
    if (Array.isArray(details.items)) {
      for (const item of details.items) {
        if (!isRecord(item)) continue;
        add(item.url);
        add(item.failureSummary);
        add(item.explanation);
        add(item.displayValue);
        if (output.length >= options.maxEvidenceItems) break;
      }
    }
  }
  return output;
}

function normalizeCategoryScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  // Lighthouse category scores are fractions. DeployReady exposes a
  // human-facing percentage while audit scores remain native fractions.
  return Math.round(value * 10_000) / 100;
}

function categoryScoreDisplay(score: number | null): string {
  return score === null ? 'Not scored' : `${score}%`;
}

function auditState(score: number | null, mode: string): LighthouseAuditState {
  if (mode === 'manual') return 'manual';
  if (mode === 'notApplicable') return 'not_applicable';
  if (mode === 'informative') return 'informative';
  if (mode === 'error') return 'error';
  if (score === null) return 'not_scored';
  return score < 1 ? 'failed' : 'passed';
}

function investigation(id: string, title: string, state: LighthouseAuditState): string {
  const label = `${limitText(title, 140)} (${limitText(id, 100)})`;
  if (state === 'failed') {
    return `Investigate the failed Lighthouse audit "${label}" by reviewing its documented guidance and reproducing the finding locally.`;
  }
  if (state === 'manual' || state === 'not_applicable') {
    return `Review Lighthouse audit "${label}" manually when it is relevant to the page.`;
  }
  return `Review Lighthouse audit "${label}" and verify the result against the local page.`;
}

function safeUrlField(value: unknown, field: string, errors: string[], limitations: string[]): string | undefined {
  if (value === undefined) return undefined;
  const source = text(value, field, errors);
  if (source === undefined) return undefined;
  const safe = sanitizeLighthouseUrl(source);
  if (!safe) {
    limitations.push(`${field} was omitted because it is not a valid URL`);
    return undefined;
  }
  return safe;
}

function decodeInput(input: LighthouseInput, maxBytes: number): { source?: string; result?: LighthouseParseResult } {
  if (typeof input === 'string') {
    const bytes = new TextEncoder().encode(input).byteLength;
    if (bytes > maxBytes) {
      return { result: { status: 'malformed', message: `Lighthouse export exceeds the ${maxBytes}-byte limit`, errors: [`input is ${bytes} bytes`] } };
    }
    return { source: input };
  }
  if (!(input instanceof Uint8Array)) {
    return { result: { status: 'unsupported', message: 'Lighthouse input must be JSON text or UTF-8 bytes', errors: ['unsupported input type'] } };
  }
  if (input.byteLength > maxBytes) {
    return { result: { status: 'malformed', message: `Lighthouse export exceeds the ${maxBytes}-byte limit`, errors: [`input is ${input.byteLength} bytes`] } };
  }
  try {
    return { source: new TextDecoder('utf-8', { fatal: true }).decode(input) };
  } catch {
    return { result: { status: 'malformed', message: 'Lighthouse export is not valid UTF-8', errors: ['input could not be decoded as UTF-8'] } };
  }
}

function unsupported(errors: string[]): LighthouseParseResult {
  return { status: 'unsupported', message: 'Unsupported Lighthouse export', errors };
}

/** Parse and normalize a local Lighthouse JSON export without executing it. */
export function parseLighthouse(input: LighthouseInput, options: LighthouseParseOptions = {}): LighthouseParseResult {
  const maxBytes = boundedInteger(options.maxBytes ?? options.maxInputBytes, DEFAULT_LIGHTHOUSE_MAX_BYTES);
  const decoded = decodeInput(input, maxBytes);
  if (decoded.result) return decoded.result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.source!);
  } catch (error) {
    const detail = error instanceof Error ? limitText(error.message, 180) : 'invalid JSON';
    return { status: 'malformed', message: 'Lighthouse export contains malformed JSON', errors: [detail] };
  }
  if (!isRecord(parsed)) return unsupported(['root must be a JSON object']);

  const errors: string[] = [];
  const lighthouseVersion = text(parsed.lighthouseVersion, 'lighthouseVersion', errors, true);
  const versionMatch = lighthouseVersion?.match(/^(\d+)\.\d+\.\d+(?:[-+].*)?$/);
  if (!versionMatch) errors.push('lighthouseVersion must use a supported semantic version');
  else if (Number(versionMatch[1]) < 10 || Number(versionMatch[1]) > 13) errors.push(`Lighthouse major version ${versionMatch[1]} is unsupported`);

  if (parsed.categories !== undefined && !isRecord(parsed.categories)) errors.push('categories must be an object');
  if (parsed.audits !== undefined && !isRecord(parsed.audits)) errors.push('audits must be an object');
  if (parsed.runWarnings !== undefined && (!Array.isArray(parsed.runWarnings) || parsed.runWarnings.some((item) => typeof item !== 'string'))) {
    errors.push('runWarnings must be an array of strings');
  }
  if (parsed.runtimeError !== undefined && !isRecord(parsed.runtimeError)) errors.push('runtimeError must be an object');
  if (parsed.configSettings !== undefined && !isRecord(parsed.configSettings)) errors.push('configSettings must be an object');
  if (parsed.environment !== undefined && !isRecord(parsed.environment)) errors.push('environment must be an object');
  if (parsed.requestedUrl !== undefined && typeof parsed.requestedUrl !== 'string') errors.push('requestedUrl must be a string');
  if (parsed.finalUrl !== undefined && typeof parsed.finalUrl !== 'string') errors.push('finalUrl must be a string');
  if (parsed.fetchTime !== undefined && typeof parsed.fetchTime !== 'string') errors.push('fetchTime must be a string');
  if (parsed.userAgent !== undefined && typeof parsed.userAgent !== 'string') errors.push('userAgent must be a string');
  if (errors.length > 0) return unsupported(errors);

  if (parsed.categories === undefined && parsed.audits === undefined) {
    return unsupported(['export must contain categories or audits']);
  }

  const maxAudits = boundedInteger(options.maxAudits, DEFAULT_LIGHTHOUSE_MAX_AUDITS);
  const maxEvidenceItems = boundedInteger(options.maxEvidenceItems, DEFAULT_LIGHTHOUSE_MAX_EVIDENCE_ITEMS);
  const maxEvidenceChars = boundedInteger(options.maxEvidenceChars, DEFAULT_LIGHTHOUSE_MAX_EVIDENCE_CHARS);
  const limitations: string[] = [];
  const sourceCategories = isRecord(parsed.categories) ? parsed.categories : undefined;
  const sourceAudits = isRecord(parsed.audits) ? parsed.audits : undefined;
  if (!sourceCategories) limitations.push('Lighthouse export did not include categories');
  if (!sourceAudits) limitations.push('Lighthouse export did not include audits');

  const categoryRefs = new Map<string, LighthouseCategoryId[]>();
  const categories: LighthouseCategorySummary[] = [];
  for (const id of CATEGORY_IDS) {
    const raw = sourceCategories?.[id];
    if (raw === undefined) {
      limitations.push(`Missing ${id} category`);
      continue;
    }
    if (!isRecord(raw)) return unsupported([`categories.${id} must be an object`]);
    if (raw.id !== undefined && typeof raw.id !== 'string') errors.push(`categories.${id}.id must be a string`);
    const title = text(raw.title, `categories.${id}.title`, errors) ?? CATEGORY_TITLES[id];
    const rawScore = raw.score;
    if (rawScore !== null && rawScore !== undefined && (typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1)) {
      errors.push(`categories.${id}.score must be null or a number from 0 to 1`);
    }
    const refs = raw.auditRefs;
    if (refs !== undefined && (!Array.isArray(refs) || refs.some((ref) => !isRecord(ref) || typeof ref.id !== 'string' || (ref.weight !== undefined && (typeof ref.weight !== 'number' || !Number.isFinite(ref.weight)))))) {
      errors.push(`categories.${id}.auditRefs must contain objects with string ids`);
    }
    const ids = Array.isArray(refs) ? refs.filter(isRecord).map((ref) => String(ref.id)).slice(0, maxAudits) : [];
    for (const auditId of ids) {
      const existing = categoryRefs.get(auditId) ?? [];
      if (!existing.includes(id)) existing.push(id);
      categoryRefs.set(auditId, existing);
    }
    categories.push({
      id,
      title: title ?? CATEGORY_TITLES[id],
      score: normalizeCategoryScore(rawScore as number | null | undefined),
      scoreDisplay: categoryScoreDisplay(normalizeCategoryScore(rawScore as number | null | undefined)),
      auditCount: ids.length,
    });
  }
  if (errors.length > 0) return unsupported(errors);

  const audits: LighthouseAuditSummary[] = [];
  const auditIds = [...categoryRefs.keys()].sort();
  if (auditIds.length > maxAudits) limitations.push(`Audit list was limited to ${maxAudits} entries`);
  for (const id of auditIds.slice(0, maxAudits)) {
    const raw = sourceAudits?.[id];
    if (raw === undefined) {
      limitations.push(`Missing audit data for ${id}`);
      continue;
    }
    if (!isRecord(raw)) return unsupported([`audits.${id} must be an object`]);
    if (raw.id !== undefined && typeof raw.id !== 'string') errors.push(`audits.${id}.id must be a string`);
    const title = text(raw.title, `audits.${id}.title`, errors, true);
    const mode = text(raw.scoreDisplayMode, `audits.${id}.scoreDisplayMode`, errors, true);
    const rawScore = raw.score;
    if (rawScore !== null && rawScore !== undefined && (typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1)) {
      errors.push(`audits.${id}.score must be null or a number from 0 to 1`);
    }
    if (raw.numericUnit !== undefined && typeof raw.numericUnit !== 'string') errors.push(`audits.${id}.numericUnit must be a string`);
    if (raw.displayValue !== undefined && typeof raw.displayValue !== 'string') errors.push(`audits.${id}.displayValue must be a string`);
    if (raw.description !== undefined && typeof raw.description !== 'string') errors.push(`audits.${id}.description must be a string`);
    if (raw.details !== undefined && !isRecord(raw.details)) errors.push(`audits.${id}.details must be an object`);
    if (mode && !SCORE_MODES.has(mode)) limitations.push(`Audit ${id} uses an unrecognized score display mode: ${limitText(mode, 60)}`);
    if (errors.length > 0) continue;
    const score: number | null = (rawScore === null || rawScore === undefined) ? null : rawScore as number;
    const state = auditState(score, mode!);
    const metricValue = finiteNumber(raw.numericValue, `audits.${id}.numericValue`, errors);
    if (errors.length > 0) continue;
    const metric: LighthouseMetric | undefined = metricValue === undefined ? undefined : {
      value: metricValue,
      ...(typeof raw.numericUnit === 'string' ? { unit: raw.numericUnit } : {}),
      ...(typeof raw.displayValue === 'string' ? { displayValue: raw.displayValue } : {}),
    };
    const description = typeof raw.description === 'string' ? limitText(raw.description, 800) : undefined;
    audits.push({
      id,
      title: limitText(title!, 240),
      ...(description ? { description } : {}),
      score,
      scoreDisplayMode: mode!,
      state,
      actionable: state === 'failed',
      ...(typeof raw.displayValue === 'string' ? { displayValue: raw.displayValue } : {}),
      ...(metric ? { metric } : {}),
      suggestedInvestigation: investigation(id, title!, state),
      evidence: collectEvidence(raw.details, raw, { maxEvidenceItems, maxEvidenceChars }),
      categoryIds: categoryRefs.get(id) ?? [],
    });
  }
  if (errors.length > 0) return unsupported(errors);

  let runtimeError: LighthouseReport['runtimeError'];
  if (isRecord(parsed.runtimeError)) {
    const message = text(parsed.runtimeError.message, 'runtimeError.message', errors, true);
    if (!message) return unsupported(errors);
    const code = parsed.runtimeError.code === undefined ? undefined : text(parsed.runtimeError.code, 'runtimeError.code', errors);
    if (errors.length > 0) return unsupported(errors);
    runtimeError = { ...(code ? { code: limitText(code, 120) } : {}), message: redactSecrets(message) };
  }

  const config = isRecord(parsed.configSettings) ? parsed.configSettings : {};
  const environment = isRecord(parsed.environment) ? parsed.environment : {};
  const stringContext = (value: unknown, max: number): string | undefined => typeof value === 'string' ? limitText(value, max) : undefined;
  const runWarnings = Array.isArray(parsed.runWarnings)
    ? parsed.runWarnings.map((warning) => redactSecrets(warning)).filter(Boolean).slice(0, 100)
    : [];
  if (Array.isArray(parsed.runWarnings) && parsed.runWarnings.length > 100) limitations.push('runWarnings were limited to 100 entries');

  const requestedUrl = safeUrlField(parsed.requestedUrl, 'requestedUrl', errors, limitations);
  const finalUrl = safeUrlField(parsed.finalUrl, 'finalUrl', errors, limitations);
  const report: LighthouseReport = {
    kind: LIGHTHOUSE_REPORT_KIND,
    adapterVersion: LIGHTHOUSE_ADAPTER_VERSION,
    lighthouseVersion: lighthouseVersion!,
    ...(requestedUrl ? { requestedUrl } : {}),
    ...(finalUrl ? { finalUrl } : {}),
    ...(typeof parsed.fetchTime === 'string' ? { fetchTime: limitText(parsed.fetchTime, 80) } : {}),
    context: {
      ...(stringContext(config.formFactor, 40) ? { formFactor: stringContext(config.formFactor, 40) } : {}),
      ...(stringContext(config.locale, 40) ? { locale: stringContext(config.locale, 40) } : {}),
      ...(stringContext(config.gatherMode, 40) ? { gatherMode: stringContext(config.gatherMode, 40) } : {}),
      ...(stringContext(parsed.userAgent ?? environment.hostUserAgent, 300) ? { userAgent: stringContext(parsed.userAgent ?? environment.hostUserAgent, 300) } : {}),
    },
    categories,
    audits,
    runWarnings,
    ...(runtimeError ? { runtimeError } : {}),
    limitations,
  };
  if (errors.length > 0) return unsupported(errors);
  return { status: 'loaded', report };
}

// Descriptive aliases keep the adapter convenient for importers without
// creating multiple parsing implementations.
export const parseLighthouseJson = parseLighthouse;
export const parseLighthouseExport = parseLighthouse;
export const parseLighthouseReport = parseLighthouse;

export * from './types';

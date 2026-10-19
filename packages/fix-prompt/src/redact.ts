/** Maximum size for an individual value copied from a report. */
export const MAX_REDACTED_TEXT_LENGTH = 240;

/** Maximum size for serialized evidence copied from a report. */
export const MAX_SERIALIZED_EVIDENCE_LENGTH = 1_200;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>'"`]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|password|passwd|private[_-]?key|secret|token)\b(\s*[:=]\s*)(["']?)[^\s"'`,;)}\]]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[ps]_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;

function cap(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function redactUrlMatch(value: string): string {
  const trailing = value.match(/[.,;:!?)]*$/)?.[0] ?? '';
  const candidate = trailing ? value.slice(0, -trailing.length) : value;

  try {
    const parsed = new URL(candidate);
    // URL#origin intentionally omits user information.  Omitting search and
    // hash also prevents credentials hidden in query parameters from leaking.
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.origin}${redactSecretTokens(path)}${trailing}`;
  } catch {
    // Keep a useful, safe URL shape when an imported report contains a value
    // that URL cannot parse.  Credentials and everything after ?/# are gone.
    const withoutCredentials = candidate.replace(/(https?:\/\/)(?:[^/@\s]+@)/i, '$1');
    const withoutQuery = withoutCredentials.split(/[?#]/, 1)[0];
    return `${redactSecretTokens(withoutQuery)}${trailing}`;
  }
}

function redactUrls(value: string): string {
  return value.replace(URL_PATTERN, redactUrlMatch);
}

function redactSecretTokens(value: string): string {
  let redacted = value.replace(SECRET_ASSIGNMENT_PATTERN, '$1$2[REDACTED]');
  redacted = redacted.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
  return redacted.replace(KNOWN_TOKEN_PATTERN, '[REDACTED]');
}

/**
 * Convert imported report text into bounded, single-line, non-executable
 * evidence.  This deliberately does not attempt to interpret report text.
 */
export function sanitizeText(value: unknown, maxLength = MAX_REDACTED_TEXT_LENGTH): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const withoutControls = text.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  return cap(redactSecretTokens(redactUrls(withoutControls)), maxLength);
}

/**
 * Keep a report location useful while ensuring it remains project-relative.
 * Report contracts normally reject absolute paths, but imported data is still
 * treated defensively at this boundary.
 */
export function sanitizeRelativePath(value: unknown): string {
  const raw = sanitizeText(value, 512).replace(/\\/g, '/');
  const withoutDrive = raw.replace(/^[A-Za-z]:/, '');
  const segments = withoutDrive
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => sanitizeText(segment, 120));
  return cap(segments.join('/') || '[project-root]', 512);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[depth limit]';
  if (typeof value === 'string') return sanitizeText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return sanitizeText(value.toString());
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .slice(0, 64)
      .reduce<Record<string, unknown>>((result, key) => {
        result[sanitizeText(key, 120)] = sanitizeValue(record[key], depth + 1);
        return result;
      }, {});
  }
  return sanitizeText(value);
}

/** Stable JSON is used so equivalent evidence always produces the same text. */
export function serializeSafeEvidence(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitizeValue(value, 0)) ?? 'null';
  } catch {
    serialized = '"[unserializable evidence]"';
  }
  return cap(sanitizeText(serialized, MAX_SERIALIZED_EVIDENCE_LENGTH), MAX_SERIALIZED_EVIDENCE_LENGTH);
}

/** Quote report-derived text so it cannot be mistaken for an instruction. */
export function quoteEvidence(value: unknown, maxLength = MAX_REDACTED_TEXT_LENGTH): string {
  return JSON.stringify(sanitizeText(value, maxLength));
}

import Ajv, { type ErrorObject } from 'ajv';
import { REPORT_SCHEMA } from './schema';
import type { ScanReport } from './types';

const ajv = new Ajv({ allErrors: true, strict: false });
const validator = ajv.compile<ScanReport>(REPORT_SCHEMA as unknown as import('ajv').JSONSchemaType<ScanReport>);

export interface ReportValidationResult {
  valid: boolean;
  report?: ScanReport;
  errors: string[];
}

function formatError(error: ErrorObject): string {
  const location = error.instancePath || '(root)';
  return `${location} ${error.message ?? 'is invalid'}`;
}

export function validateReport(value: unknown): ReportValidationResult {
  if (validator(value)) {
    return { valid: true, report: value, errors: [] };
  }

  return {
    valid: false,
    errors: (validator.errors ?? []).map(formatError),
  };
}

export { REPORT_SCHEMA } from './schema';

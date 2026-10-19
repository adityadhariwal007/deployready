import { validateReport, type ScanReport } from '../../../packages/report-contract/src';

export type ReportInputResult =
  | { status: 'loaded'; report: ScanReport }
  | { status: 'empty'; message: string }
  | { status: 'malformed'; message: string }
  | { status: 'unsupported'; message: string; errors: string[] };

const MAX_REPORT_BYTES = 2 * 1024 * 1024;

function hasUnsafeAbsolutePath(value: unknown, key?: string): boolean {
  if (typeof value === 'string') {
    const pathField = key === 'path' || key === 'absolutePath' || key === 'rootDir' || key === 'cwd' || Boolean(key?.endsWith('Path'));
    return pathField && (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^file:\/\//i.test(value) || /^\/(?:Users|home|private|tmp|var|Volumes|workspace)\//.test(value));
  }
  if (Array.isArray(value)) return value.some((item) => hasUnsafeAbsolutePath(item, key));
  if (value && typeof value === 'object') return Object.entries(value).some(([entryKey, item]) => hasUnsafeAbsolutePath(item, entryKey));
  return false;
}

/** The dashboard's only input boundary. All report data is validated before rendering. */
export function parseReportText(text: string): ReportInputResult {
  if (!text.trim()) {
    return { status: 'empty', message: 'The selected file is empty.' };
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return {
      status: 'malformed',
      message: 'This file is not valid JSON. Check the file and try again.',
    };
  }

  const validation = validateReport(value);
  if (!validation.valid || !validation.report) {
    return {
      status: 'unsupported',
      message: 'This JSON is not a supported DeployReady report.',
      errors: validation.errors,
    };
  }

  if (hasUnsafeAbsolutePath(validation.report)) {
    return {
      status: 'unsupported',
      message: 'This report contains an absolute local path and cannot be safely displayed.',
      errors: ['Replace absolute paths with project-relative paths before importing the report.'],
    };
  }

  return { status: 'loaded', report: validation.report };
}

export async function readReportFile(file: File): Promise<ReportInputResult> {
  if (file.size > MAX_REPORT_BYTES) {
    return {
      status: 'malformed',
      message: 'This report is larger than the 2 MB browser import limit.',
    };
  }
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
      reader.readAsText(file);
    });
    return parseReportText(text);
  } catch {
    return {
      status: 'malformed',
      message: 'The file could not be read. Check that it is a JSON file and try again.',
    };
  }
}

import { validateReport, type ScanReport } from '../../../packages/report-contract/src';

export type ReportInputResult =
  | { status: 'loaded'; report: ScanReport }
  | { status: 'empty'; message: string }
  | { status: 'malformed'; message: string }
  | { status: 'unsupported'; message: string; errors: string[] };

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

  return { status: 'loaded', report: validation.report };
}

export async function readReportFile(file: File): Promise<ReportInputResult> {
  try {
    return parseReportText(await file.text());
  } catch {
    return {
      status: 'malformed',
      message: 'The file could not be read. Check that it is a JSON file and try again.',
    };
  }
}

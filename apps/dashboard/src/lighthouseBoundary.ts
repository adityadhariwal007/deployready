import { parseLighthouse, type LighthouseReport } from '../../../packages/lighthouse-adapter/src';

export type LighthouseInputResult =
  | { status: 'loaded'; report: LighthouseReport }
  | { status: 'empty'; message: string }
  | { status: 'malformed'; message: string }
  | { status: 'unsupported'; message: string; errors: string[] };

const MAX_LIGHTHOUSE_BYTES = 5 * 1024 * 1024;

/** Parse a local Lighthouse export without executing or fetching anything. */
export function parseLighthouseText(text: string): LighthouseInputResult {
  if (!text.trim()) return { status: 'empty', message: 'The selected Lighthouse file is empty.' };
  const result = parseLighthouse(text);
  if (result.status === 'loaded') return result;
  return result;
}

export async function readLighthouseFile(file: File): Promise<LighthouseInputResult> {
  if (file.size > MAX_LIGHTHOUSE_BYTES) {
    return {
      status: 'malformed',
      message: 'This Lighthouse export is larger than the 5 MB browser import limit.',
    };
  }
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
      reader.readAsText(file);
    });
    return parseLighthouseText(text);
  } catch {
    return {
      status: 'malformed',
      message: 'The Lighthouse file could not be read. Check that it is a JSON export.',
    };
  }
}

import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { CoverageLimits, ReportLimitation } from '../../report-contract/src/index';
import { DEFAULT_COVERAGE_LIMITS, type WalkResult } from './types';

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.vite',
  'fixtures',
  'tests',
  '__tests__',
  'e2e',
]);

function isTemplateEnvironmentPath(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return /^\.env(?:\.[^.]+)*\.(?:example|sample|template)$/i.test(basename);
}

function isSensitiveEnvironmentPath(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return (basename === '.env' || basename.startsWith('.env.')) && !isTemplateEnvironmentPath(path);
}

function relativeSafe(rootDir: string, absolutePath: string): string | undefined {
  const value = relative(rootDir, absolutePath).replaceAll('\\', '/');
  if (value === '' || value === '..' || value.startsWith('../') || value.startsWith('/')) {
    return undefined;
  }
  return value;
}

function addSkipped(result: WalkResult, path: string, reason: string): void {
  result.skippedFiles.push({ path, reason });
}

async function visitDirectory(
  absoluteDirectory: string,
  result: WalkResult,
  totalBytes: { value: number },
): Promise<void> {
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    const path = relativeSafe(result.rootDir, absoluteDirectory);
    if (path) {
      result.limitations.push({ reason: 'directory-read-failed', path });
    }
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = join(absoluteDirectory, entry.name);
    const path = relativeSafe(result.rootDir, absolutePath);
    if (!path) continue;

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await visitDirectory(absolutePath, result, totalBytes);
      }
      continue;
    }

    if (result.files.size >= result.limits.maxFiles) {
      addSkipped(result, path, 'max-files');
      continue;
    }

    let stats;
    try {
      stats = await lstat(absolutePath);
    } catch {
      addSkipped(result, path, 'stat-failed');
      continue;
    }
    if (stats.isSymbolicLink()) {
      addSkipped(result, path, 'symbolic-link');
      continue;
    }
    if (!stats.isFile()) continue;

    result.filesConsidered += 1;
    // Environment files outside the committed template names are intentionally
    // filename-only inputs. This keeps secret values out of scanner memory and
    // still lets the Git rule inspect their tracked status.
    if (isSensitiveEnvironmentPath(path)) {
      addSkipped(result, path, 'environment-file-content-not-read');
      continue;
    }
    if (stats.size > result.limits.maxFileBytes) {
      addSkipped(result, path, 'max-file-bytes');
      continue;
    }
    if (totalBytes.value + stats.size > result.limits.maxTotalBytes) {
      addSkipped(result, path, 'max-total-bytes');
      continue;
    }

    try {
      const contents = await readFile(absolutePath);
      if (contents.byteLength > result.limits.maxFileBytes) {
        addSkipped(result, path, 'max-file-bytes');
        continue;
      }
      if (totalBytes.value + contents.byteLength > result.limits.maxTotalBytes) {
        addSkipped(result, path, 'max-total-bytes');
        continue;
      }
      // A binary file cannot contribute to the source/config rules. Keeping it out
      // of the text map also prevents accidental binary data in report evidence.
      if (contents.includes(0)) {
        addSkipped(result, path, 'binary-file');
        continue;
      }
      const text = contents.toString('utf8');
      result.files.set(path, { absolutePath, path, bytes: stats.size, text });
      totalBytes.value += stats.size;
    } catch {
      addSkipped(result, path, 'read-failed');
    }
  }
}

export function mergeCoverageLimits(
  limits?: Partial<CoverageLimits>,
): CoverageLimits {
  const merged = { ...DEFAULT_COVERAGE_LIMITS, ...limits };
  return {
    maxFileBytes: Math.max(1, Math.floor(merged.maxFileBytes)),
    maxFiles: Math.max(1, Math.floor(merged.maxFiles)),
    maxTotalBytes: Math.max(1, Math.floor(merged.maxTotalBytes)),
  };
}

export async function walkProject(
  rootDir: string,
  limits?: Partial<CoverageLimits>,
): Promise<WalkResult> {
  const resolvedRoot = resolve(rootDir);
  const result: WalkResult = {
    rootDir: resolvedRoot,
    files: new Map(),
    filesConsidered: 0,
    skippedFiles: [],
    limitations: [],
    limits: mergeCoverageLimits(limits),
  };
  const totalBytes = { value: 0 };

  let rootStats;
  try {
    rootStats = await lstat(resolvedRoot);
  } catch {
    result.limitations.push({ reason: 'project-root-read-failed' });
    return result;
  }
  if (!rootStats.isDirectory()) {
    result.limitations.push({ reason: 'project-root-is-not-directory' });
    return result;
  }

  await visitDirectory(resolvedRoot, result, totalBytes);
  return result;
}

export { relativeSafe };

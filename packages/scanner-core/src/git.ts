import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReportLimitation } from '../../report-contract/src/index';
import type { GitInspection } from './types';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;

function safeGitPath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }
  return normalized;
}

/**
 * Lists names from Git's index without invoking a shell. The scanner never
 * asks Git for file contents, so secrets cannot enter the report through this
 * integration.
 */
export async function listTrackedFiles(rootDir: string): Promise<GitInspection> {
  try {
    const result = await execFileAsync(
      'git',
      ['-C', rootDir, 'ls-files', '-z', '--'],
      {
        cwd: rootDir,
        shell: false,
        timeout: 5_000,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        encoding: 'utf8',
      },
    );
    const trackedFiles: string[] = [];
    const limitations: ReportLimitation[] = [];
    for (const rawPath of String(result.stdout).split('\0')) {
      if (!rawPath) continue;
      const path = safeGitPath(rawPath);
      if (path) trackedFiles.push(path);
      else limitations.push({ reason: 'unsafe-git-path' });
    }
    trackedFiles.sort();
    return { available: true, repository: true, trackedFiles, limitations };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    // Git uses 128 when the requested directory is not a repository. That is
    // a normal not-applicable state for this rule, rather than a scanner error.
    if (code === 128) {
      return { available: false, repository: false, trackedFiles: [], limitations: [] };
    }
    return {
      available: false,
      repository: true,
      trackedFiles: [],
      limitations: [{ reason: 'git-inspection-failed', detail: 'Git filename inspection was unavailable.' }],
    };
  }
}

export function isEnvironmentFilename(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  if (!basename.startsWith('.env')) return false;
  if (basename === '.env') return true;
  if (!basename.startsWith('.env.')) return false;
  if (/^\.env(?:\.[^.]+)*\.(?:example|sample|template)$/i.test(basename)) return false;
  const suffix = basename.slice('.env.'.length).toLowerCase();
  return !new Set(['example', 'sample', 'template', 'dist', 'defaults']).has(suffix);
}

export function isEnvironmentTemplateFilename(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return /^\.env(?:\.[^.]+)*\.(?:example|sample|template)$/i.test(basename);
}

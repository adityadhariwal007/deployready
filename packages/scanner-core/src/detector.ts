import { lstat, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ProjectKind, ReportLimitation } from '../../report-contract/src/index';
import { DEFAULT_COVERAGE_LIMITS, type PackageData, type ProjectDetection, type WalkResult } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dependencyNames(packageData: PackageData): Set<string> {
  const names = new Set<string>();
  for (const group of [packageData.dependencies, packageData.devDependencies, packageData.peerDependencies, packageData.optionalDependencies]) {
    if (group && isRecord(group)) {
      for (const name of Object.keys(group)) names.add(name);
    }
  }
  return names;
}

function scriptValues(packageData: PackageData): string[] {
  if (!packageData.scripts || !isRecord(packageData.scripts)) return [];
  return Object.values(packageData.scripts).filter((value): value is string => typeof value === 'string');
}

function packageIdentity(rootDir: string, packageData?: PackageData): { label: string; identity: string } {
  const packageName = packageData?.name?.trim();
  if (packageName) {
    return {
      label: packageName,
      // Version changes are common during a manual fix. Keep project identity
      // stable across scans while still separating named projects.
      identity: `npm:${packageName}`,
    };
  }
  const label = basename(rootDir) || 'project';
  return { label, identity: `directory:${label}` };
}

export async function detectProject(rootDir: string, walk?: WalkResult): Promise<ProjectDetection> {
  const resolvedRoot = resolve(rootDir);
  const limitations: ReportLimitation[] = [];
  let packageData: PackageData | undefined;
  let packageParseError: string | undefined;
  const packageFile = walk?.files.get('package.json');

  try {
    let text = packageFile?.text;
    if (text === undefined && !walk) {
      const packagePath = join(resolvedRoot, 'package.json');
      const stats = await lstat(packagePath);
      if (!stats.isFile() || stats.size > DEFAULT_COVERAGE_LIMITS.maxFileBytes) throw new Error('package.json exceeds the scan limit');
      text = await readFile(packagePath, 'utf8');
    }
    if (text === undefined) throw new Error('package.json was not covered by the bounded walk');
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) packageData = parsed as PackageData;
    else packageParseError = 'package.json is not an object';
  } catch {
    packageParseError = 'package.json could not be read or parsed';
  }

  if (packageParseError) {
    limitations.push({ reason: 'package-json-unavailable', path: 'package.json' });
  }

  const names = packageData ? dependencyNames(packageData) : new Set<string>();
  const packageScripts = scriptValues(packageData ?? {});
  const hasViteConfig = [...(walk?.files.keys() ?? [])].some((path) => /^vite\.config\.[^/]+$/i.test(path));
  const hasVite = names.has('vite') || names.has('@vitejs/plugin-react') || hasViteConfig || packageScripts.some((value) => /(?:^|[\s;&|])vite(?:\s|$)/.test(value));
  const hasReact = names.has('react') || names.has('react-dom');
  const hasReactSource = [...(walk?.files.values() ?? [])].some((file) =>
    /\bfrom\s+['"]react(?:-dom(?:\/[^'"]*)?)?['"]|\brequire\(\s*['"]react(?:-dom(?:\/[^'"]*)?)?['"]\s*\)/.test(file.text),
  );
  const identity = packageIdentity(resolvedRoot, packageData);

  let kind: ProjectKind = 'unsupported';
  if (hasVite && hasReact) kind = 'vite-react';
  else if (hasVite && hasReactSource) kind = 'vite-react-heuristic';

  return {
    project: { kind, label: identity.label, identity: identity.identity },
    packageData,
    packageParseError,
    limitations,
  };
}

export { isRecord };

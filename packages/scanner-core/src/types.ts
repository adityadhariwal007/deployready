import type {
  CoverageLimits,
  ProjectKind,
  ProjectMetadata,
  ReportLimitation,
  ScanReport,
} from '../../report-contract/src/index';

export const DEFAULT_COVERAGE_LIMITS: CoverageLimits = {
  maxFileBytes: 256 * 1024,
  maxFiles: 1_000,
  maxTotalBytes: 5 * 1024 * 1024,
};

export const DEFAULT_LIMITS = DEFAULT_COVERAGE_LIMITS;

export interface ScannerOptions {
  rootDir: string;
  limits?: Partial<CoverageLimits>;
  /** Primarily useful for tests and integrations that already have a Git adapter. */
  gitFileLister?: GitFileLister;
}

export interface GitInspection {
  available: boolean;
  repository: boolean;
  trackedFiles: string[];
  limitations: ReportLimitation[];
}

export type GitFileLister = (rootDir: string) => Promise<GitInspection>;

export interface WalkedFile {
  absolutePath: string;
  path: string;
  bytes: number;
  text: string;
}

export interface WalkResult {
  rootDir: string;
  files: Map<string, WalkedFile>;
  filesConsidered: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  limitations: ReportLimitation[];
  limits: CoverageLimits;
}

export interface PackageData {
  name?: string;
  version?: string;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  packageManager?: unknown;
  engines?: Record<string, unknown>;
  volta?: Record<string, unknown>;
}

export interface ProjectDetection {
  project: ProjectMetadata;
  packageData?: PackageData;
  packageParseError?: string;
  limitations: ReportLimitation[];
}

export interface SourceAnalysis {
  envNames: Array<{ name: string; path: string; line?: number; column?: number }>;
  loopbackUrls: Array<{
    path: string;
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    protocol: string;
    host: string;
    port?: number;
  }>;
  sourceFiles: string[];
  parsedFiles: string[];
  limitations: ReportLimitation[];
}

export type ScanProject = (options: ScannerOptions) => Promise<ScanReport>;

export type { CheckStatus, ProjectKind } from '../../report-contract/src/index';

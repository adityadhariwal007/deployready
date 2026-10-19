export const LIGHTHOUSE_ADAPTER_VERSION = '1' as const;
export const LIGHTHOUSE_REPORT_KIND = 'lighthouse' as const;

export type LighthouseCategoryId = 'performance' | 'accessibility' | 'best-practices' | 'seo';
export type LighthouseAuditState = 'failed' | 'passed' | 'manual' | 'not_applicable' | 'informative' | 'not_scored' | 'error';

export interface LighthouseCategorySummary {
  id: LighthouseCategoryId;
  title: string;
  score: number | null;
  scoreDisplay: string;
  auditCount: number;
}

export interface LighthouseMetric {
  value: number;
  unit?: string;
  displayValue?: string;
}

export interface LighthouseAuditSummary {
  id: string;
  title: string;
  description?: string;
  score: number | null;
  scoreDisplayMode: string;
  state: LighthouseAuditState;
  actionable: boolean;
  displayValue?: string;
  metric?: LighthouseMetric;
  suggestedInvestigation: string;
  evidence: string[];
  categoryIds: LighthouseCategoryId[];
}

export interface LighthouseReport {
  kind: typeof LIGHTHOUSE_REPORT_KIND;
  adapterVersion: typeof LIGHTHOUSE_ADAPTER_VERSION;
  lighthouseVersion: string;
  requestedUrl?: string;
  finalUrl?: string;
  fetchTime?: string;
  context: {
    formFactor?: string;
    locale?: string;
    gatherMode?: string;
    userAgent?: string;
  };
  categories: LighthouseCategorySummary[];
  audits: LighthouseAuditSummary[];
  runWarnings: string[];
  runtimeError?: { code?: string; message: string };
  limitations: string[];
}

export type LighthouseParseResult =
  | { status: 'loaded'; report: LighthouseReport }
  | { status: 'malformed'; message: string; errors: string[] }
  | { status: 'unsupported'; message: string; errors: string[] };

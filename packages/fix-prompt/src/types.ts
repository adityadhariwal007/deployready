import type { Finding, ScanReport } from '../../report-contract/src';
import type { LighthouseReport } from '../../lighthouse-adapter/src/types';

export interface PromptBuildInput {
  report?: ScanReport;
  selectedFindingFingerprints?: string[];
  lighthouse?: LighthouseReport;
  selectedLighthouseAuditIds?: string[];
  lighthouseAssociated?: boolean;
}

export interface PromptIssue {
  kind: 'static' | 'lighthouse';
  id: string;
  title: string;
  severity?: string;
  ruleOrAuditId: string;
  location?: string;
  evidence: string[];
  uncertainty: string[];
  acceptanceChecks: string[];
}

export interface PromptDocument {
  content: string;
  issues: PromptIssue[];
  scope: 'selected-static-findings' | 'selected-static-and-lighthouse-audits' | 'no-remediation';
}

export type StaticFinding = Finding;

export const REPORT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['schemaVersion', 'reportType', 'reportId', 'scanner', 'project', 'summary', 'checks', 'coverage', 'limitations'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', const: '1.0' },
    reportType: { type: 'string', const: 'deployready.scan' },
    reportId: { type: 'string', minLength: 1 },
    scanner: {
      type: 'object',
      required: ['name', 'version', 'rulesetVersion', 'runtime', 'generatedAt', 'durationMs'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', const: 'DeployReady' },
        version: { type: 'string', minLength: 1 },
        rulesetVersion: { type: 'string', minLength: 1 },
        runtime: { type: 'string', minLength: 1 },
        generatedAt: { type: 'string', minLength: 1 },
        durationMs: { type: 'number', minimum: 0 },
      },
    },
    project: {
      type: 'object',
      required: ['kind', 'label', 'identity'],
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['vite-react', 'vite-react-heuristic', 'unsupported'] },
        label: { type: 'string', minLength: 1 },
        identity: { type: 'string', minLength: 1 },
      },
    },
    summary: {
      type: 'object',
      required: ['findingCount', 'bySeverity', 'byStatus', 'partial'],
      additionalProperties: false,
      properties: {
        findingCount: { type: 'integer', minimum: 0 },
        bySeverity: {
          type: 'object',
          required: ['error', 'warning', 'info'],
          additionalProperties: false,
          properties: {
            error: { type: 'integer', minimum: 0 },
            warning: { type: 'integer', minimum: 0 },
            info: { type: 'integer', minimum: 0 },
          },
        },
        byStatus: {
          type: 'object',
          required: ['passed', 'finding', 'not_checked', 'not_applicable'],
          additionalProperties: false,
          properties: {
            passed: { type: 'integer', minimum: 0 },
            finding: { type: 'integer', minimum: 0 },
            not_checked: { type: 'integer', minimum: 0 },
            not_applicable: { type: 'integer', minimum: 0 },
          },
        },
        partial: { type: 'boolean' },
      },
    },
    checks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['ruleId', 'title', 'status', 'severity', 'findings'],
        additionalProperties: false,
        properties: {
          ruleId: {
            type: 'string',
            enum: [
              'package.build-script',
              'package.lockfiles',
              'runtime.node-version',
              'source.vite-env',
              'source.localhost-url',
              'git.tracked-env',
            ],
          },
          title: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['passed', 'finding', 'not_checked', 'not_applicable'] },
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['fingerprint', 'ruleId', 'severity', 'title', 'message', 'evidence', 'explanation', 'nextSteps'],
              additionalProperties: false,
              properties: {
                fingerprint: { type: 'string', minLength: 1 },
                ruleId: {
                  type: 'string',
                  enum: [
                    'package.build-script',
                    'package.lockfiles',
                    'runtime.node-version',
                    'source.vite-env',
                    'source.localhost-url',
                    'git.tracked-env',
                  ],
                },
                severity: { type: 'string', enum: ['error', 'warning', 'info'] },
                title: { type: 'string', minLength: 1 },
                message: { type: 'string', minLength: 1 },
                location: {
                  type: 'object',
                  nullable: true,
                  required: ['path'],
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', minLength: 1 },
                    line: { type: 'integer', minimum: 1, nullable: true },
                    column: { type: 'integer', minimum: 1, nullable: true },
                    endLine: { type: 'integer', minimum: 1, nullable: true },
                    endColumn: { type: 'integer', minimum: 1, nullable: true },
                    jsonPointer: { type: 'string', nullable: true },
                  },
                },
                evidence: { type: 'object', required: ['kind'], additionalProperties: true, properties: { kind: { type: 'string', minLength: 1 } } },
                explanation: { type: 'string', minLength: 1 },
                nextSteps: { type: 'array', items: { type: 'string', minLength: 1 } },
              },
            },
          },
          evaluatedInputs: { type: 'array', items: { type: 'string' }, nullable: true },
          evidence: { type: 'object', nullable: true, required: ['kind'], additionalProperties: true, properties: { kind: { type: 'string', minLength: 1 } } },
          limitations: {
            type: 'array',
            nullable: true,
            items: {
              type: 'object',
              required: ['reason'],
              additionalProperties: false,
              properties: {
                reason: { type: 'string', minLength: 1 },
                path: { type: 'string', nullable: true },
                detail: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    },
    coverage: {
      type: 'object',
      required: ['checksTotal', 'checksEvaluated', 'checksNotChecked', 'filesConsidered', 'skippedFiles', 'limits'],
      additionalProperties: false,
      properties: {
        checksTotal: { type: 'integer', minimum: 0 },
        checksEvaluated: { type: 'integer', minimum: 0 },
        checksNotChecked: { type: 'integer', minimum: 0 },
        filesConsidered: { type: 'integer', minimum: 0 },
        skippedFiles: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'reason'],
            additionalProperties: false,
            properties: {
              path: { type: 'string', minLength: 1 },
              reason: { type: 'string', minLength: 1 },
            },
          },
        },
        limits: {
          type: 'object',
          required: ['maxFileBytes', 'maxFiles', 'maxTotalBytes'],
          additionalProperties: false,
          properties: {
            maxFileBytes: { type: 'integer', minimum: 1 },
            maxFiles: { type: 'integer', minimum: 1 },
            maxTotalBytes: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    limitations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reason'],
        additionalProperties: false,
        properties: {
          reason: { type: 'string', minLength: 1 },
          path: { type: 'string', nullable: true },
          detail: { type: 'string', nullable: true },
        },
      },
    },
  },
};

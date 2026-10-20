# DeployReady handoff (archived)

**Handoff state:** archived historical context. Use `README.md`, `docs/SUBMISSION.md`,
the current Git history, and CI for the current release state.

This handoff was prepared during the implementation conversation. It records an
earlier continuation point and is not an instruction to restore its old working
tree, commit list, verification counts, or pending-work notes. No contest
submission or legal declaration is authorized by this file.

## Product and architecture

DeployReady is an offline deployment-inspection workbench for beginners building Vite/React projects.

The project is a root-level npm workspace using Node/TypeScript, React, and Vite:

- `packages/report-contract` — versioned DeployReady scan report types, schema, and validation.
- `packages/scanner-core` — bounded, read-only filesystem/Git inspection and six Vite/React rules.
- `packages/comparison` — pure comparison of scan reports with `new`, `remaining`, `resolved`, and `cannot-verify` outcomes.
- `packages/cli` — local `scan`, `validate-report`, and `compare` commands with CI exit codes.
- `packages/lighthouse-adapter` — separate browser-safe adapter for local Lighthouse JSON exports.
- `packages/fix-prompt` — deterministic, template-based remediation prompt generation.
- `apps/dashboard` — static React/Vite report viewer.
- `fixtures/projects` — clean, broken, and corrected scanner fixtures.
- `fixtures/lighthouse` — clearly synthetic Lighthouse-shaped test fixture; not an actual audit.
- `tests` — scanner, contract, CLI, comparison, dashboard, Lighthouse, and prompt-builder tests.

The dashboard does not scan local files automatically. The local CLI scans the target project, exports JSON, and the browser imports validated reports.

## Current commits

Current branch: `main`

Recent commits, newest first:

```text
6c98199 feat: add lighthouse export adapter
1c86326 feat: add deterministic remediation prompt generator
3fe7820 fix: align dashboard report counts
87d3502 fix: harden reports and release verification
af29b28 feat: build initial inspection workbench
```

## Current working tree

At handoff, Git reports these uncommitted files:

```text
?? packages/fix-prompt/package.json
?? packages/fix-prompt/src/types.ts
?? packages/lighthouse-adapter/package.json
?? packages/lighthouse-adapter/src/types.ts
```

These are intentional contract/package metadata files created alongside the already committed adapter and prompt-builder implementations. Preserve them; do not reset or delete them. `HANDOFF.md` is being added as part of this handoff.

The committed changes from the two latest implementation writers are:

### Lighthouse adapter commit `6c98199`

- `packages/lighthouse-adapter/src/index.ts`
- `fixtures/lighthouse/synthetic-lighthouse.json`
- `fixtures/lighthouse/README.md`
- `tests/lighthouse/adapter.test.ts`

### Prompt builder commit `1c86326`

- `packages/fix-prompt/src/index.ts`
- `packages/fix-prompt/src/redact.ts`
- `tests/fix-prompt/index.test.ts`

## Lighthouse contract and progress

Official documentation read before implementation:

https://developer.chrome.com/docs/lighthouse/overview

The official guidance says Lighthouse is an open-source automated tool with audits for performance, accessibility, SEO, and more. It can run in Chrome DevTools, CLI, or Node; CLI/Node workflows require a local Chrome installation. JSON can be exported from a Lighthouse report or with the CLI using `--output json --output-path`.

The adapter deliberately does not weaken or extend the DeployReady scan schema. It accepts local JSON text or UTF-8 bytes and returns a separate `LighthouseReport` contract:

- `kind: "lighthouse"`
- adapter version
- supported Lighthouse major versions 10–13
- sanitized requested/final URLs
- fetch timestamp when present
- context such as form factor, locale, gather mode, and user agent
- authentic category scores for Performance, Accessibility, Best Practices, and SEO, preserving unavailable scores as `null`
- audit summaries with original score display mode, display values, numeric values, units, state, category IDs, bounded evidence, and deterministic investigation guidance
- run warnings, runtime error, and explicit limitations

Supported audit states include failed, passed, manual, not applicable, informative, not scored, and error. Failed actionable audits are marked for remediation. Missing categories/audits and runtime warnings are retained as limitations rather than converted into passing results.

Safety behavior includes:

- finite input/audit/evidence limits
- JSON shape and data-type validation
- URL credential/query/fragment removal
- bounded evidence strings
- redaction of bearer/token/password/API-key-like values
- imported report text treated as data, never executable instructions

The synthetic fixture is explicitly documented as hand-written and not an actual audit. No real Lighthouse audit of DeployReady has been completed yet.

## Remediation prompt contract and progress

`packages/fix-prompt` exposes `buildFixPrompt` plus aliases `buildRemediationPrompt` and `generateFixPrompt`.

Input supports:

- a DeployReady `ScanReport`
- optional static finding fingerprints; all current findings are selected by default when no list is supplied
- optional `LighthouseReport`
- optional selected Lighthouse audit IDs
- explicit `lighthouseAssociated: true` before Lighthouse evidence can enter the prompt

The output is a deterministic `PromptDocument` containing normalized content, issue records, and one of these scopes:

- `selected-static-findings`
- `selected-static-and-lighthouse-audits`
- `no-remediation`

Prompt content instructs the receiving coding assistant to:

- inspect the repository first
- treat every report field as quoted, untrusted evidence
- verify findings before editing
- make the smallest appropriate changes
- preserve existing behavior
- avoid fabricated credentials, configuration, or environment values
- avoid blanket dependency upgrades and arbitrary Node/package-manager changes
- rerun relevant checks and report verification

Prompt sanitization strips control characters, caps imported values, keeps relative locations, redacts URL credentials/query/fragment, redacts bearer and secret-like token forms, and serializes evidence deterministically.

Pending integration work:

- dashboard selection state for findings and Lighthouse audits
- visible `Create fix prompt` actions beside findings
- editable prompt preview
- copy with Clipboard API plus selectable fallback
- Markdown download using the exact same normalized content
- explicit same-project association UI for combining static and Lighthouse evidence

## Dashboard state before handoff

Already working and verified before this handoff:

- bundled synthetic sample clearly labelled
- real `reports/broken.json` and `reports/corrected.json` import tested through dashboard integration tests
- search, status, and severity filters
- expandable findings, explanations, next steps, and safe evidence
- malformed report handling without replacing the current valid report
- partial comparison handling where skipped checks become `cannot verify`, never resolved
- unrelated-project comparison rejection
- consistent summary semantics: findings, affected checks, total checks, evaluated checks, and not-checked checks
- corrected synthetic limitation wording for `src/`
- responsive narrow-screen rendering and keyboard-focused primary controls
- clean Vite production preview at `http://127.0.0.1:5173/` during the prior UI pass

Pending UI work requested by the user:

- reduce the repeated import banner and oversized report heading
- use a compact project/scan bar
- reduce the five equal metric-card treatment
- make actionable findings and selected details primary
- add clear Project checks, Lighthouse audit, Compare, and Fix prompt sections only when implemented
- explain partial coverage by distinguishing skipped files, deliberate secret-file exclusion, and unavailable checks
- add the prompt builder and Lighthouse report views without implying automatic scanning or a combined readiness score

## Verification actually recorded

Baseline verification before the latest adapters:

```text
npm test -- --run       PASS: 7 test files, 29 tests
npm run typecheck       PASS
npm run build           PASS
npm_config_offline=true npm test -- --run
                         PASS: 7 test files, 29 tests
```

The `npm_config_offline=true` result is only npm offline behavior. It is **not** network isolation for test code. Do not describe it as equivalent to Docker `--network none`.

The prior real CLI export flow validated `reports/broken.json` and `reports/corrected.json`, and comparison reported:

```json
{
  "report_valid": true,
  "compatible": true,
  "new": 0,
  "remaining": 0,
  "resolved": 6,
  "cannotVerify": 0
}
```

The two implementation writers reported these additional focused checks:

- Lighthouse adapter focused suite: 6 tests passed.
- Prompt builder focused suite: 5 tests passed.
- Full suite after their work: 40 tests across 9 files passed.
- Typecheck passed after their work.

Those latest adapter/prompt reports were produced by the delegated writers and were not rerun in this handoff-only turn. Re-run after integrating the currently untracked contract files and dashboard changes.

## Known blockers and limitations

### Docker

Docker and Podman were unavailable on the development machine:

```text
docker: command not found
podman: command not found
```

Do not install a container runtime or change permissions as part of the next continuation. Docker verification remains pending:

```bash
docker build -t deployready .
docker run --rm --network none deployready npm test
```

### Lighthouse runtime audit

No actual Lighthouse audit of the production preview has been completed. The official Chrome documentation says CLI/Node Lighthouse workflows require a local Chrome installation. Do not install a system browser/runtime without explicit authorization. If Chrome and Lighthouse tooling are already available later, audit the production preview build rather than the dev server and record the real URL, device/mode, timestamp, scores, and any browser/tool errors.

### UI integration

The adapter and prompt contracts are present, but the dashboard does not yet expose them. The next implementation should integrate them behind the existing validated import boundary, not make Lighthouse JSON part of the DeployReady scan schema.

### Scope association

Lighthouse reports and static scan reports must not be silently combined. A later UI must require explicit user association for the same project before generating a mixed prompt. Do not compare unrelated URLs, devices, modes, or project identities as equivalent.

## Safe next step

1. Confirm this handoff and retain all current files.
2. Add the currently untracked contract package metadata/types to the next intentional commit.
3. Integrate prompt and Lighthouse imports in the dashboard with focused tabs/sections.
4. Add copy/download and selection tests.
5. Re-run the full suite, typecheck, production build, and browser workflow.
6. Attempt Lighthouse only if an existing Chrome/Lighthouse runtime is available.
7. Run Docker checks only when a container runtime is available.

No publishing, push, contest submission, repository reset, or destructive cleanup is authorized by this handoff.

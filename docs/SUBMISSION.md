# DeployReady

## Submission description

DeployReady is an offline, evidence-backed deployment preflight workbench for beginners building Vite/React projects. It scans a target project without executing its scripts, exports a versioned JSON report, and presents findings, coverage limitations, local Lighthouse evidence, and before/after comparison in a static React dashboard.

The initial profile checks six high-signal failure modes: missing build scripts, missing/conflicting/mismatched dependency lockfiles, missing/invalid/incompatible Node declarations, Vite environment names missing from committed templates, literal loopback URLs in source, and Git-tracked non-template environment files. Findings include severity, safe evidence, locations, explanations, and deterministic next steps. Reports use schema `1.0`, relative paths, bounded inputs, explicit `not_checked`/`not_applicable` states, and coverage metadata so incomplete inspection is not presented as success.

The CLI supports `scan`, `validate-report`, and coverage-aware `compare` commands. The browser dashboard imports validated local reports, keeps Lighthouse evidence separate until the user confirms same-project association, and generates editable deterministic Markdown remediation prompts without applying changes or sending source, credentials, or reports to a server. The repository includes clean, broken, and corrected fixtures for a repeatable scan-to-compare demo.

## Repository

https://github.com/adityadhariwal007/deployready

## Demo walkthrough

```bash
npm ci
npm run deployready -- scan fixtures/projects/broken-vite-react --format json --output reports/broken.json --fail-on none
npm run deployready -- scan fixtures/projects/corrected-vite-react --format json --output reports/corrected.json --fail-on none
npm run deployready -- compare reports/broken.json reports/corrected.json
npm run dev
```

Open the local Vite URL, import a generated report, expand a finding, select **Create fix prompt** or **Include in fix prompt**, review/edit the Markdown, and copy or download it. **Import Lighthouse JSON** accepts a local export; confirm the explicit same-project association only when appropriate, then select failed actionable audits for remediation context.

## Verification status

Verified: pinned Node `22.19.0`; clean `npm ci`; 42 tests; typecheck; production build; Docker build; and Docker tests with `--network none` in GitHub Actions. Successful CI runs include `39319366051` (`d73552f`) and `39320103588` (`da130a6`). Historical local Lighthouse runs were not clean performance benchmarks because browser extensions affected load timing. A real Lighthouse export was imported/rendered, while the association gate was verified separately from the synthetic sample.

Unverified by design: hosted deployment success, runtime correctness of a target application, provider-specific settings, dynamic environment/URL construction, full monorepo dependency graphs, automatic source fixes, and a clean hosted Lighthouse score.

## Implementation context

Implementation was developed in OmniRush.ai. Session references: original
implementation `ses_eab065488ffe3hNS0Y6u4x5QIW`; current continuation
`ses_eaaa9cb6bffe2F7b7wBU8HCJMd`.

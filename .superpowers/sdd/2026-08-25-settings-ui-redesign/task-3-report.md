# Task 3 — Make Setup a Short Path to Ready

## Scope delivered

- Restructured Setup into Provider, conditional credentials, Model, local readiness, and a separate runtime issue region.
- Added `renderSetupReadiness(settings)` using `deriveSetupReadiness`, and a module-only `setupRuntimeIssue` renderer that never persists or switches tabs.
- Captured safe model-discovery and generation/provider failures; cleared the issue after provider, credential, model, model-manager, and experimental-route changes.
- Made provider credential copy projection-driven, removed the `sk-...` placeholder, added a SillyTavern connection pointer for host-managed credentials, and hid Refresh Models for static/curated discovery while showing its existing explanation.
- Kept technical/model-management, legacy recovery, experimental consent, plan inspection, active cancel, and diagnostics under the only Advanced disclosure.

## TDD evidence

### RED

Before changing production files, ran:

```text
node --test test/settings-readiness.contract.test.mjs
```

Result: 1 passed, 4 failed. The failures were the missing readiness/issue status regions, missing readiness/runtime rendering functions, missing provider-projected refresh/credential behavior, and missing issue clearing/failure wiring.

### GREEN

Focused setup/provider/model verification:

```text
node --test test/settings-readiness.contract.test.mjs test/settings-ui-contract.test.mjs test/settings-ui.test.mjs
```

Result: 20 passed, 0 failed.

Full deterministic suite:

```text
node --test test/*.test.mjs
```

Result: 212 passed, 0 failed.

Additional checks: `node --check index.js` exited 0 and `git diff --check` found no whitespace errors.

## Self-review

- Readiness uses only the existing pure helper labels and contains no Connected, Online, or Verified language.
- Runtime health is rendered in a separate polite status region, stores only the latest normalized safe message, is module-scoped, and does not call tab activation.
- Provider, RP, route dispatch, credentials storage, and model records remain behaviorally unchanged; the change only renders their existing projections and adds non-persisted UI state.
- Refresh remains immediately beside Model when available. Unsupported/curated discovery hides the button and exposes its plain reason.
- Setup still contains exactly one, non-nested Advanced disclosure. Existing IDs and bound handlers remain unique.

## Commit

`feat: streamline provider setup`

## Concerns

- No browser/live-provider UAT was run. The deterministic UI and provider/model contract suite passes, but live provider behavior requires a configured SillyTavern session and credentials.

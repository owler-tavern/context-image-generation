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

## Round 1 follow-up — 2026-08-25

### Findings addressed

- A fulfilled model-discovery result with a normalized warning now updates the separate Setup runtime issue before its toast.
- Credential input rerenders local readiness immediately after storing the key.
- Credential projection now exposes bounded `credential` fields (`mode`, `label`, `placeholder`, `setupHelp`, and `advancedHelp`). The Setup consumes only the bounded help; technical provider diagnostics render in `#cig_provider_advanced_info` inside Advanced.
- Experimental-preflight consent clears stale runtime issue/Setup attention before rerendering.
- Registry metadata uses `advancedHelp`; the prior `providerInfo` projection is removed. LinkAPI recovery is independently hidden for non-LinkAPI providers.

### RED/GREEN evidence

RED before the first follow-up implementation:

```text
node --test test/provider-ui-projection.test.mjs test/settings-ui.test.mjs test/settings-readiness.contract.test.mjs
```

Result: 14 passed, 3 failed. The failures identified the absent credential projection, absent Advanced provider-info target, and absent runtime-issue formatter. A follow-up projection-boundary RED run failed 1/10 because `providerInfo` remained present, and the LinkAPI-recovery isolation RED run failed 1/7 because the recovery control had no provider-specific wrapper.

Focused GREEN verification:

```text
node --check index.js
node --test test/settings-readiness.contract.test.mjs test/settings-ui-contract.test.mjs test/settings-ui.test.mjs test/provider-ui-projection.test.mjs test/provider-registry.test.mjs
```

Result: 42 passed, 0 failed.

The first full-suite attempt found one dependent assertion still reading the retired `ui.providerInfo`; root cause was the intended projection rename. The contract was updated to validate `ui.credential.advancedHelp` instead.

Final full-suite verification:

```text
node --test test/*.test.mjs
```

Result: 216 passed, 0 failed. `git diff --check` also passed.

### Follow-up self-review

- Credential projection has no secret value field. The direct-provider projection test rejects common secret prefixes, and only normalized user messages reach the runtime issue renderer.
- Technical registry explanations are only assigned to `credential.advancedHelp`; Setup’s visible help is bounded default/rule copy.
- The runtime issue remains module-only and no added path persists it or activates a settings tab.

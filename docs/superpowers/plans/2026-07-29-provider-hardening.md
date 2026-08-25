# Provider Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the provider UI, model-routing, discovery, and duplicate-generation flaws found after provider-adapter merge.

**Architecture:** Provider UI exposes generic capabilities separately from provider-specific advanced controls. Persisted model entries carry an explicit route/capability profile rather than inferring a transport from the provider. A small generation coordinator owns in-flight keys across all generation entry points.

**Tech Stack:** ES modules, Node built-in test runner, jQuery, SillyTavern extension APIs.

## Global Constraints

- No provider key, Authorization header, or prompt body is logged by new code.
- Existing LinkAPI and TokenReply built-in routes remain backward compatible.
- Fetch failures never delete local model entries.
- All changed behavior has a deterministic Node test that fails before implementation.

---

### Task 1: Separate generic discovery from LinkAPI advanced controls

**Files:**
- Modify: `settings.html`, `index.js`, `lib/providers/ui-projection.js`
- Test: `test/provider-ui-projection.test.mjs`

**Interfaces:**
- Produces `showsLegacyRecovery` and `supportsModelDiscovery` as independently projected UI flags.

- [ ] Write a failing projection/UI contract test proving TokenReply has discovery but does not show LinkAPI recovery.
- [ ] Run `node --test test/provider-ui-projection.test.mjs` and verify failure.
- [ ] Render the generic discovery controls independently and gate LinkAPI advanced markup with `showsLegacyRecovery`.
- [ ] Re-run the targeted test and commit `fix: isolate provider-specific advanced controls`.

### Task 2: Persist explicit managed-model contracts

**Files:**
- Modify: `lib/providers/model-manager.js`, `lib/providers/ui-projection.js`, `index.js`, `settings.html`
- Test: `test/model-manager.test.mjs`, `test/provider-ui-projection.test.mjs`

**Interfaces:**
- `updateLocalModelEntries(entries, operation)` preserves `transport`, `supportsReferenceImages`, and `supportsSize` when supplied.
- `mergeProviderModels(providerId, entries)` uses explicit persisted metadata before conservative defaults.

- [ ] Write failing tests for a manual LinkAPI Gemini route and a manual OpenAI Images route.
- [ ] Run targeted tests and verify failure.
- [ ] Add a route selector restricted to provider transports; persist matching capability defaults.
- [ ] Re-run targeted tests and commit `fix: make managed model routes explicit`.

### Task 3: Restrict TokenReply discovery to image-capable IDs

**Files:**
- Modify: `lib/providers/registry.js`, `lib/providers/model-discovery.js`
- Test: `test/model-discovery.test.mjs`

**Interfaces:**
- TokenReply discovery includes only `grok-imagine-image` IDs.

- [ ] Write a failing test with one TokenReply chat ID and one image ID.
- [ ] Run the targeted test and verify failure.
- [ ] Add a declarative TokenReply image filter and use it in list parsing.
- [ ] Re-run the targeted test and commit `fix: filter TokenReply model discovery`.

### Task 4: Coordinate duplicate generation attempts

**Files:**
- Create: `lib/generation-coordinator.js`
- Modify: `index.js`
- Test: `test/generation-coordinator.test.mjs`

**Interfaces:**
- `createGenerationCoordinator()` exposes `run(key, operation)` and rejects a second matching in-flight key without invoking its operation.

- [ ] Write a failing test with two same-key promises and verify only the first operation executes.
- [ ] Run the targeted test and verify failure.
- [ ] Route settings, message, swipe, slash, and auto-generation through stable coordinator keys.
- [ ] Re-run targeted and full suites, then commit `fix: prevent duplicate image generation requests`.

### Task 5: Update standing documentation and verify

**Files:**
- Modify: `README.md`, `DEVELOPER_GUIDE.md`, `docs/PROVIDER_CATALOG.md`
- Test: `test/provider-catalog.test.mjs`

- [ ] Document explicit managed-model route selection, filtered experimental discovery, and duplicate-request behavior.
- [ ] Run `node --test test/*.test.mjs`, `node --check index.js`, module syntax checks, and `git diff --check`.
- [ ] Commit `docs: document provider hardening behavior`.

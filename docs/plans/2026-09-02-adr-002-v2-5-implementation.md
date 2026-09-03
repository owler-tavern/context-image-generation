# ADR-002 v2.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refocus Context Image Generation around two generation entry points—wand and slash command—backed by one Scene Generation kernel, optional reference contributors, and no active attire/outfit-management behavior.

**Architecture:** Extract the existing capture → readiness → plan → dispatch → coordinator flow from `index.js` behind one injected Scene Generation interface. Wand and slash become thin input/delivery adapters. Avatar, previous-image, and saved-appearance references contribute through a nullable seam; outfit data remains readable but inert and is not deleted in v2.5.

**Tech Stack:** Browser-side JavaScript ES modules, SillyTavern extension interfaces, jQuery host integration, Node.js built-in test runner.

**Spec:** `docs/decisions/ADR-002-generation-entry-points-and-continuity-scope.md`

## Global Constraints

- Work on a new `codex/v2.5` branch created directly from the current `v2` checkout so the working tree carries forward unchanged.
- The only generation entry points are the wand and `/proimagine` slash command (including its existing aliases).
- Settings configures generation and must not expose a generation action.
- Prompt and current scene are authoritative.
- Avatar, previous-image, and saved-appearance references are optional; absence never blocks generation.
- Saved appearance remains progressively disclosed and removable from the kernel.
- Outfit creation, selection, locking, prompt injection, recovery, and new persistence stop in v2.5.
- Existing `rp_outfits`, `outfit_pending`, per-chat `outfitState`, and historical artifact metadata are preserved as opaque legacy data.
- Do not delete appearance assets, outfit data, Gallery data, or chat metadata in this implementation.
- Keep ADR-001's independent Gallery and Appearance asset lifecycles.
- Preserve slash behavior: return the generated image URL and update preview/Gallery; do not attach slash output to a chat message.
- No paid provider call is permitted during automated verification.
- Evidence labels must distinguish deterministic tests from live browser/provider acceptance.

## Branch and file structure

Before implementation, inspect `git status --short`, capture `git diff -- .gitignore README.md DEVELOPER_GUIDE.md`, and record those paths as pre-existing user work in `docs/STATUS.md`. Do not commit, stash, restore, or rewrite those files. Create the branch directly; `git switch -c` preserves the working tree:

```powershell
git switch -c codex/v2.5
```

Immediately rerun `git status --short` and confirm every pre-existing path and untracked file is still present. Never modify or stage `.gitignore`. Do not modify or stage `README.md` or `DEVELOPER_GUIDE.md` before the explicit overlap review and user approval in Task 7.

Expected new modules:

- `lib/scene-generation/kernel.js` — owns the shared generation transaction.
- `lib/scene-generation/contracts.js` — validates the two input kinds, destination kinds, and normalized request/result shapes.
- `lib/scene-generation/reference-contributors.js` — composes optional reference contributors without knowing their storage schemas.
- `lib/scene-generation/delivery.js` — message-attachment and preview/Gallery delivery adapters.
- `test/scene-generation-contracts.test.mjs` — interface validation and allowed-entry tests.
- `test/scene-generation-kernel.test.mjs` — shared orchestration, failure, and no-spend tests.
- `test/scene-generation-entrypoints.contract.test.mjs` — source contract proving only wand and slash can initiate generation.
- `test/scene-generation-authority.test.mjs` — behavior contract proving only wand and slash can reach a fake paid dispatcher.
- `test/outfit-retirement.test.mjs` — legacy-data preservation and no-active-outfit behavior.
- `docs/STATUS.md` — live implementation status and evidence ledger required by `AGENTS.md`.
- `docs/V2_5_RELEASE_NOTES.md` — scope changes without touching pre-existing dirty README/developer-guide work.

Expected modified files:

- `index.js` — composition root, thin wand/slash adapters, removed secondary dispatch paths, removed outfit runtime wiring.
- `settings.html` — remove attire/outfit controls and generation-capable secondary controls; keep configuration-only surfaces.
- `style.css` — remove selectors used only by retired outfit controls after source-contract verification.
- `lib/generation-plan.js` — remove new-generation `outfitText` and `activeOutfits` fields while tolerating them in historical artifacts.
- `lib/rp/continuity-shelf.js` — stop resolving or formatting outfit state; retain appearance/reference projection only.
- `lib/rp/image-navigation.js` — navigation only; no generate-at-boundary decision.
- `lib/settings-migration-change.js` — preserve legacy outfit keys unchanged rather than normalizing or deleting them.
- Existing tests that intentionally encode swipe, automatic, cinematic, iteration, or outfit generation behavior.
- `PRODUCT.md`, `README.md`, `DEVELOPER_GUIDE.md`, `docs/ROADMAP.md`, `docs/V2_5_RELEASE_NOTES.md`, and `manifest.json` — reconcile product scope and version only after behavior is verified and overlapping user edits are explicitly coordinated.

Files retained but no longer imported by production code in v2.5:

- `lib/rp/outfit-lock.js`
- `lib/rp/outfit-persistence.js`

Retaining them for one compatibility release keeps historical fixtures readable and makes rollback straightforward. Their physical deletion requires a later ADR and explicit data-retirement approval.

---

### Task 1: Establish status and generation-entry contracts

**Files:**
- Create: `docs/STATUS.md`
- Create: `test/scene-generation-contracts.test.mjs`

**Interfaces:**
- Consumes: accepted ADR-002 terms `wand`, `slash`, `message`, and `preview-gallery`.
- Produces: `GENERATION_SOURCES`, `DELIVERY_DESTINATIONS`, and `normalizeGenerationRequest(value)`.

- [ ] **Step 1: Create the working status ledger**

Write `docs/STATUS.md` with these initial values:

```markdown
# v2.5 Status

## Objective
Implement ADR-002: two generation entry points, one kernel, optional references, and inert legacy outfit data.

## Current milestone
Task 1 — generation-entry contracts.

## Completed
- ADR-002 accepted and corrected to wand + slash.

## Verification
- Not started.

## Failures / open issues
- Live browser UAT is outstanding.
- No paid-provider verification is authorized.

## Decisions
- Settings is configuration-only.
- Legacy outfit data is preserved, not purged.

## Next action
Add failing contracts for the allowed generation sources.
```

- [ ] **Step 2: Write failing contract tests**

Create tests asserting the exact source and destination sets:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_DESTINATIONS,
  GENERATION_SOURCES,
  normalizeGenerationRequest,
} from '../lib/scene-generation/contracts.js';

test('ADR-002 permits only wand and slash generation sources', () => {
  assert.deepEqual(GENERATION_SOURCES, ['wand', 'slash']);
});

test('delivery is explicit for each allowed source', () => {
  assert.deepEqual(DELIVERY_DESTINATIONS, ['message', 'preview-gallery']);
  assert.equal(normalizeGenerationRequest({ source: 'wand', destination: 'message', prompt: 'scene' }).source, 'wand');
  assert.equal(normalizeGenerationRequest({ source: 'slash', destination: 'preview-gallery', prompt: 'castle' }).source, 'slash');
});

for (const source of ['settings', 'swipe', 'automation', 'iteration', 'cinematic', 'director']) {
  test(`rejects ${source} as a generation source`, () => {
    assert.throws(() => normalizeGenerationRequest({ source, destination: 'message', prompt: 'x' }), /Unsupported generation source/);
  });
}
```

- [ ] **Step 3: Run the focused tests and record the expected failure**

Run:

```powershell
node --test test/scene-generation-contracts.test.mjs
```

Expected: FAIL because `lib/scene-generation/contracts.js` does not exist.

- [ ] **Step 4: Implement the contracts module minimally**

Create `lib/scene-generation/contracts.js`:

```js
export const GENERATION_SOURCES = Object.freeze(['wand', 'slash']);
export const DELIVERY_DESTINATIONS = Object.freeze(['message', 'preview-gallery']);

export function normalizeGenerationRequest(value = {}) {
  const source = String(value.source || '');
  const destination = String(value.destination || '');
  const prompt = String(value.prompt || '').trim();
  if (!GENERATION_SOURCES.includes(source)) throw new Error(`Unsupported generation source: ${source || 'missing'}`);
  if (!DELIVERY_DESTINATIONS.includes(destination)) throw new Error(`Unsupported delivery destination: ${destination || 'missing'}`);
  if (!prompt) throw new Error('Generation prompt is required');
  if (source === 'wand' && destination !== 'message') throw new Error('Wand generation requires message delivery');
  if (source === 'slash' && destination !== 'preview-gallery') throw new Error('Slash generation requires preview-gallery delivery');
  return Object.freeze({ ...value, source, destination, prompt });
}
```

- [ ] **Step 5: Run the focused tests**

Run `node --test test/scene-generation-contracts.test.mjs`.

Expected: PASS. No known-red test is committed.

- [ ] **Step 6: Update `docs/STATUS.md` and commit the contract slice**

Stage only the Task 1 allowlist and commit:

```powershell
git add docs/STATUS.md lib/scene-generation/contracts.js test/scene-generation-contracts.test.mjs
git commit -m "test: define v2.5 generation entry contract"
```

---

### Task 2: Extract the Scene Generation kernel with behavior parity

**Files:**
- Create: `lib/scene-generation/kernel.js`
- Create: `test/scene-generation-kernel.test.mjs`

**Interfaces:**
- Consumes: `normalizeGenerationRequest(request)` from Task 1 and injected existing functions for capture, materialization, planning, dispatch, and coordination.
- Produces: `createSceneGenerationKernel(dependencies)` returning `{ generate(request) }`; `generate()` resolves to `{ artifact, plan, request }` and performs no UI mutation itself.

- [ ] **Step 1: Write kernel orchestration tests with fakes**

Cover exact ordering and data flow:

```js
test('kernel captures, contributes references, plans, coordinates, and dispatches once', async () => {
  const calls = [];
  const kernel = createSceneGenerationKernel({
    capture: async request => (calls.push('capture'), { request }),
    collectReferences: async snapshot => (calls.push('references'), { snapshot, assets: {} }),
    createPlan: input => (calls.push('plan'), { input }),
    coordinate: async (_key, run) => (calls.push('coordinate'), run()),
    dispatch: async plan => (calls.push('dispatch'), { imageData: 'AA==', mimeType: 'image/png', plan }),
    generationKey: () => 'wand:chat:message',
  });
  const result = await kernel.generate({ source: 'wand', destination: 'message', prompt: 'scene' });
  assert.deepEqual(calls, ['capture', 'references', 'plan', 'coordinate', 'dispatch']);
  assert.equal(result.artifact.mimeType, 'image/png');
});
```

Also test unsupported sources fail before capture but still pass through `normalizeError`, reference absence is accepted, readiness/dispatch failures are normalized once, and duplicate coordination prevents a second dispatch. Run the same invalid-request, readiness, and dispatch cases through both entry adapters and assert identical normalized error fields.

- [ ] **Step 2: Run the kernel tests and verify failure**

Run `node --test test/scene-generation-kernel.test.mjs`.

Expected: FAIL because the kernel module does not exist.

- [ ] **Step 3: Implement the injected kernel**

Create a small orchestration module:

```js
import { normalizeGenerationRequest } from './contracts.js';

export function createSceneGenerationKernel(dependencies) {
  const { capture, collectReferences, createPlan, coordinate, dispatch, generationKey, normalizeError = error => error } = dependencies;
  return Object.freeze({
    async generate(value) {
      try {
        const request = normalizeGenerationRequest(value);
        const snapshot = await capture(request);
        const references = await collectReferences(snapshot, request);
        const plan = createPlan({ snapshot, references, request });
        const artifact = await coordinate(generationKey(request, snapshot), signal => dispatch(plan, signal));
        return Object.freeze({ artifact, plan, request });
      } catch (error) {
        throw normalizeError(error, 'scene-generation');
      }
    },
  });
}
```

- [ ] **Step 4: Define the production dependency adapter without wiring it**

Document and test the dependency functions that Task 4 will extract from `captureGenerationSnapshot`, `materializeSnapshotAssets`, `buildMessages`, and `generateImageFromPromptInternal`. Use fakes in this task; do not modify `index.js` or route any production caller through the new validator yet.

The kernel is dormant production code until Task 4 atomically wires wand/slash and removes prohibited callers. This avoids inventing a temporary mapping from swipe/automation/iteration/cinematic/Director to an allowed source.

- [ ] **Step 5: Run focused parity tests**

Run:

```powershell
node --test test/scene-generation-kernel.test.mjs test/generation-plan.test.mjs test/generation-coordinator.test.mjs test/provider-dispatch.test.mjs test/run-coordinator-phase-c.test.mjs test/no-spend-uat.test.mjs
```

Expected: PASS with zero provider calls in `no-spend-uat`.

- [ ] **Step 6: Update status and commit**

```powershell
git add lib/scene-generation/kernel.js test/scene-generation-kernel.test.mjs docs/STATUS.md
git commit -m "refactor: extract scene generation kernel"
```

---

### Task 3: Add explicit delivery adapters and thin wand/slash entry adapters

**Files:**
- Create: `lib/scene-generation/delivery.js`
- Create: `test/scene-generation-delivery.test.mjs`

**Interfaces:**
- Consumes: kernel result `{ artifact, plan, request }`.
- Produces: `createMessageDeliveryAdapter(dependencies).deliver(result)` and `createPreviewGalleryDeliveryAdapter(dependencies).deliver(result)`.

- [ ] **Step 1: Write failing delivery tests**

Assert message delivery:

- validates the captured message target before saving;
- saves once and attaches once;
- records Gallery/provenance only after successful attachment;
- rejects a stale chat/message without attaching.

Assert slash delivery:

- saves to Gallery;
- updates `#cig_preview_image`;
- returns the image URL;
- never attaches to a chat message.

- [ ] **Step 2: Run delivery tests and verify failure**

Run `node --test test/scene-generation-delivery.test.mjs`.

- [ ] **Step 3: Implement the two delivery adapters**

Each adapter accepts injected host operations. Neither adapter imports provider modules or reconstructs a generation plan.

```js
export function createPreviewGalleryDeliveryAdapter({ addToGallery, showPreview }) {
  return Object.freeze({
    async deliver({ artifact, plan }) {
      const item = await addToGallery(artifact, plan);
      showPreview(item.url);
      return item.url;
    },
  });
}
```

The message adapter wraps the existing `attachGeneratedImageSafely` behavior without changing attachment metadata.

- [ ] **Step 4: Specify and test wand and slash request factories without production wiring**

Wand constructs:

```js
{ source: 'wand', destination: 'message', prompt, sender, messageId, focusText, target }
```

Slash constructs:

```js
{ source: 'slash', destination: 'preview-gallery', prompt: trimmedPrompt }
```

Add pure request factories that return the two shapes above and test their delivery selection with the fake kernel. Do not modify `index.js` in this task. Task 4 performs the atomic production cutover and removal of prohibited callers.

This is a test-green dormant slice. ADR-002's two-entry milestone is reached only after Task 4.

- [ ] **Step 5: Run focused entry/delivery tests**

Run:

```powershell
node --test test/scene-generation-contracts.test.mjs test/scene-generation-kernel.test.mjs test/scene-generation-delivery.test.mjs
```

- [ ] **Step 6: Update status and commit**

```powershell
git add lib/scene-generation/delivery.js test/scene-generation-delivery.test.mjs docs/STATUS.md
git commit -m "refactor: route wand and slash through scene kernel"
```

---

### Task 4: Remove all secondary generation triggers

**Files:**
- Modify: `index.js:1886-2360`
- Modify: `index.js:3661-3780`
- Modify: `index.js:3940-4235`
- Modify: `index.js:4238-4258`
- Modify: `index.js:4903-4953`
- Modify: `settings.html:83-96`
- Modify: `lib/rp/image-navigation.js`
- Modify: `lib/rp/cinematic-ui.js`
- Create: `test/scene-generation-entrypoints.contract.test.mjs`
- Create: `test/scene-generation-authority.test.mjs`
- Modify: `test/rp-attachment.test.mjs`
- Modify: `test/runtime-plan-wiring.test.mjs`
- Modify: `test/rp-image-navigation.test.mjs`
- Modify: `test/rp-cinematic-integration.contract.test.mjs`
- Modify: `test/rp-iteration-runtime-wiring.test.mjs`

**Interfaces:**
- Consumes: only `sceneGenerationKernel.generate()` from Tasks 2–3.
- Produces: production source in which only wand and slash adapters invoke generation.

- [ ] **Step 1: Write the failing source guard and behavioral authority tests**

The modest source guard asserts absence of the known legacy dispatch functions `autoGenerateForMessage`, `generatePastLastImage`, `dispatchIterationPlan`, direct cinematic dispatch, and dormant Director generation. It also asserts wand and slash registration remain. Do not count `.generate(` strings.

The behavioral authority test mounts the production entry/event adapters with an injected fake kernel and performs these actions:

```js
const dispatched = [];
const fakeArtifact = { imageData: 'AA==', mimeType: 'image/png' };
const fakeKernel = { generate: async request => (dispatched.push(request.source), { artifact: fakeArtifact, plan: {}, request }) };

await harness.clickWand();
await harness.runSlash('a moonlit castle');
await harness.openSettings();
await harness.navigatePastLastImage();
await harness.renderMessageWithAutoPreviouslyEnabled();
await harness.stageCinematicSuggestion();
await harness.openHistoricalIterationArtifact();

assert.deepEqual(dispatched, ['wand', 'slash']);
```

The harness uses exported adapter factories and injected host callbacks; it must not invoke a real provider. Add separate assertions that wand and slash each reach the fake dispatcher exactly once and that rejected source values never reach it.

- [ ] **Step 2: Atomically cut production over to the kernel**

Extract the production dependency adapters from `captureGenerationSnapshot`, `materializeSnapshotAssets`, `buildMessages`, and `generateImageFromPromptInternal`. Compose `sceneGenerationKernel` in `index.js`. Replace wand and slash generation calls with the Task 3 request/delivery adapters in the same change that performs Steps 3–6 below. Do not retain a compatibility wrapper for prohibited invocation names, and do not commit until every step in this task is complete and the focused suite is green.

- [ ] **Step 3: Remove generate-at-boundary swipe behavior**

Delete `generatePastLastImage` and the `regenerate_on_swipe` generation branch. Preserve existing-image previous/next navigation and accessibility. Remove the visible `Generate past the last image` setting while preserving its stored value inertly for rollback.

- [ ] **Step 4: Remove automatic provider dispatch**

Delete `autoGenerateForMessage` and its rendered-message event hooks. Preserve the old `auto_generate` and cinematic settings as inert legacy values; do not silently delete or rewrite them during load.

- [ ] **Step 5: Remove iteration generation wiring**

Remove `dispatchIterationPlan` and generation-capable iteration actions from rendered messages. Preserve old artifact recipes and provenance as readable historical data. Do not delete source images or appearance assets referenced by old recipes.

- [ ] **Step 6: Remove latent cinematic and Director dispatch**

Cinematic suggestions may only stage context for the next wand if retained. Remove any callback that dispatches a provider request and delete stale success copy such as `Cinematic image generated`. Remove dormant Director generation code rather than exposing it in Settings.

- [ ] **Step 7: Run entry-point and affected feature tests**

Run:

```powershell
node --test test/scene-generation-entrypoints.contract.test.mjs test/scene-generation-authority.test.mjs test/scene-generation-contracts.test.mjs test/scene-generation-kernel.test.mjs test/scene-generation-delivery.test.mjs test/rp-attachment.test.mjs test/runtime-plan-wiring.test.mjs test/rp-image-navigation.test.mjs test/rp-cinematic-integration.contract.test.mjs test/rp-cinematic-ui.test.mjs test/rp-iteration-runtime-wiring.test.mjs test/settings-content-contract.test.mjs
```

Expected: PASS; tests must assert removal/inert behavior rather than simply deleting prior assertions.

- [ ] **Step 8: Update status and commit**

```powershell
git add index.js settings.html lib/scene-generation/contracts.js lib/scene-generation/kernel.js lib/scene-generation/delivery.js lib/rp/image-navigation.js lib/rp/cinematic-ui.js test/scene-generation-entrypoints.contract.test.mjs test/scene-generation-authority.test.mjs test/scene-generation-contracts.test.mjs test/scene-generation-kernel.test.mjs test/scene-generation-delivery.test.mjs test/rp-attachment.test.mjs test/runtime-plan-wiring.test.mjs test/rp-image-navigation.test.mjs test/rp-cinematic-integration.contract.test.mjs test/rp-cinematic-ui.test.mjs test/rp-iteration-runtime-wiring.test.mjs test/settings-content-contract.test.mjs docs/STATUS.md
git commit -m "refactor: limit generation to wand and slash"
```

---

### Task 5: Put optional references behind contributors

**Files:**
- Create: `lib/scene-generation/reference-contributors.js`
- Create: `test/scene-generation-reference-contributors.test.mjs`
- Modify: `index.js:1979-2023`
- Modify: `lib/rp/canon-reference-resolver.js`
- Modify: `test/rp-canon-reference-resolver.test.mjs`
- Modify: `test/runtime-plan-wiring.test.mjs`

**Interfaces:**
- Consumes: contributor objects implementing `contribute(snapshot, request) -> Promise<{ references: object[], assets: object, truths: object[], omissions: object[], notices: object[] }>`.
- Produces: `createReferenceContributorPipeline(contributors).collect(snapshot, request)` and three adapters: avatar, previous image, saved appearance.

- [ ] **Step 1: Write contributor tests**

Test:

- zero contributors returns empty references/assets/truths/omissions/notices;
- one failing optional contributor becomes a notice and does not block generation;
- duplicate reference or asset IDs are fatal pipeline invariant errors before planning;
- contributor order is deterministic: avatar, previous image, saved appearance;
- saved appearance is not invoked when its feature is disabled.

- [ ] **Step 2: Run the contributor tests and verify failure**

Run `node --test test/scene-generation-reference-contributors.test.mjs`.

- [ ] **Step 3: Implement the contributor pipeline**

```js
export function createReferenceContributorPipeline(contributors = []) {
  return Object.freeze({
    async collect(snapshot, request) {
      const combined = { references: [], assets: {}, truths: [], omissions: [], notices: [] };
      for (const contributor of contributors) {
        if (!contributor?.enabled?.(snapshot, request)) continue;
        let value;
        try {
          value = await contributor.contribute(snapshot, request);
        } catch (error) {
          combined.notices.push({ contributor: contributor.id, status: 'unavailable', message: String(error?.message || error) });
          continue;
        }
        for (const [id, asset] of Object.entries(value?.assets || {})) {
          if (Object.hasOwn(combined.assets, id)) throw new Error(`Duplicate reference asset: ${id}`);
          combined.assets[id] = asset;
        }
        const knownReferenceIds = new Set(combined.references.map(reference => reference.id));
        for (const reference of value?.references || []) {
          if (!reference?.id || knownReferenceIds.has(reference.id)) throw new Error(`Duplicate or missing reference id: ${reference?.id || 'missing'}`);
          knownReferenceIds.add(reference.id);
          combined.references.push(reference);
        }
        combined.truths.push(...(value?.truths || []));
        combined.omissions.push(...(value?.omissions || []));
        combined.notices.push(...(value?.notices || []));
      }
      return combined;
    },
  });
}
```

- [ ] **Step 4: Move appearance storage knowledge out of kernel capture**

The Scene Generation kernel must no longer read `rp_library`, appearance tombstones, chat appearance pins, or appearance asset paths. The saved-appearance contributor owns those details and returns only normalized references/assets/truths/omissions/notices.

- [ ] **Step 5: Verify absence is non-blocking across both entry points**

Add tests for wand and slash with:

- appearance feature disabled;
- empty appearance library;
- missing appearance asset;
- avatar disabled;
- previous image disabled.

Every case must reach the fake dispatcher with a valid text-only plan unless the chosen provider itself requires a reference.

- [ ] **Step 6: Run focused reference and kernel suites**

```powershell
node --test test/scene-generation-reference-contributors.test.mjs test/scene-generation-kernel.test.mjs test/rp-canon-reference-resolver.test.mjs test/rp-references.test.mjs test/rp-reference-policy.test.mjs test/runtime-plan-wiring.test.mjs
```

- [ ] **Step 7: Update status and commit**

```powershell
git add lib/scene-generation/reference-contributors.js lib/rp/canon-reference-resolver.js index.js test/scene-generation-reference-contributors.test.mjs test/rp-canon-reference-resolver.test.mjs test/runtime-plan-wiring.test.mjs docs/STATUS.md
git commit -m "refactor: make appearance references optional contributors"
```

---

### Task 6: Retire outfit behavior without deleting user data

**Files:**
- Create: `test/outfit-retirement.test.mjs`
- Modify: `index.js:214-215`
- Modify: `index.js:1425-1544`
- Modify: `index.js:2014-2027`
- Modify: `index.js:2061-2068`
- Modify: `index.js:2768-3035`
- Modify: `index.js:3521-3548`
- Modify: `index.js:4876-4897`
- Modify: `settings.html:101`
- Modify: `lib/generation-plan.js`
- Modify: `lib/rp/continuity-shelf.js`
- Modify: `lib/settings-migration-change.js`
- Modify: `test/generation-plan.test.mjs`
- Modify: `test/runtime-plan-wiring.test.mjs`

**Interfaces:**
- Consumes: legacy settings objects that may contain `rp_outfits`, `outfit_pending`, and chat `outfitState`.
- Produces: generation plans with no `outfitText` or new `activeOutfits`; settings/chat save round trips preserve legacy outfit fields by deep structural equality.

- [ ] **Step 1: Write legacy-preservation tests before removing behavior**

Fixtures must contain:

```js
const legacySettings = {
  rp_outfits: { schema: 1, outfits: [{ id: 'outfit:1', identityId: 'char:1', name: 'Evening', description: 'blue coat' }] },
  outfit_pending: { schema: 1, pending: { 'chat:1\u0000char:1': { chatId: 'chat:1', identityId: 'char:1' } } },
};
const legacyChatCanon = {
  outfitState: { schema: 1, bindings: { 'char:1': { activeOutfitId: 'outfit:1', isLocked: true } } },
};
```

Assert settings load/save preserves these values, does not replay pending mutations, does not render outfit controls, and produces a generation plan containing neither `outfitText` nor new `activeOutfits`. Exercise representative extension-settings plus one-to-one and group-chat metadata through the real migration/save seams, then deep-compare `rp_outfits`, `outfit_pending`, and per-chat `outfitState` before and after. Inventory every writer of `CHAT_CANON_KEY` and prove unrelated chat-canon writes retain unknown `outfitState`. Verify a historical artifact containing `activeOutfits` remains readable.

- [ ] **Step 2: Run retirement tests and verify failure**

Run `node --test test/outfit-retirement.test.mjs`.

- [ ] **Step 3: Stop outfit UI and event wiring**

Remove the `cig_chat_outfit_controls` host, `renderChatOutfitControls`, create/select/lock handlers, and visible copy. Do not add a destructive cleanup button in v2.5.

- [ ] **Step 4: Stop outfit prompt and plan influence**

Remove `rp_outfits` and chat `outfitState` from continuity projection. Remove `buildOutfitPrompt`, `outfitText`, and newly written `activeOutfits` from generation planning and provenance. Historical artifact readers must continue accepting an existing `activeOutfits` property.

- [ ] **Step 5: Quarantine pending outfit writes**

Remove `outfit_pending` from recovery scheduling and never call `resumePendingOutfitState`. Preserve the stored queue unchanged. Do not mark it completed, failed, or empty because that would mutate user data.

- [ ] **Step 6: Preserve legacy fields during migration/save**

Remove eager normalization that replaces `rp_outfits` or `outfit_pending` during settings load. Ensure unrelated settings saves spread the existing values through unchanged. Chat canon migrations must preserve unknown `outfitState` without interpreting it.

- [ ] **Step 7: Leave domain modules present but unreachable**

Remove production imports of `outfit-lock.js` and `outfit-persistence.js`. Keep the files and their historical unit tests for one compatibility release. Add a source-contract assertion that production code does not import them.

- [ ] **Step 8: Run retirement, migration, generation, and persistence tests**

```powershell
node --test test/outfit-retirement.test.mjs test/settings-migration-change.test.mjs test/rp-chat-canon.test.mjs test/generation-plan.test.mjs test/runtime-plan-wiring.test.mjs test/rp-outfit-lock.test.mjs test/rp-outfit-persistence.test.mjs
```

- [ ] **Step 9: Update status and commit**

```powershell
git add index.js settings.html lib/generation-plan.js lib/rp/continuity-shelf.js lib/settings-migration-change.js test/outfit-retirement.test.mjs test/generation-plan.test.mjs test/runtime-plan-wiring.test.mjs docs/STATUS.md
git commit -m "refactor: retire outfit behavior without data loss"
```

---

### Task 7: Reconcile settings, styling, version, and documentation

**Files:**
- Modify: `settings.html`
- Modify: `style.css`
- Modify: `manifest.json`
- Modify: `PRODUCT.md`
- Modify with explicit overlap approval: `README.md`
- Modify with explicit overlap approval: `DEVELOPER_GUIDE.md`
- Modify: `docs/ROADMAP.md`
- Create: `docs/V2_5_RELEASE_NOTES.md`
- Modify: `docs/STATUS.md`
- Modify: `test/settings-content-contract.test.mjs`
- Modify: `test/settings-ui-contract.test.mjs`
- Modify: `test/provider-contracts.test.mjs`

**Interfaces:**
- Consumes: verified behavior from Tasks 1–6.
- Produces: release-facing v2.5 documentation and configuration-only Settings UI matching implementation.

- [ ] **Step 1: Write failing settings-content assertions**

Assert Settings:

- includes provider, model, prompt/scene preferences, avatar references, previous-image reference, and optional appearance memory;
- contains no Generate action;
- contains no outfit/attire creation, selection, or lock controls;
- contains no automatic-generation or generate-on-swipe controls;
- does not describe cinematic, iteration, or Story Memory actions as generation entry points.

- [ ] **Step 2: Run settings contract tests and verify failure**

Run `node --test test/settings-content-contract.test.mjs test/settings-ui-contract.test.mjs`.

- [ ] **Step 3: Remove dead styling after selector inventory**

Use `Select-String` to prove each outfit-only selector has no remaining HTML/JavaScript consumer before deleting it. Do not remove shared layout classes.

- [ ] **Step 4: Set the extension version**

Change `manifest.json` version from `1.8.0` to the agreed v2.5 release version. Branch name and extension semantic version are separate; if no semantic version is approved during execution, keep the manifest version unchanged and record that limitation in `docs/STATUS.md`.

- [ ] **Step 5: Present the README/developer-guide overlap manifest and obtain approval**

Compare the baseline diffs captured before branch creation with the changes required by verified v2.5 behavior. Present an exact hunk-by-hunk manifest for `README.md` and `DEVELOPER_GUIDE.md`: pre-existing user hunks to preserve, contradictory claims to replace, and new v2.5 text. Do not edit either file until the user approves this overlap. If approval is not granted, set `docs/STATUS.md` to `NOT READY — primary documentation contradicts v2.5` and stop before a release commit.

- [ ] **Step 6: Reconcile durable documentation**

After overlap approval, use targeted patches and document in `PRODUCT.md`, `README.md`, `DEVELOPER_GUIDE.md`, `docs/ROADMAP.md`, and `docs/V2_5_RELEASE_NOTES.md`:

- wand and slash as the only generation entry points;
- Settings as configuration-only;
- slash aliases and preview/Gallery delivery behavior;
- optional appearance references;
- attire as prompt/scene content;
- legacy outfit data retained inertly for rollback;
- removed automatic/swipe/iteration generation behavior;
- deterministic versus live acceptance evidence.

Do not retain claims that contradict the implemented v2.5 product boundary. After editing, compare each approved pre-existing hunk with the resulting file and demonstrate that unrelated user content remains intact. Record that evidence in `docs/STATUS.md` before staging the files.

- [ ] **Step 7: Run documentation and settings contracts**

```powershell
node --test test/settings-content-contract.test.mjs test/settings-ui-contract.test.mjs test/provider-contracts.test.mjs
git diff --check
```

- [ ] **Step 8: Update status and commit**

```powershell
git add settings.html style.css manifest.json PRODUCT.md README.md DEVELOPER_GUIDE.md docs/ROADMAP.md docs/V2_5_RELEASE_NOTES.md docs/STATUS.md docs/decisions/ADR-002-generation-entry-points-and-continuity-scope.md test/settings-content-contract.test.mjs test/settings-ui-contract.test.mjs test/provider-contracts.test.mjs
git commit -m "docs: align v2.5 with focused generation scope"
```

---

### Task 8: Full deterministic regression and independent critique

**Files:**
- Modify: only files required by demonstrated failures
- Modify: `docs/STATUS.md`

**Interfaces:**
- Consumes: complete v2.5 implementation.
- Produces: deterministic evidence, regression fixes, and an independent review verdict.

- [ ] **Step 1: Run syntax checks**

```powershell
node --check index.js
$sourceFiles = Get-ChildItem lib -Recurse -Filter '*.js' | ForEach-Object FullName
foreach ($file in $sourceFiles) { node --check $file; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

- [ ] **Step 2: Run the complete suite once**

```powershell
$tests = Get-ChildItem test -Filter '*.test.mjs' | ForEach-Object FullName
node --test $tests
```

Record the exact pass/fail/skip count and process exit code in `docs/STATUS.md`. Do not describe deleted assertions as regression proof; every retired behavior needs a positive inertness or absence contract.

- [ ] **Step 3: Critique against an explicit rubric**

Assign an independent reviewer to score:

1. Only wand and slash can initiate provider generation.
2. Both use one kernel for readiness, planning, dispatch, coordination, and errors.
3. Settings cannot generate.
4. Optional references cannot block text-only generation.
5. Appearance storage does not leak into the kernel.
6. Outfit behavior is inactive while legacy data is preserved.
7. No user-owned images or metadata are deleted.
8. Documentation matches implementation and evidence.

Any P0/P1 finding blocks completion. Limit critique/fix cycles to three.

- [ ] **Step 4: Fix demonstrated failures using the smallest coherent change**

For each failure, record symptom, evidence, hypothesis, change, and rerun command in `docs/STATUS.md`. Do not perform opportunistic refactors.

- [ ] **Step 5: Re-run the full suite and diff checks**

```powershell
$tests = Get-ChildItem test -Filter '*.test.mjs' | ForEach-Object FullName
node --test $tests
git diff --check
git status --short
```

- [ ] **Step 6: Commit deterministic acceptance**

Stage only reviewed v2.5 files and commit:

```powershell
git add index.js settings.html style.css manifest.json PRODUCT.md README.md DEVELOPER_GUIDE.md docs/ROADMAP.md docs/V2_5_RELEASE_NOTES.md docs/STATUS.md docs/decisions/ADR-002-generation-entry-points-and-continuity-scope.md lib/generation-plan.js lib/settings-migration-change.js lib/rp/canon-reference-resolver.js lib/rp/cinematic-ui.js lib/rp/continuity-shelf.js lib/rp/image-navigation.js lib/scene-generation/contracts.js lib/scene-generation/kernel.js lib/scene-generation/delivery.js lib/scene-generation/reference-contributors.js test/scene-generation-contracts.test.mjs test/scene-generation-entrypoints.contract.test.mjs test/scene-generation-authority.test.mjs test/scene-generation-kernel.test.mjs test/scene-generation-delivery.test.mjs test/scene-generation-reference-contributors.test.mjs test/outfit-retirement.test.mjs test/generation-plan.test.mjs test/rp-attachment.test.mjs test/rp-canon-reference-resolver.test.mjs test/rp-cinematic-integration.contract.test.mjs test/rp-cinematic-ui.test.mjs test/rp-image-navigation.test.mjs test/rp-iteration-runtime-wiring.test.mjs test/runtime-plan-wiring.test.mjs test/settings-content-contract.test.mjs test/settings-ui-contract.test.mjs test/provider-contracts.test.mjs
git commit -m "test: verify focused v2.5 generation architecture"
```

Before committing, compare this explicit allowlist with `git status --short` and `git diff --name-only`. Stop if it would stage a pre-existing user change not owned by the v2.5 implementation; never use `git add .`.

---

### Task 9: Live SillyTavern acceptance without paid generation

**Files:**
- Modify: `docs/STATUS.md`

**Interfaces:**
- Consumes: deterministic-green v2.5 branch loaded in SillyTavern.
- Produces: live browser evidence for UI, configuration, entry visibility, and no-request behavior.

- [ ] **Step 1: Load v2.5 in the actual host**

Confirm the extension version/branch displayed by the loaded checkout. Capture console and network monitoring before opening Settings.

- [ ] **Step 2: Verify Settings is configuration-only**

At 320px, 360px, 480px, and desktop widths:

- open every extension tab/disclosure;
- confirm no Generate button/action exists;
- confirm no outfit create/select/lock controls exist;
- confirm provider/model and optional reference settings remain reachable;
- keyboard-navigate all retained controls;
- confirm opening/editing Settings sends zero image-generation requests.

- [ ] **Step 3: Verify only the visible entry points without spending**

Confirm the wand button is present and `/proimagine` plus aliases register with help text. Do not activate either against a paid provider. Confirm no automatic request occurs after message rendering, image navigation, cinematic staging, or opening historical iteration/Story Memory content.

- [ ] **Step 4: Record live evidence honestly**

Update `docs/STATUS.md` with screenshots, console state, network observations, viewport coverage, and unverified paid-generation behavior. State explicitly: `Wand generation and message delivery: NOT TESTED live` and `Slash generation and preview/Gallery delivery: NOT TESTED live` unless separate paid-provider authorization is granted.

- [ ] **Step 5: Commit the acceptance record**

```powershell
git add docs/STATUS.md
git commit -m "docs: record v2.5 live no-spend acceptance"
```

## Deferred and separately authorized work

The following are not part of v2.5 implementation:

- purging `rp_outfits`, `outfit_pending`, or per-chat `outfitState`;
- deleting historical appearance assets, Gallery entries, or iteration artifacts;
- paid provider generation or visual-quality benchmarking;
- adding a Settings generation action;
- introducing a new generation entry point;
- physically deleting compatibility modules before one inert-data release has shipped;
- changing slash output from preview/Gallery delivery to chat attachment.

## Rollback strategy

- Each task is independently committed and must leave its focused suite green. Tasks 2–3 are behavior-preserving transitions; only Task 4 reaches the ADR-002 two-entry milestone.
- Compatibility adapters remain until both wand and slash pass through the kernel.
- Legacy outfit data remains untouched, allowing rollback to `v2` without reconstructing data.
- If kernel parity fails, revert only the kernel/adaptation commit; do not revert user-owned documentation or use a broad reset.
- If live host behavior contradicts deterministic tests, mark v2.5 `NOT READY`, preserve evidence, and return to the last green task commit.

---

## Final-review correction round 1 progress — 2026-09-02

**Base:** `06f690d1250bc73bce9eca21ac3d90a979ca96a1` on `codex/v2.5`.

The correction preserves the accepted two-entry architecture and narrows compatibility behavior without deleting or reinterpreting legacy data:

- [x] Preserve existing `sceneFacts.outfits` opaquely through reconciliation and successful wand persistence; ignore interpreted replacements and exclude the field from prompts and deltas.
- [x] Remove active outfit-specific Story Memory collection creation, assignment, and removal while retaining historical outfit collections as visible read-only records.
- [x] Route custom Refresh Models work through the cancellable discovery coordinator and reset busy/disabled/a11y UI state on provider switch even when no coordinator operation is found.
- [x] Correct Settings, README, developer/product/release documentation, ROADMAP, and ADR-002 so cinematic suggestions and Story Memory stage only for the next wand; wand and slash remain the manual generation actions.
- [x] Add failing regression contracts before each production fix and make the focused slices green without live or paid provider calls.
- [ ] Run final affected-suite, syntax, full deterministic, and diff checks.
- [ ] Commit only explicit correction files plus the accepted ADR-002 and this plan; leave `.gitignore`, `AGENTS.md`, ADR-001, images, and unrelated metadata unchanged.

**Current checkpoint:** focused correction slices are green. Full deterministic verification and allowlist commits remain.

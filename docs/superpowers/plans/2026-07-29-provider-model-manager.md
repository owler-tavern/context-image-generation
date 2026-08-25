# Provider Model Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users manage actual provider model IDs locally and fetch/merge models through a shared registry-driven workflow.

**Architecture:** Keep immutable provider defaults and discovery metadata in `lib/providers/registry.js`. Add pure model-list and discovery helpers that project registry defaults plus persisted local entries, then wire the existing selector/settings UI to those helpers. Browser requests remain user-triggered and provider keys are never logged or persisted outside existing provider-key settings.

**Tech Stack:** ES modules, browser `fetch`, jQuery/SillyTavern extension UI, Node built-in test runner.

## Global Constraints

- The selected model ID is sent unchanged as the provider request `model` value.
- Fetch is user-triggered only; no background fetch, retry, or model deletion after failure.
- TokenReply discovery uses `GET /v1/models` only as an Experimental standard OpenAI-style attempt; retain manual model IDs if it fails.
- Fetched/manual OpenAI Images models are text-only and must disable reference images and unverified size controls.
- Preserve LinkAPI Gemini proxy routing, manual legacy recovery, native SillyTavern providers, credentials migration, single-avatar behavior, and swipe regeneration.
- Never log an API key or Authorization header.

---

### Task 1: Build the persisted model-list overlay

**Files:**
- Create: `lib/providers/model-manager.js`
- Create: `test/model-manager.test.mjs`

**Interfaces:**
- Consumes: `getProviderDefinition(providerId)` and `getModelDefinition(providerId, modelId)` from `lib/providers/registry.js`.
- Produces: `normalizeModelId(id)`, `mergeProviderModels(providerId, localEntries)`, and `updateLocalModelEntries(entries, operation)`.

- [ ] **Step 1: Write failing tests for merge, manual IDs, edit, duplicate collapse, and reset**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProviderModels, updateLocalModelEntries } from '../lib/providers/model-manager.js';

test('keeps built-ins and local model IDs while collapsing duplicates', () => {
  const models = mergeProviderModels('tokenreply', [
    { id: ' grok-imagine-image-quality ', source: 'manual' },
    { id: 'custom-image', source: 'manual' },
  ]);
  assert.deepEqual(models.map((model) => model.id), [
    'grok-imagine-image', 'grok-imagine-image-quality', 'custom-image',
  ]);
});

test('edits the actual local model ID and reset removes its local overlay', () => {
  const edited = updateLocalModelEntries([], { type: 'upsert', id: 'grok-imagine-image-quality', source: 'manual' });
  assert.deepEqual(edited, [{ id: 'grok-imagine-image-quality', source: 'manual' }]);
  assert.deepEqual(updateLocalModelEntries(edited, { type: 'remove', id: 'grok-imagine-image-quality' }), []);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/model-manager.test.mjs`

Expected: FAIL because `lib/providers/model-manager.js` does not exist.

- [ ] **Step 3: Implement pure model normalization and overlay helpers**

```js
export function normalizeModelId(id) {
  return typeof id === 'string' ? id.trim() : '';
}

export function updateLocalModelEntries(entries, operation) {
  const current = Array.isArray(entries) ? entries : [];
  const id = normalizeModelId(operation.id);
  if (!id) return current;
  if (operation.type === 'remove') return current.filter((entry) => entry.id !== id);
  return [...current.filter((entry) => entry.id !== id), { id, source: operation.source }];
}
```

`mergeProviderModels` must project registry models first, then normalized local entries; local duplicates do not create duplicate options. For local entries without a declared registry model, attach conservative provider discovery capabilities.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test test/model-manager.test.mjs`

Expected: PASS with all merge/update tests green.

- [ ] **Step 5: Commit the pure overlay layer**

```powershell
git add lib/providers/model-manager.js test/model-manager.test.mjs
git commit -m "feat: add provider model overlay helpers"
```

### Task 2: Add registry-driven model discovery

**Files:**
- Create: `lib/providers/model-discovery.js`
- Create: `test/model-discovery.test.mjs`
- Modify: `lib/providers/registry.js`

**Interfaces:**
- Consumes: provider `ui.modelDiscovery` metadata, provider `openAiImages` base URL, and a caller-supplied `fetchImpl`.
- Produces: `fetchProviderModels({ providerId, apiKey, fetchImpl })` returning normalized `{ id, source: 'fetched' }[]`.

- [ ] **Step 1: Write failing discovery contract tests**

```js
test('requests TokenReply standard models endpoint with caller key only in the request header', async () => {
  const calls = [];
  const models = await fetchProviderModels({
    providerId: 'tokenreply', apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ id: 'grok-imagine-image-quality' }] }), { status: 200 });
    },
  });
  assert.equal(calls[0].url, 'https://api.tokenreply.com/v1/models');
  assert.deepEqual(models, [{ id: 'grok-imagine-image-quality', source: 'fetched' }]);
});

test('filters LinkAPI discovery to image IDs', async () => {
  // response includes `gpt-image-1`, `dall-e-3`, and a non-image ID;
  // expect only the two image IDs.
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/model-discovery.test.mjs`

Expected: FAIL because `lib/providers/model-discovery.js` does not exist.

- [ ] **Step 3: Add discovery metadata and the pure fetch helper**

Registry metadata:

```js
modelDiscovery: {
  endpoint: '/models', responseFormat: 'openai-list', experimental: true,
}
```

Use `new URL(endpoint, baseUrl).toString()` or a normalized join that produces `/v1/models`. Reject non-OK HTTP responses with a safe `Error` containing status plus provider response message; do not log key/header. LinkAPI supplies `filter: 'image'`; TokenReply has no filter and `experimental: true`.

- [ ] **Step 4: Run focused discovery tests and verify they pass**

Run: `node --test test/model-discovery.test.mjs`

Expected: PASS, including endpoint, filtering, empty-ID, and non-OK failure cases.

- [ ] **Step 5: Commit discovery layer and metadata**

```powershell
git add lib/providers/registry.js lib/providers/model-discovery.js test/model-discovery.test.mjs
git commit -m "feat: add registry-driven model discovery"
```

### Task 3: Persist and project managed models in the extension

**Files:**
- Modify: `index.js`
- Modify: `lib/providers/ui-projection.js`
- Modify: `test/provider-ui-projection.test.mjs`
- Modify: `test/provider-dispatch.test.mjs`

**Interfaces:**
- Consumes: `settings.provider_models[providerId]`, model overlay helpers, and discovery helper.
- Produces: selector options projected from built-ins plus local entries; selected model remains unchanged after reload if known locally.

- [ ] **Step 1: Write failing projection and persistence tests**

```js
test('projects a persisted TokenReply custom model without provider-name UI code', () => {
  const ui = projectProviderUi('tokenreply', 'custom-tokenreply-image', {
    localEntries: [{ id: 'custom-tokenreply-image', source: 'manual' }],
  });
  assert.equal(ui.models.at(-1).id, 'custom-tokenreply-image');
  assert.equal(ui.supportsReferenceImages, false);
});
```

Add a dispatch assertion that `custom-tokenreply-image` is sent unchanged as `model` through the generic OpenAI Images dispatcher.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test test/provider-ui-projection.test.mjs test/provider-dispatch.test.mjs`

Expected: FAIL because the projection does not yet accept local entries.

- [ ] **Step 3: Wire settings migration and projection**

Add `provider_models: {}` to defaults and normalize it during `loadSettings`. Pass provider-local entries into the model selector projection. Preserve selected known local/fetched IDs and derive conservative text-only capabilities for undeclared OpenAI Images models. Replace the old LinkAPI-only fetch function with a shared user-triggered fetch/merge handler.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test test/provider-ui-projection.test.mjs test/provider-dispatch.test.mjs`

Expected: PASS; custom TokenReply model is selectable and dispatches unchanged.

- [ ] **Step 5: Commit persistence and selector integration**

```powershell
git add index.js lib/providers/ui-projection.js test/provider-ui-projection.test.mjs test/provider-dispatch.test.mjs
git commit -m "feat: persist managed provider models"
```

### Task 4: Add the Model Manager controls and documentation

**Files:**
- Modify: `settings.html`
- Modify: `index.js`
- Modify: `README.md`
- Modify: `DEVELOPER_GUIDE.md`
- Modify: `docs/PROVIDER_CATALOG.md`
- Modify: `test/provider-catalog.test.mjs`

**Interfaces:**
- Consumes: managed model settings, `fetchProviderModels`, and selector refresh function.
- Produces: user controls for Add, Edit ID, Remove, Reset built-ins, and Fetch models when metadata allows.

- [ ] **Step 1: Write failing source/UI contract tests**

```js
test('documents and exposes the provider Model Manager', async () => {
  const [settings, index, readme] = await Promise.all([
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
  ]);
  assert.match(settings, /id="cig_manage_models"/);
  assert.match(index, /fetchProviderModels/);
  assert.match(readme, /Manage models/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/provider-catalog.test.mjs`

Expected: FAIL because the Model Manager control and documentation do not exist.

- [ ] **Step 3: Implement compact management UI**

Add a collapsed Model Manager section below the model selector. It must:

- render actual IDs with edit/remove buttons;
- add trimmed manual IDs;
- reset a built-in overlay by removing the local entry;
- fetch only when discovery metadata exists;
- merge successful fetched entries and preserve all local ones;
- leave state unchanged on failure and show a safe toast;
- label TokenReply fetch Experimental.

Use the existing debounced setting save and call the shared dropdown refresh after any successful mutation.

- [ ] **Step 4: Run full deterministic verification**

Run: `node --test test/*.test.mjs`

Run: `node --check index.js`

Run: `node --check lib/providers/model-manager.js`

Run: `node --check lib/providers/model-discovery.js`

Run: `git diff --check`

Expected: all contracts pass; syntax and whitespace checks succeed.

- [ ] **Step 5: Update standing documentation and commit**

Document that actual model IDs are editable, fetch merges without deleting manual IDs, and TokenReply discovery remains Experimental/unverified.

```powershell
git add settings.html index.js README.md DEVELOPER_GUIDE.md docs/PROVIDER_CATALOG.md test/provider-catalog.test.mjs
git commit -m "feat: add provider model manager controls"
```

## Final Verification

- [ ] Run `node --test test/*.test.mjs`.
- [ ] Run syntax checks for `index.js` and every `lib/providers/*.js` module.
- [ ] Run `git diff --check provider-adapter-baseline-v1.7.1..HEAD`.
- [ ] Confirm a failed fetch does not alter `provider_models` by test.
- [ ] Do not create a verified-release tag without browser acceptance for LinkAPI and a live TokenReply model/discovery check.
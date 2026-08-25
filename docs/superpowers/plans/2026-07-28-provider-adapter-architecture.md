# Provider Adapter Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor existing LinkAPI generation behind protocol adapters, provide a manual legacy-routing recovery switch, and add TokenReply as an experimental OpenAI Images provider without changing the one-click scene-image workflow.

**Architecture:** Pure modules in `lib/providers/` define provider/model metadata, adapter selection, OpenAI Images request/response normalization, and SillyTavern Gemini proxy request construction. `index.js` remains the SillyTavern integration layer and retains a separately named pre-refactor LinkAPI implementation for the advanced manual fallback. Settings use a scalable provider-key map while mirroring the existing LinkAPI key for rollback compatibility.

**Tech Stack:** Browser ESM, SillyTavern extension APIs, jQuery, Node built-in `node:test`.

## Global Constraints

- Preserve the current one-click message/scene generation workflow.
- Do not change the active SillyTavern Chat Completion profile.
- The LinkAPI Gemini path continues to use SillyTavern's chat-completions backend with a request-scoped reverse proxy.
- Do not silently retry a failed request through legacy routing.
- Keep the existing LinkAPI key readable and write it alongside the provider-key map during the compatibility release.
- Treat TokenReply as experimental until a successful live browser generation is recorded.
- Never log API keys or base64 image payloads.
- No local A1111/ComfyUI, batch/studio, arbitrary scripts, or generic custom API implementation in this slice.

---

## File structure

| File | Responsibility |
| --- | --- |
| Create `lib/providers/registry.js` | Provider/model definitions and transport resolution. |
| Create `lib/providers/openai-images.js` | Generic OpenAI Images request construction and response normalization. |
| Create `lib/providers/gemini-proxy.js` | Pure request-body builder for SillyTavern's Gemini-compatible proxy route. |
| Modify `index.js` | Integrate modules, preserve legacy LinkAPI path, wire settings and adapter dispatch. |
| Modify `settings.html` | Add TokenReply option and LinkAPI advanced legacy-routing control. |
| Modify `README.md` | Explain experimental TokenReply and the recovery setting. |
| Modify `DEVELOPER_GUIDE.md` | Document adapter boundaries, settings migration, and verification. |
| Create `docs/PROVIDER_CATALOG.md` | List Existing, Experimental, Verified, Planned, and Deprecated provider status. |
| Create `test/provider-registry.test.mjs` | Registry and transport-selection contracts. |
| Create `test/openai-images.test.mjs` | OpenAI Images payload and URL/base64 response contracts. |
| Create `test/gemini-proxy.test.mjs` | Gemini proxy request-shaping contract. |
| Create `test/linkapi-compatibility.test.mjs` | Legacy switch, key migration, and static integration contracts. |

### Task 1: Establish an explicit rollback baseline

**Files:**
- Modify: none
- Test: `test/avatar-toggle.contract.test.mjs`

**Interfaces:**
- Consumes: committed `v1.7.1` behavior at `079ff96`.
- Produces: an annotated Git baseline tag and recorded green test output.

- [ ] **Step 1: Run the pre-change regression test**

Run: `node --test test/avatar-toggle.contract.test.mjs`

Expected: one passing test and zero failures.

- [ ] **Step 2: Create the rollback tag**

Run:

```powershell
git tag -a provider-adapter-baseline-v1.7.1 079ff96 -m "Known-good pre-provider-adapter baseline"
git show provider-adapter-baseline-v1.7.1 --no-patch
```

Expected: tag points to `079ff96`, not the feature branch tip.

- [ ] **Step 3: Commit**

No commit is needed; the annotated tag is the rollback artifact.

### Task 2: Define registry and transport contracts

**Files:**
- Create: `lib/providers/registry.js`
- Create: `test/provider-registry.test.mjs`

**Interfaces:**
- Produces: `getProviderDefinition(providerId)`, `getModelDefinition(providerId, modelId)`, and `resolveTransport(providerId, modelId)`.
- Consumes later: only plain provider/model metadata; no SillyTavern imports.

- [ ] **Step 1: Write failing registry tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTransport } from '../lib/providers/registry.js';

test('routes LinkAPI Gemini and OpenAI image models by model contract', () => {
    assert.equal(resolveTransport('linkapi', 'gemini-2.5-flash-image'), 'sillyTavernGeminiProxy');
    assert.equal(resolveTransport('linkapi', 'gpt-image-2-c'), 'openAiImages');
});

test('routes TokenReply Grok through OpenAI Images', () => {
    assert.equal(resolveTransport('tokenreply', 'grok-imagine-image'), 'openAiImages');
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/provider-registry.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimal registry**

```js
export const PROVIDERS = {
    linkapi: {
        id: 'linkapi',
        credentialKey: 'linkapi',
        transports: {
            sillyTavernGeminiProxy: { baseUrl: 'https://api.linkapi.ai' },
            openAiImages: { baseUrl: 'https://linkapi.ai/v1' },
        },
        models: [
            { id: 'gemini-2.5-flash-image', transport: 'sillyTavernGeminiProxy', status: 'existing' },
            { id: 'gpt-image-2-c', transport: 'openAiImages', supportsReferenceImages: false, status: 'existing' },
        ],
    },
    tokenreply: {
        id: 'tokenreply',
        credentialKey: 'tokenreply',
        transports: { openAiImages: { baseUrl: 'https://api.tokenreply.com/v1' } },
        models: [{ id: 'grok-imagine-image', transport: 'openAiImages', supportsReferenceImages: false, status: 'experimental' }],
    },
};
```

Implement an `openAiImages` fallback for LinkAPI IDs matching `/^(gpt-image|dall-e)/i`, so fetched LinkAPI models retain current behavior.

- [ ] **Step 4: Verify the test passes**

Run: `node --test test/provider-registry.test.mjs`

Expected: two passing tests.

- [ ] **Step 5: Commit**

```powershell
git add lib/providers/registry.js test/provider-registry.test.mjs
git commit -m "refactor: add provider transport registry"
```

### Task 3: Extract a generic OpenAI Images adapter

**Files:**
- Create: `lib/providers/openai-images.js`
- Create: `test/openai-images.test.mjs`

**Interfaces:**
- Produces: `buildOpenAiImagesRequest(input)` and `parseOpenAiImagesResponse(json)`.
- Input: `{ model, prompt, size?, responseFormat: 'b64_json' }`.
- Output: request body object or `{ b64, url }`.

- [ ] **Step 1: Write failing adapter tests**

```js
test('omits size when a model has no verified size contract', () => {
    assert.deepEqual(
        buildOpenAiImagesRequest({ model: 'grok-imagine-image', prompt: 'scene', responseFormat: 'b64_json' }),
        { model: 'grok-imagine-image', prompt: 'scene', n: 1, response_format: 'b64_json' },
    );
});

test('accepts either base64 or URL response shapes', () => {
    assert.deepEqual(parseOpenAiImagesResponse({ data: [{ b64_json: 'abc' }] }), { b64: 'abc', url: null });
    assert.deepEqual(parseOpenAiImagesResponse({ data: [{ url: 'https://example.test/image.png' }] }), { b64: null, url: 'https://example.test/image.png' });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/openai-images.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement pure request/response helpers**

Implement only defined request fields. Reject a response that lacks `data[0].b64_json` and `data[0].url`; do not use `innerHTML` or log credentials.

- [ ] **Step 4: Verify the test passes**

Run: `node --test test/openai-images.test.mjs`

Expected: two passing tests.

- [ ] **Step 5: Commit**

```powershell
git add lib/providers/openai-images.js test/openai-images.test.mjs
git commit -m "refactor: add OpenAI Images adapter helpers"
```

### Task 4: Extract Gemini proxy request shaping without changing transport

**Files:**
- Create: `lib/providers/gemini-proxy.js`
- Create: `test/gemini-proxy.test.mjs`

**Interfaces:**
- Produces: `buildGeminiProxyRequest({ model, messages, apiKey, baseUrl, aspectRatio, imageSize, isFlash2, thinkingLevel, useGoogleSearch })`.
- Output: the current SillyTavern backend request body.

- [ ] **Step 1: Write failing parity test**

```js
test('builds the current LinkAPI Gemini proxy request', () => {
    const body = buildGeminiProxyRequest({
        model: 'gemini-3.1-flash-image-preview',
        messages: [{ role: 'user', content: 'scene' }],
        apiKey: 'test-key',
        baseUrl: 'https://api.linkapi.ai',
        aspectRatio: '1:1',
        imageSize: '2K',
        isFlash2: true,
        thinkingLevel: 'low',
        useGoogleSearch: true,
    });
    assert.equal(body.chat_completion_source, 'makersuite');
    assert.equal(body.reverse_proxy, 'https://api.linkapi.ai');
    assert.equal(body.proxy_password, 'test-key');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.enable_web_search, true);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/gemini-proxy.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the builder**

Move the current request-body values exactly: `request_images`, aspect ratio, resolution, `stream: false`, and Flash 2 optional fields. The function must not call `fetch`.

- [ ] **Step 4: Verify the test passes**

Run: `node --test test/gemini-proxy.test.mjs`

Expected: one passing test.

- [ ] **Step 5: Commit**

```powershell
git add lib/providers/gemini-proxy.js test/gemini-proxy.test.mjs
git commit -m "refactor: isolate Gemini proxy request builder"
```

### Task 5: Integrate adapters and retain the legacy LinkAPI implementation

**Files:**
- Modify: `index.js:32-240,524-611`
- Create: `test/linkapi-compatibility.test.mjs`

**Interfaces:**
- Consumes: registry and both adapter helper modules.
- Produces: `generateLegacyLinkApiImage(settings, messages)` and adapter-selected `generateImageFromPrompt()`.

- [ ] **Step 1: Write failing compatibility tests**

```js
test('keeps a named legacy LinkAPI path and a new adapter dispatch path', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /async function generateLegacyLinkApiImage/);
    assert.match(source, /resolveTransport(selectedProvider, settings.model)/);
    assert.match(source, /buildGeminiProxyRequest/);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/linkapi-compatibility.test.mjs`

Expected: assertion failure because the named legacy path and transport resolver are absent.

- [ ] **Step 3: Implement adapter dispatch**

Copy the current LinkAPI behavior into `generateLegacyLinkApiImage()` before altering `generateImageFromPrompt()`. Dispatch normally through `resolveTransport()`:

- `sillyTavernGeminiProxy`: build request with `buildGeminiProxyRequest()`, call the existing SillyTavern backend endpoint, and preserve the existing inline-data/text/no-image response handling.
- `openAiImages`: use the provider transport base URL, current LinkAPI size mapping only when metadata permits size, and normalize the result using the generic helper.
- Existing Google AI Studio and OpenRouter paths remain unchanged.

Do not delete `generateLegacyLinkApiImage()` in this release.

- [ ] **Step 4: Verify green and syntax**

Run:

```powershell
node --test test/provider-registry.test.mjs test/openai-images.test.mjs test/gemini-proxy.test.mjs test/linkapi-compatibility.test.mjs test/avatar-toggle.contract.test.mjs
node --check index.js
```

Expected: all tests pass and syntax check exits zero.

- [ ] **Step 5: Commit**

```powershell
git add index.js test/linkapi-compatibility.test.mjs lib/providers
git commit -m "refactor: route LinkAPI through provider adapters"
```

### Task 6: Add connection-key migration and advanced legacy switch

**Files:**
- Modify: `index.js:defaultSettings,loadSettings,initialization handlers`
- Modify: `settings.html:provider and LinkAPI settings sections`
- Modify: `test/linkapi-compatibility.test.mjs`

**Interfaces:**
- Produces: `getProviderApiKey(settings, providerId)` and `setProviderApiKey(settings, providerId, value)`.
- Settings: `provider_keys`, `linkapi_use_legacy_routing`, and preserved `linkapi_key`.

- [ ] **Step 1: Write failing migration/UI tests**

```js
assert.match(index, /provider_keys/);
assert.match(index, /linkapi_use_legacy_routing/);
assert.match(index, /settings.linkapi_key.*provider_keys.linkapi/);
assert.match(settings, /id="cig_linkapi_use_legacy_routing"/);
assert.match(settings, /Use legacy LinkAPI routing/);
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/linkapi-compatibility.test.mjs`

Expected: assertion failure for the missing settings/migration/UI identifiers.

- [ ] **Step 3: Implement explicit migration and UI behavior**

On load, initialize `provider_keys` as an object. If `provider_keys.linkapi` is absent and `linkapi_key` is non-empty, copy it into `provider_keys.linkapi`. When editing the LinkAPI key, write both values for compatibility. Show a generic provider API-key field for LinkAPI and TokenReply; keep **Fetch models** visible only for LinkAPI. Add the advanced checkbox only in the LinkAPI container and persist it through `saveSettingsDebounced()`.

In `generateImageFromPrompt()`, check `selectedProvider === 'linkapi' && settings.linkapi_use_legacy_routing === true` before normal adapter dispatch. Call the preserved legacy function and do not retry any failed normal call.

- [ ] **Step 4: Verify green and inspect settings migration code**

Run:

```powershell
node --test test/linkapi-compatibility.test.mjs test/avatar-toggle.contract.test.mjs
node --check index.js
rg -n "provider_keys|linkapi_use_legacy_routing|generateLegacyLinkApiImage" index.js settings.html
```

Expected: tests pass; three settings/migration concepts appear in source.

- [ ] **Step 5: Commit**

```powershell
git add index.js settings.html test/linkapi-compatibility.test.mjs
git commit -m "feat: add LinkAPI legacy routing recovery"
```

### Task 7: Add TokenReply as an experimental OpenAI Images profile

**Files:**
- Modify: `lib/providers/registry.js`
- Modify: `index.js:provider UI integration and model dropdown`
- Modify: `settings.html:provider option and API-key copy`
- Modify: `test/provider-registry.test.mjs`
- Modify: `test/openai-images.test.mjs`

**Interfaces:**
- Consumes: `tokenreply` registry profile.
- Produces: built-in `grok-imagine-image` selection using `https://api.tokenreply.com/v1/images/generations`.

- [ ] **Step 1: Write failing TokenReply payload test**

```js
test('TokenReply Grok starts with a minimal experimental Images payload', () => {
    const provider = getProviderDefinition('tokenreply');
    assert.equal(provider.transports.openAiImages.baseUrl, 'https://api.tokenreply.com/v1');
    assert.equal(getModelDefinition('tokenreply', 'grok-imagine-image').supportsReferenceImages, false);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/provider-registry.test.mjs`

Expected: assertion failure until the TokenReply definition is complete.

- [ ] **Step 3: Implement the experimental profile**

Add TokenReply to the provider selector. Supply only `grok-imagine-image`; do not add automatic model discovery. Send the minimal OpenAI Images request without `size`, because TokenReply's accepted `size` versus `resolution` contract is not live-verified. Hide avatar-reference and unverified image-size controls for this model. Mark it Experimental in provider-facing copy.

- [ ] **Step 4: Verify contract tests**

Run:

```powershell
node --test test/provider-registry.test.mjs test/openai-images.test.mjs test/linkapi-compatibility.test.mjs
node --check index.js
```

Expected: all tests pass; no live TokenReply claim is made.

- [ ] **Step 5: Commit**

```powershell
git add lib/providers/registry.js index.js settings.html test/provider-registry.test.mjs test/openai-images.test.mjs
git commit -m "feat: add experimental TokenReply image profile"
```

### Task 8: Document catalog, release evidence, and manual verification

**Files:**
- Create: `docs/PROVIDER_CATALOG.md`
- Modify: `README.md`
- Modify: `DEVELOPER_GUIDE.md`
- Modify: `docs/EXTERNAL_EXTENSION_RESEARCH.md`

**Interfaces:**
- Consumes: final registry provider IDs and statuses.
- Produces: one user-facing status table and maintainer verification procedure.

- [ ] **Step 1: Write failing documentation assertions**

Add a small source/docs contract test that reads `docs/PROVIDER_CATALOG.md` and asserts it contains `LinkAPI`, `TokenReply`, `Existing`, `Experimental`, and `Verified`.

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/provider-catalog.test.mjs`

Expected: module/file-not-found failure.

- [ ] **Step 3: Write the catalog and update docs**

The catalog must list current shipped providers, TokenReply as Experimental, future adapter families as Planned, and local A1111/ComfyUI as Out of scope. README must explain the advanced LinkAPI recovery switch without implying it is automatic. DEVELOPER_GUIDE must explain manual rollback, the provider-key migration, and that one successful TokenReply test-key call is required before changing its status to Verified.

- [ ] **Step 4: Verify all deterministic checks**

Run:

```powershell
node --test test/*.test.mjs
node --check index.js
git diff --check
git status --short
```

Expected: all tests pass, syntax check exits zero, and diff check has no whitespace errors.

- [ ] **Step 5: Run manual browser acceptance checks**

Use non-production keys and record results in the catalog or release evidence:

1. Existing LinkAPI Gemini image model, normal adapter route.
2. Existing LinkAPI `gpt-image*` model, normal adapter route.
3. LinkAPI advanced legacy routing enabled, manual retry route.
4. TokenReply `grok-imagine-image` minimal request, including exact accepted image-size/resolution field and response shape.
5. Invalid-key path for both providers without key disclosure.
6. Reload persistence for provider, model, and credential association.

- [ ] **Step 6: Tag and commit**

```powershell
git add README.md DEVELOPER_GUIDE.md docs test/provider-catalog.test.mjs
git commit -m "docs: publish provider catalog and verification guidance"
git tag -a provider-adapter-v1.8.0 -m "Verified provider adapter release"
```

Create the release tag only if all required browser checks pass. If TokenReply remains unverified, commit the catalog with its Experimental status and do not create the verified-release tag.

## Plan self-review

- **Spec coverage:** Tasks 1-6 cover baseline tagging, adapter families, LinkAPI parity, key migration, manual recovery, and rollback. Task 7 covers TokenReply only as Experimental. Task 8 covers catalog status, deterministic tests, browser evidence, and release tagging. Other external providers remain catalogued rather than prematurely implemented.
- **Placeholder scan:** The plan contains no unspecified implementation steps; every task names files, interfaces, test commands, expected results, and commit boundaries.
- **Type consistency:** Registry exports are `getProviderDefinition`, `getModelDefinition`, and `resolveTransport`; OpenAI helpers are `buildOpenAiImagesRequest` and `parseOpenAiImagesResponse`; Gemini builder is `buildGeminiProxyRequest`. All later tasks use these names.

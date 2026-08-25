# Provider Adapter Architecture Design

**Status:** Proposed
**Date:** 2026-07-28
**Branch:** `feature/provider-adapter-architecture`

## Goal

Add providers without making Context Image Generation harder to use or turning `index.js` into a collection of provider-specific branches.

The user-facing workflow remains:

> Select configuration once in settings, then click Generate on a SillyTavern scene message.

## Product constraints

- Preserve the current one-click scene-image workflow.
- Keep advanced provider details in settings, not in the message-generation UI.
- Preserve existing LinkAPI Gemini and OpenAI-image behavior during the refactor.
- Do not claim a provider works without a live browser verification using a test credential.
- Do not add local A1111/ComfyUI, batch/studio workflows, arbitrary scripts, or broad prompt-system redesign.
- Do not automatically retry a failed paid LinkAPI request through another route; that could create duplicate charges or images.

## Scope

This design establishes the provider architecture and safe rollout process. The first implementation slice includes:

1. Adapter extraction for the existing LinkAPI Gemini-compatible and OpenAI Images paths.
2. A manual advanced setting that selects the pre-refactor LinkAPI path.
3. A TokenReply profile using the OpenAI Images adapter, marked experimental until verified.
4. A provider catalog/status document.

It does not implement every provider identified in external research. Those providers become later profiles or adapters only after their protocol is verified.

## Core decision: standardize by protocol family

Provider brands are not the right abstraction. A provider can expose multiple incompatible protocols; LinkAPI already does.

The extension will standardize at two boundaries:

```text
Provider + model metadata → adapter selection → normalized image result
```

Every adapter returns:

```js
{ imageData, mimeType }
```

The rest of the extension remains unaware of which HTTP endpoint, payload, or response shape produced the image.

### Initial adapter families

| Adapter ID | Purpose | Existing/future providers |
| --- | --- | --- |
| `sillyTavernGeminiProxy` | Uses SillyTavern's chat-completions backend with a request-scoped Gemini-compatible reverse proxy. | Existing LinkAPI Gemini models; compatible Gemini proxies after verification. |
| `openAiImages` | Browser-direct OpenAI Images API request and normalized `b64_json`/URL response handling. | Existing LinkAPI `gpt-image*`/`dall-e*`; TokenReply Grok; direct OpenAI Images; compatible curated/custom proxies. |
| `openAiChatImage` | Browser or SillyTavern request for image-capable `/chat/completions` services. | Future compatible proxies only after one is verified. |
| `urlImage` | Direct image URL request/response with normalized download handling. | Future Pollinations-style provider. |
| `asyncJob` | Submit an image job, poll bounded status endpoints, normalize completed output, and support cancellation when offered. | Future fal.ai, Replicate, and similar providers. |
| `native` | Provider-specific request/response implementation when no standard family applies. | Future NovelAI, Stability, Z.AI, Together, ArliAI, Routeway, Navy, Chutes, or CivitAI only when needed. |

Local A1111/ComfyUI integration is not part of this design.

## Provider and model contracts

A provider is a data-first definition. It declares no UI behavior and does not embed request code.

```js
{
  id: 'linkapi',
  label: 'LinkAPI',
  credentialKey: 'linkapi',
  transports: {
    sillyTavernGeminiProxy: { baseUrl: 'https://api.linkapi.ai' },
    openAiImages: { baseUrl: 'https://linkapi.ai/v1' },
  },
  models: {
    builtIn: [/* model metadata */],
    discovery: { /* optional endpoint and safe filter */ },
  },
}
```

A model selects an adapter and communicates only verified capabilities:

```js
{
  id: 'gpt-image-2-c',
  transport: 'openAiImages',
  supportsReferenceImages: false,
  supportsAspectRatio: true,
  supportsImageSize: true,
  status: 'verified' | 'experimental',
}
```

The adapter owns request construction, authorization headers, response parsing, endpoint-specific errors, and normalized output. UI code reads capability flags; it does not infer behavior from a provider name.

## LinkAPI compatibility and rollback

LinkAPI has one credential but two protocols:

```text
LinkAPI + Gemini image model
  → sillyTavernGeminiProxy
  → SillyTavern chat-completions backend
  → request-scoped https://api.linkapi.ai reverse proxy

LinkAPI + gpt-image*/dall-e* model
  → openAiImages
  → browser POST to https://linkapi.ai/v1/images/generations
```

The Gemini route remains backed by SillyTavern. It is not replaced with a direct browser Gemini call merely to make transports look uniform. Standardization happens at the adapter interface, not by forcing identical HTTP mechanics.

### Advanced manual fallback

The settings UI adds an advanced LinkAPI-only toggle:

```text
Use legacy LinkAPI routing
```

- It is visible only when LinkAPI is selected.
- It selects the preserved, pre-refactor LinkAPI implementation.
- It exists for the first adapterized release and is documented as a recovery control.
- It does not silently retry failed adapter requests. The user toggles it and deliberately retries, preventing duplicate paid generations.
- It is not shown for TokenReply or other providers.

### Rollback layers

1. **Immediate user recovery:** toggle legacy LinkAPI routing and retry manually.
2. **Provider rollback:** each new provider profile lands in its own commit and can be reverted without removing adapter infrastructure.
3. **Refactor rollback:** adapter extraction lands separately after parity tests; it can be reverted to the known `v1.7.1` behavior.
4. **Release rollback:** tag the pre-refactor baseline and each verified release; restore a known version through Git if a broader regression appears.
5. **Configuration rollback:** migrations retain enough information to reconstruct a valid existing LinkAPI selection; they never discard the API key.

## Provider catalog and rollout status

The repository will maintain a catalog with one of these statuses:

- **Existing:** already shipped and supported.
- **Experimental:** implemented but needs live-browser verification for its declared contract.
- **Verified:** contract, browser behavior, and a successful test-key generation are recorded.
- **Planned:** considered but not implemented.
- **Deprecated:** retained for migration/rollback only, with a replacement.

Initial catalog decisions:

| Provider/capability | Adapter family | Initial status |
| --- | --- | --- |
| Google AI Studio / existing Gemini flow | Existing SillyTavern route | Existing |
| OpenRouter | Existing SillyTavern route | Existing |
| LinkAPI Gemini | `sillyTavernGeminiProxy` | Existing, refactor parity required |
| LinkAPI OpenAI image models | `openAiImages` | Existing, refactor parity required |
| TokenReply `grok-imagine-image` | `openAiImages` | Experimental |
| Curated custom OpenAI-compatible endpoint | `openAiImages` | Planned |
| Pollinations | `urlImage` | Planned |
| NanoGPT | To be verified against `openAiImages` | Planned |
| fal.ai / Replicate | `asyncJob` | Planned |
| Other native providers identified in research | `native` or an existing family after verification | Planned |
| A1111 / ComfyUI | Local workflow | Explicitly out of scope |

## Connection and safety model

- A provider connection owns endpoint configuration and credentials.
- Generation settings own prompt behavior, output options, and scene context.
- A future portable preset must not export credentials, custom endpoints, or private reference images.
- Provider model discovery and response data are untrusted. Render model IDs/names through DOM-safe APIs and validate response shape before use.
- Redacted runtime diagnostics may be added later; API keys and base64 image data must never be logged.
- Custom providers initially remain curated. A future arbitrary custom API must use declarative JSON mappings, bounded polling, validated URLs, and separate credentials—not user-supplied code.

## Verification strategy

### Contract tests

- Adapter selection for each provider/model pair.
- Request URL, headers, and payload for each adapter.
- URL and `b64_json` image responses normalize to the same result.
- No API key appears in errors or logs.
- Model discovery cannot create unsafe option markup.
- LinkAPI legacy switch selects only the preserved legacy code path.
- Settings migrations preserve selected provider, model, and credential association.

### Browser verification

For every provider marked Verified:

1. Load settings without console errors.
2. Select the provider and verify its readiness state.
3. Confirm model discovery or built-in model list.
4. Generate one controlled test prompt with a non-production key.
5. Inspect the Network tab to confirm the intended endpoint and no key leakage in app logs.
6. Reload SillyTavern and confirm selection/key association persists.
7. Verify an invalid-key error is understandable and does not reveal the secret.

## Delivery sequence

1. Tag the current `v1.7.1` baseline and record the exact test command/output.
2. Add contract-test scaffolding for adapter selection and LinkAPI parity.
3. Extract existing LinkAPI routes behind adapters with no settings/UI behavior change.
4. Verify parity; commit the adapter extraction separately.
5. Add the advanced legacy LinkAPI-routing setting, migration, and tests; commit separately.
6. Add the TokenReply experimental profile with no claim of support until live verification; commit separately.
7. Add the provider catalog and release notes.
8. Review each later provider as a separate design/test/commit slice.

## Success criteria

- Existing LinkAPI users generate images exactly as before through the default adapter route.
- An advanced setting provides deliberate, manual recovery to the pre-refactor LinkAPI route.
- TokenReply can be added without another provider-specific generation branch.
- The message-level generation workflow remains a single action.
- A future provider is added by writing a profile when it fits an existing adapter, or by adding one isolated adapter when it does not.

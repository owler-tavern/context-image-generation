# External Extension Research: Provider Architecture and Product Learnings

**Status:** Research snapshot, not an implementation plan
**Date:** 2026-07-28
**Purpose:** Preserve what this fork can learn from comparable SillyTavern image-generation extensions before changing its provider architecture.

## Scope and evidence

This document reviews two external repositories as they were publicly available on the date above:

- [Pawtrait](https://github.com/ThatGirl-me/Pawtrait)
- [Quick Image Gen](https://github.com/platberlitz/sillytavern-image-gen)

It records observable repository behavior and documentation. It does not claim that either project's live providers, APIs, or current releases have been independently exercised here. No external code is copied into this repository.

## Current extension baseline

This extension remains intentionally small: a browser-side SillyTavern extension with a thin integration file, one settings template, one stylesheet, focused Node contract tests, and small provider modules. LinkAPI has two distinct transports:

1. Gemini-compatible routing through SillyTavern's chat-completions backend with a request-scoped proxy override.
2. A direct browser OpenAI Images API request for `gpt-image*` and `dall-e*` models.

That split led to the current curated registry and pure adapter helpers. A new provider must not lead to copied UI, credential, model-list, and generation branches throughout `index.js`.

## Implementation status after this research

The extension now has a deliberately limited first adapter slice:

- `lib/providers/registry.js` defines LinkAPI and TokenReply provider/model contracts and resolves `sillyTavernGeminiProxy` or `openAiImages` transport.
- `lib/providers/gemini-proxy.js` preserves LinkAPI's request-scoped SillyTavern Gemini proxy shape.
- `lib/providers/openai-images.js` constructs minimal OpenAI Images payloads and normalizes base64 or URL responses.
- `provider_keys` separates provider credentials while mirroring the legacy LinkAPI key for rollback compatibility.
- LinkAPI has a manual-only advanced legacy route for recovery; it is never an automatic retry.
- TokenReply `grok-imagine-image` and `grok-imagine-image-quality` are implemented only as an Experimental, text-only profile. No live provider generation was recorded in this work.

The authoritative release status and evidence rules live in [PROVIDER_CATALOG.md](PROVIDER_CATALOG.md).

## Pawtrait: useful ideas and limits

Pawtrait presents itself as a multi-provider extension supporting NanoGPT, OpenRouter, LinkAPI, Pollinations, and custom OpenAI-compatible endpoints. Its implementation includes a provider-configuration function, per-provider API keys, fetched model lists, model/runtime profiles, and provider/model transport dispatch.

### What to learn

- **Provider configuration belongs in one registry.** A provider should declare its identity, endpoints, model-discovery behavior, authentication requirements, and default transport in one place.
- **Credentials should be per provider.** Switching provider should reveal that provider's saved key, rather than overwrite one global key.
- **Capability drives UX.** Reference-image support, aspect-ratio choices, image-size controls, and transport decisions should derive from a model/profile capability object, not a brand-name condition scattered in UI handlers.
- **Runtime logging needs redaction.** Pawtrait sanitizes credentials and base64 image data before rendering logs. This is valuable for support and debugging without exposing secrets or huge payloads.
- **Legacy settings need explicit migration.** Its provider-key migration demonstrates the right general rule: add a stable new structure, migrate once, retain compatibility only as long as necessary, then document it.

### What not to copy

- Pawtrait's main implementation is a large, densely coupled file. The registry, model heuristics, UI state, transports, and advanced image tooling are not cleanly isolated. Copying its shape would replace our current small extension with another monolith.
- Its model-family heuristics are useful only as a fallback. Model IDs are provider-controlled strings and should not be the sole source of truth for reference-image or payload support.
- A generic custom endpoint is not automatically safe or supportable merely because it is convenient.

## Quick Image Gen: useful ideas and limits

Quick Image Gen (QIG) has a substantially broader product scope: 18 backends, custom APIs, connection profiles, presets, contextual prompting, local generation, batch/automation workflows, documentation, tests, and an optional server plugin.

### Architecture and product lessons

- **Separate connection from recipe.** QIG keeps provider credentials/model configuration in connection profiles and portable generation settings in presets. For this extension, that means provider endpoints and keys should eventually be separate from prompt/style/image settings.
- **Treat a provider as a capability contract.** QIG exposes provider-specific route modes, payload modes, reference-image modes, and output controls. This confirms that "proxy" is not one universal behavior.
- **Make configuration status visible.** Its UI summarizes the active provider/model and flags incomplete configuration. Our provider selector should eventually show a precise readiness state: no key, invalid endpoint, no selected model, or unsupported model capability.
- **Keep primary workflow simple.** QIG puts the core generation controls first and reveals advanced configuration progressively. We should retain this extension's focused panel rather than surface every adapter option at once.
- **Review and cancel are product features.** Editable prompt stages and cancellation are valuable future ideas, but are not prerequisites for the provider refactor.
- **Use modular source and automated tests at scale.** QIG has `lib/`, `tests/`, `docs/`, a package manifest, and optional server-plugin boundaries. If this extension expands beyond a few adapters, extract provider code into modules with contract tests rather than growing `index.js`.

### Custom API lessons

QIG's most relevant design is its declarative Custom API feature:

- Request mappings are JSON data, not executable scripts.
- Supported transport patterns are explicit: OpenAI-compatible image requests, simple JSON REST, multipart upload, and bounded async job polling.
- JSON Pointer paths describe response extraction.
- Credentials are stored separately from request templates.
- Templates cannot embed credentials.
- Browser-direct requests require CORS support.
- Redirects, unbounded response sizes, and unbounded polling are rejected or limited.
- Sensitive custom definitions are excluded from portable exports/imports so imported presets cannot silently redirect a local credential.

Those are strong boundary rules. They should be adopted if this extension ever exposes arbitrary custom endpoints.

### What not to copy yet

Do not turn this extension into QIG. Its local A1111/ComfyUI support, batch renderer, style catalog, prompt modes, inject mode, custom workflow execution, and optional server plugin are separate products with separate risk and test burdens. The immediate goal is provider extensibility for the existing Context Image Generation workflow.

## Recommended target architecture

Adopt a small provider-adapter registry with two initial protocol families and an escape hatch for a future native adapter.

```text
selected provider + selected model
          |
          v
provider definition + model capability
          |
          +-- OpenAI Images adapter
          +-- Gemini-compatible proxy adapter
          +-- Native adapter (only when neither contract fits)
```

A provider definition should be data-first and should not contain UI logic:

```js
{
  id: 'linkapi',
  label: 'LinkAPI',
  credentials: { kind: 'apiKey', storageKey: 'linkapi' },
  models: {
    builtIn: [...],
    discovery: { endpoint: '...', filter: ... },
  },
  transports: {
    geminiProxy: { baseUrl: 'https://api.linkapi.ai' },
    openAiImages: { baseUrl: 'https://linkapi.ai/v1' },
  },
}
```

A model capability should select transport and constrain the UI:

```js
{
  transport: 'openAiImages' | 'geminiProxy' | 'native',
  supportsReferenceImages: boolean,
  aspectRatios: ['1:1', '3:4', ...],
  imageSizes: [...],
}
```

The adapter owns request construction, response parsing, and normalized errors. The rest of the extension receives the existing normalized result:

```js
{ imageData, mimeType }
```

## Configuration policy

1. Start with curated provider definitions. Every addition has a documented endpoint, authentication form, model-discovery behavior, supported request family, and browser/CORS verification.
2. Provide a generic **OpenAI-compatible image endpoint** only after the adapter contract and validation exist.
3. Do not initially accept arbitrary endpoint behavior or arbitrary JavaScript request transforms.
4. If a broader custom API is added later, use declarative JSON templates and typed response pointers, never user-supplied executable code.
5. Store secrets separately from portable presets. Do not include credentials in logs, exports, image metadata, or imported configuration.
6. Make endpoint mode explicit where inference is ambiguous: `images/generations` versus `chat/completions`, and strict OpenAI payload versus a documented extended payload.
7. Treat third-party model lists and response objects as untrusted input. Sanitize model names for rendering and validate data before using it.

## Test and verification implications

Every adapter needs contract tests independent of a live key:

- Given a provider definition and model capability, verify the selected adapter and request URL.
- Verify the request body and headers never place an API key in logs or prompt text.
- Verify a direct Images response with base64 and one with a URL normalize to the same result.
- Verify model discovery cannot inject HTML into the selector.
- Verify settings migrations preserve a user's selected provider, model, and credential association.
- Verify unsupported reference images are visibly disabled or excluded from requests.
- Add a manual browser checklist for each provider: settings, model discovery, successful generation, error rendering, reload persistence, and Network-tab route confirmation.

A live-provider success is release evidence for that provider only; it does not prove all adapters work.

## Product and UX backlog candidates

These are ideas to evaluate after the provider core is stable, not commitments:

- Per-provider connection profiles separate from generation settings.
- Provider readiness/status line.
- Redacted runtime log export for support.
- Model capability badge: references supported, text-only, model discovery available.
- Prompt review before a paid generation.
- Cancellation and clear pending-state behavior.
- Safer file-backed gallery migration and gallery-path validation.
- Portable presets that omit secrets and private reference images.

## Explicit non-goals for the provider branch

- No local A1111/ComfyUI integration.
- No generic workflow execution.
- No arbitrary user JavaScript.
- No large style-preset catalog or prompt-studio redesign.
- No batch/inject/automation redesign.
- No claim of provider compatibility without a live browser verification using a test credential.

## Decision

Use Pawtrait as a reference for curated provider configuration, per-provider keys, capability-driven UI, and redacted diagnostics. Use QIG as the stronger reference for configuration boundaries, declarative custom API safety, connection-profile separation, documentation, and test discipline.

Implement a deliberately smaller adapter registry for the current two LinkAPI transport families first. Add the next proxy only after it can be expressed by the registry contract or after a narrowly-scoped native adapter is specified and tested.

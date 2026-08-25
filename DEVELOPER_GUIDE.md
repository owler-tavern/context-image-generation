# Developer Guide: Context Image Generation

This is the standing technical reference for people and agents maintaining this extension. It describes the code currently in this repository; it does not replace SillyTavern's own extension API documentation.

## Purpose and ownership

Context Image Generation is a SillyTavern third-party extension that creates scene images from chat context. It can include character and persona details, avatar images, previous generated images, and recent messages in a generation prompt.

This repository is a fork of [elouannd/context-image-generation](https://github.com/elouannd/context-image-generation). The fork's central product decision is to add **LinkAPI** as an image-only provider. Choosing LinkAPI must not require changing the user's active SillyTavern Chat Completion profile.

| Remote | Role |
| --- | --- |
| `origin` (`owler-tavern/context-image-generation`) | This fork; changes should target here. |
| `upstream` (`elouannd/context-image-generation`) | Original project; use for selectively reviewing or bringing in upstream work. |

The manifest version is **1.7.1**. Treat the version comment at the top of `index.js` as stale historical text, not as the release version.

## Repository map

| File | Responsibility |
| --- | --- |
| `index.js` | SillyTavern integration: settings, prompt construction, adapter dispatch, gallery, message controls, auto-generation, and slash commands. |
| `lib/providers/registry.js` | Curated provider/model metadata and adapter transport selection. |
| `lib/providers/openai-images.js` | Pure OpenAI Images request/response helpers. |
| `lib/providers/gemini-proxy.js` | Pure Gemini-compatible SillyTavern proxy request builder. |
| `settings.html` | The extension's settings drawer, including provider credentials, LinkAPI recovery, and model controls. |
| `style.css` | Settings, gallery, and image UI styling. |
| `manifest.json` | SillyTavern extension entry point and published metadata. |
| `README.md` | User-facing installation and feature reference. Keep it concise; put maintainer details here. |

There is currently no package manifest. Node built-in contract tests live in `test/`; run them with `node --test test/*.test.mjs`.

## Runtime model

SillyTavern loads `index.js` as a browser-side extension. At initialization it:

1. Fetches and appends `settings.html` to `#extensions_settings`.
2. Merges `defaultSettings` into `extension_settings['context-image-generation']`.
3. Migrates retired split `use_char_avatar` and `use_user_avatar` settings back to one `use_avatars` setting; either prior enabled preference enables the combined setting.
4. Wires settings events, message controls, slash commands, and chat events.

Settings are saved through SillyTavern's `saveSettingsDebounced()`. Provider credentials are stored in `provider_keys` within the user's SillyTavern extension settings; they are not persisted by this repository or sent to a separate extension server. The compatibility migration creates `provider_keys` when absent and copies a non-empty legacy `linkapi_key` to `provider_keys.linkapi`. Editing the LinkAPI credential mirrors it to both locations during this release, so rollback to the pre-adapter version remains possible.

`fetchedLinkApiModels` is deliberately memory-only. The selected fetched model is retained in settings, and `updateModelDropdown()` re-adds that selected `gpt-image*`/`dall-e*` model after a reload so it does not silently fall back to a Gemini model.

## Provider routing

`generateImageFromPrompt()` first calls `buildMessages()` to assemble the system instruction, context, user prompt, and optional image references. It then chooses one of the following routes.

| Selected provider/model | Transport | Authentication | Reference images |
| --- | --- | --- | --- |
| Google AI Studio (`makersuite`) | SillyTavern `/api/backends/chat-completions/generate` | Active SillyTavern provider configuration | Supported by the normal multimodal message path. |
| OpenRouter | Same SillyTavern backend route | Active SillyTavern provider configuration | Supported by the normal multimodal message path. |
| LinkAPI + Gemini image model | `sillyTavernGeminiProxy`: Same SillyTavern backend route, forced to `chat_completion_source: 'makersuite'` | Per-provider LinkAPI key as `proxy_password`; `reverse_proxy: 'https://api.linkapi.ai'` | Supported by the normal multimodal message path. |
| LinkAPI + `gpt-image*` or `dall-e*` model | `openAiImages`: direct browser `POST` to `https://linkapi.ai/v1/images/generations` | Per-provider LinkAPI bearer token | **Not supported.** All built messages are reduced to plain text. |
| TokenReply + `grok-imagine-image` / `grok-imagine-image-quality` | `openAiImages`: direct browser `POST` to `https://api.tokenreply.com/v1/images/generations` | Per-provider TokenReply bearer token | **Not supported.** Experimental; minimal text-only payload omits image size. |

The LinkAPI Gemini route is intentionally shaped as a Gemini/MakerSuite request because LinkAPI provides a Gemini-compatible proxy. Do not change the active chat-completion profile to make this work; the request-specific `reverse_proxy` and `proxy_password` overrides are the isolation boundary.

The direct OpenAI Images route uses `{ model, prompt, n: 1, response_format: 'b64_json' }`, adding `size` only when the curated model metadata explicitly permits it. It accepts either `b64_json` or a returned URL; a returned URL is fetched and converted to base64 before the extension continues. TokenReply deliberately has no size metadata until live evidence confirms its accepted field.
The normal adapter route adds `size` only when the selected model metadata declares `supportsSize: true`; this is normal adapter behavior, not an endpoint-wide assumption. The retained legacy LinkAPI Images recovery route intentionally maps and sends `size` unconditionally to preserve the pre-adapter request shape. Keep that distinction documented and do not use legacy behavior as evidence that a new provider accepts `size`.


### Important endpoint distinction

The implemented Gemini-compatible proxy is `https://api.linkapi.ai`, while the implemented model-list and OpenAI Images endpoints use `https://linkapi.ai`. This is intentional in the current code. Do not normalize these hosts without first verifying LinkAPI's current behavior in a real browser session.

## Models and UI behavior

`PROVIDER_MODELS` is the built-in allowlist displayed before a model fetch. LinkAPI adds a default `gpt-image-2-c` option. The **Fetch models** control calls `https://linkapi.ai/v1/models`, keeps only IDs beginning with `gpt-image` or `dall-e`, and adds them to the LinkAPI selector for the current page session.

`resolveProviderRoute(providerId, modelId)` is the routing boundary for adapter dispatch. It resolves the curated model metadata (including the LinkAPI `gpt-image`/`dall-e` fallback) and transport; do not make new provider routes depend on the UI-only `isOpenAiImageModel()` predicate. Keep each model capability, including `supportsReferenceImages`, aligned with the controls in `settings.html`.

Aspect ratios map to Images API sizes as follows:

| Requested ratio | Direct Images API size |
| --- | --- |
| `1:1` | `1024x1024` |
| `3:4`, `9:16` | `1024x1536` |
| `4:3`, `16:9` | `1536x1024` |

Gemini image-size, thinking-level, and Google Search controls retain their existing behavior. The latter two are conditionally added only for model IDs matching `gemini-3.1`.

## Image and gallery lifecycle

Generated image data returns from either provider path as `{ imageData, mimeType }`. The extension then uses SillyTavern utilities to attach media to a chat message and to save gallery images as files.

New gallery entries keep file URLs, not full-resolution base64, in extension settings. `galleryItemSrc()` supports both those current `{ url }` items and legacy `{ imageData }` items. `galleryItemToDataUrl()` fetches file-backed items only when an inline data URL is needed (for example, as a previous-image reference). Preserve both paths until a deliberate, user-visible migration is completed.

The gallery is limited to `MAX_GALLERY_SIZE` (50). Prompt text is rendered with text-safe DOM APIs; retain that property when changing gallery markup.

## Security and data-handling rules

- The LinkAPI key is a secret. Do not log it, add it to prompts, commit it, or expose it in UI text.
- LinkAPI requests occur from the browser. Direct Images API requests appear in the browser Network/Console tools rather than the SillyTavern server terminal.
- For LinkAPI Gemini models, user prompt/context and enabled reference images travel to LinkAPI through the SillyTavern backend proxy request. For LinkAPI OpenAI-image models, the combined text prompt travels directly from the browser to LinkAPI; image references do not.
- Do not make model IDs or model-display names into HTML strings. The existing dropdown uses DOM construction because fetched model metadata is external input.

## Safe change procedure

1. Read the relevant provider branch in `generateImageFromPrompt()` and the settings wiring in the initialization block before editing.
2. Preserve the two LinkAPI routes unless the requested change explicitly replaces one of them.
3. When changing a setting, update all three places: `defaultSettings`, `settings.html`, and the load/event wiring in `index.js`.
4. When adding a model family, decide whether it is Gemini-compatible or an OpenAI Images API model. Update routing, UI constraints, and this guide as a single change.
5. Keep `README.md` user-oriented. Update this guide for architecture, safety, or future-maintenance decisions.

## Rollback and provider-status procedure

`provider-adapter-baseline-v1.7.1` is the known-good pre-adapter baseline tag. If a provider-adapter regression needs recovery, first preserve any user settings and local work, then deploy or restore that explicit baseline through the normal Git/SillyTavern workflow. Do not delete `provider_keys`: the compatibility release continues to mirror the LinkAPI credential to `linkapi_key` for this rollback path.

The advanced **Use legacy LinkAPI routing** checkbox is a narrower runtime recovery option. It must be enabled by the user before a new generation and is not a retry mechanism. Keep it manual to avoid duplicate paid requests.

TokenReply remains **Experimental** until one successful non-production test-key generation is recorded. That record must identify the actual accepted image-size/resolution field (or confirm neither), supported response shape, route, invalid-key behavior, and reload persistence, without including any credential or image payload. Only then may its catalog status change to **Verified**.
## Verification checklist

No live-provider request was performed while writing this document. Before claiming a provider change works, verify it with a non-production test key in SillyTavern:

- Load the extension and confirm the settings drawer initializes without console errors.
- Select each provider and confirm the expected built-in model list appears.
- With LinkAPI selected, save a key, fetch models, reload SillyTavern, and confirm a selected fetched model remains selected.
- Generate once with a LinkAPI Gemini model and confirm the request uses the SillyTavern backend path with the LinkAPI proxy override.
- Generate once with a LinkAPI `gpt-image*`/`dall-e*` model and confirm a browser request reaches the direct Images API path and produces an attached image.
- Enable LinkAPI's advanced legacy-routing switch, deliberately perform one manual recovery generation, then disable it again; confirm no failed normal request triggers it automatically.
- With a non-production TokenReply key, generate once with either `grok-imagine-image` or `grok-imagine-image-quality`. Record the accepted size/resolution field and returned image shape before changing its Experimental status.
- Confirm the text-only UI notice is visible for the direct Images API model, and avatar references do not enter that request.
- Confirm both a newly generated file-backed gallery item and an existing legacy base64 gallery item can display and serve as a previous-image reference.
- Exercise an invalid or missing key for both LinkAPI and TokenReply and confirm the error is surfaced without revealing either key.

## Historical implementation milestones

The LinkAPI fork began with Gemini-compatible proxy support (`0d90a1f`). Direct OpenAI Images API support and safe helpers followed (`e06d3a8`, `4eeb2ac`, `2b95ede`), then model discovery, reload preservation, and logging (`6349935`, `2f92489`, `928fb65`). Later fork work added granular avatar toggles, swipe regeneration, and file-backed gallery storage. Refer to Git history for line-level provenance; this guide describes the current combined behavior.

## Provider hardening follow-up

The Model Manager now records the route for a manually added model. For providers with multiple declared transports, choose the matching route before saving: **Gemini-compatible proxy** for Gemini-style models and **OpenAI Images API** for direct Images models. The route is stored with the model ID; it is not guessed later.

TokenReply model discovery keeps only `grok-imagine-image*` IDs. A model-list response containing ordinary chat models therefore cannot add them to the image-model selector.

Generation requests are coordinated by their target. Starting the same message or prompt again while it is already in progress is rejected before a second provider request is sent.

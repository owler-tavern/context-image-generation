# Provider Catalog

This catalog is the user-facing status record for image-generation providers in Context Image Generation. Status describes release evidence, not an assurance that a third-party provider will accept every account, model, or request.

| Provider / capability | Status | What is included | Evidence and limits |
| --- | --- | --- | --- |
| LinkAPI Gemini image models | Existing | Gemini-compatible requests go through SillyTavern's chat-completions backend with a request-scoped LinkAPI proxy. | Retains the existing one-click scene-image workflow and supports the normal multimodal message path. Manual browser acceptance remains required for a particular key/model combination. |
| LinkAPI `gpt-image*` / `dall-e*` models | Existing | OpenAI Images requests use LinkAPI's Images endpoint and a text-only prompt. Fetched matching model IDs use the same transport. | Reference images are not sent. A browser acceptance run is required for a particular key/model combination. |
| LinkAPI legacy routing | Existing recovery option | The Advanced **Use legacy LinkAPI routing** switch invokes the retained pre-adapter route. | It is a deliberate, manual retry only; a failed normal request never automatically falls back, preventing accidental duplicate paid generations. |
| TokenReply `grok-imagine-image` / `grok-imagine-image-quality` | Experimental | A minimal, text-only OpenAI Images request targets `https://api.tokenreply.com/v1/images/generations`. | No live test-key generation has been recorded. Model discovery is an Experimental user-triggered `/v1/models` attempt; the adapter omits image size and references until TokenReply's accepted size/resolution field and response shape are live-verified. |
| OpenAI GPT Image | Experimental | Registry-driven OpenAI Images transport targets `https://api.openai.com/v1/images/generations` with curated GPT Image model IDs. | Static protocol evidence only; direct browser key exposure/CORS and live generation remain unverified. Strict Images reference support is disabled. |
| Pollinations paid JSON | Experimental | Bearer-authenticated `https://gen.pollinations.ai/v1/images/generations` plus native `/image/models` discovery. | Query-string keys are not used. Model IDs do not imply generation or optional capability support; live generation remains unverified. |
| NanoGPT | Experimental | Verified `https://nano-gpt.com/v1/images/generations` transport plus a detailed `/api/v1/image-models?detailed=true` parser seam. | Architecture output metadata may establish image generation; input/reference, multiple-output, and supported-parameter fields remain unknown/disabled until a dedicated adapter is tested. |
| Together AI | Experimental | OpenAI Images-compatible transport targets `https://api.together.xyz/v1/images/generations` with a curated SDXL model. | Static protocol and official endpoint evidence only; references and optional controls remain unknown. |
| Routeway | Experimental | OpenAI Images-compatible transport targets `https://api.routeway.ai/v1/images/generations`; `/v1/models` filters explicit image-output metadata. | Static protocol evidence only; live endpoint/CORS and model capability evidence remain unverified. |
| Navy.ai | Experimental | OpenAI Images-compatible transport targets `https://api.navy/v1/images/generations` with curated model suggestions. | Source-only evidence; response and optional capability contracts remain unknown. |
| Z.AI CogView/GLM Image | Experimental | Dedicated native `POST https://api.z.ai/api/paas/v4/images/generations` adapter with Bearer auth, curated built-in models, provider-default quality, curated `size`, and URL/base64 artifact decoding. | Source and official endpoint evidence only; direct browser key exposure/CORS and live generation remain unverified. Reference images and editing stay unknown/disabled. |
| Fal.ai, Replicate, CivitAI, PixAI, Kie.ai, Midjourney/LegNext | Future Server Adapter | Registry/catalog records only; unavailable until the optional server boundary supports secrets, polling, cancellation, and hosted output retrieval. | No browser runtime calls or local-provider fallbacks are included. |
| ArliAI | Experimental | Dedicated native `POST https://api.arliai.com/v1/txt2img` adapter with Bearer auth, curated built-in SD-style model, source-verified JSON payload, and `images[]` base64 decoding. | Source evidence only; direct browser key exposure/CORS and live generation remain unverified. References/editing are unsupported. |
| NovelAI, Stability AI, Naistera, Chutes | Future Server Adapter | Registry/catalog records only for provider-native binary, legacy, conflicting, or chute-specific routes. | Chutes' generic image endpoint is not a safe curated contract; all require a narrow adapter and server/CORS/security evidence before implementation. |
| Declarative custom hosted APIs | Future Server Adapter | Data-only custom profiles are deferred behind an SSRF-resistant server boundary. | No arbitrary URL, query credential, executable script, or unbounded polling path is exposed. |
| URL-image and async-job adapters | Planned | Future adapter families for providers that do not use the current Gemini proxy or OpenAI Images contracts. | Require a narrow specification and contract tests before implementation. |
| Local A1111 / ComfyUI | Out of scope | No local generation backend is included in this provider branch. | These are separate products with different security, runtime, and test requirements. |

## Status rules

- **Existing** means the capability is shipped in this extension. It is not a claim that every provider account is configured or currently healthy.
- **Experimental** means the UI and deterministic contracts are present, but live browser compatibility has not been recorded for the provider/model combination.
- **Verified** may be assigned only after the documented non-production-key browser checks succeed and release evidence records the request route, accepted request fields, image response shape, invalid-key behavior, and reload persistence. No TokenReply profile is currently Verified.
- **Planned** is an architectural direction, not a commitment or a provider availability claim.
- **Out of scope** explicitly excludes a capability from this provider branch.

## Maintainer release evidence

Before changing a status to **Verified**, record a dated result (without keys, prompts containing private data, or image payloads) for:

1. LinkAPI Gemini through the normal adapter route.
2. LinkAPI `gpt-image*` through the normal OpenAI Images route.
3. The manual LinkAPI legacy-recovery route.
4. TokenReply `grok-imagine-image` and `grok-imagine-image-quality`, including whether `size`, `resolution`, or neither is accepted and whether the response contains base64, a URL, or another supported shape.
5. Invalid-key errors for both providers, confirming no key appears in UI, logs, or recorded evidence.
6. A reload confirming provider, model, and the correct provider credential remain associated.

Use non-production test keys. A successful test for one provider is evidence for that provider only; it does not verify other adapters.

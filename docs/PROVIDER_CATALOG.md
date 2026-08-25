# Provider Catalog

This catalog is the user-facing status record for image-generation providers in Context Image Generation. Status describes release evidence, not an assurance that a third-party provider will accept every account, model, or request.

| Provider / capability | Status | What is included | Evidence and limits |
| --- | --- | --- | --- |
| LinkAPI Gemini image models | Existing | Gemini-compatible requests go through SillyTavern's chat-completions backend with a request-scoped LinkAPI proxy. | Retains the existing one-click scene-image workflow and supports the normal multimodal message path. Manual browser acceptance remains required for a particular key/model combination. |
| LinkAPI `gpt-image*` / `dall-e*` models | Existing | OpenAI Images requests use LinkAPI's Images endpoint and a text-only prompt. Fetched matching model IDs use the same transport. | Reference images are not sent. A browser acceptance run is required for a particular key/model combination. |
| LinkAPI legacy routing | Existing recovery option | The Advanced **Use legacy LinkAPI routing** switch invokes the retained pre-adapter route. | It is a deliberate, manual retry only; a failed normal request never automatically falls back, preventing accidental duplicate paid generations. |
| TokenReply `grok-imagine-image` / `grok-imagine-image-quality` | Experimental | A minimal, text-only OpenAI Images request targets `https://api.tokenreply.com/v1/images/generations`. | No live test-key generation has been recorded. Model discovery is an Experimental user-triggered `/v1/models` attempt; the adapter omits image size and references until TokenReply's accepted size/resolution field and response shape are live-verified. |
| OpenAI-compatible image adapters | Planned | The current adapter boundary can support additional curated OpenAI Images profiles. | Add only after endpoint, auth, CORS, request fields, response shape, capability limits, and browser evidence are documented. |
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
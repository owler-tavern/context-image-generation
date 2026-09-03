# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are SillyTavern roleplayers. They want contextual images during roleplay without needing to understand provider protocols, model capability schemas, request formats, queues, or backend architecture.

Users may bring API credentials for supported hosted providers. Advanced users may add a hosted provider that is not built in, but doing so should not make the ordinary roleplay experience more complicated.

## Product Purpose

Context Image Generation turns the current roleplay scene into an image. The defining interaction is deliberately simple: during roleplay, the user clicks the image-generation button and receives an appropriate image.

Success means sophisticated context selection, provider routing, model alignment, references, retries, and persistence happen reliably while the user's primary action remains obvious and low-effort.

## v2.5 product boundary

ADR-002 defines exactly two generation entry points: the message wand and the `/proimagine` slash command (including its existing aliases). Both use the shared Scene Generation kernel; the wand delivers to the captured message and slash delivers to the preview/Gallery surface.

Settings is configuration-only. It owns provider/model setup, scene preferences, optional avatar/previous-image references, and optional saved-appearance memory. Refresh Models is a configuration action that checks the selected provider and keeps existing local models; it never generates an image.

Cinematic suggestions and Story Memory may stage context only for the next wand; Gallery, Improve tools, and saved appearances remain provider-free support surfaces. None are generation entry points. Attire remains ordinary prompt/scene content. Outfit controls, automatic generation, generate-on-swipe, iteration dispatch, and Director dispatch are retired; legacy outfit data remains inert and preserved for rollback.

## Positioning

The extension combines context-aware SillyTavern integration with a one-click roleplay workflow. Provider breadth and advanced controls are supporting infrastructure, not the experience presented to ordinary users.

## Operating Context

- The extension runs inside SillyTavern during roleplay.
- The primary action begins from a chat message's image-generation control.
- When text inside a roleplay message is selected, the same image-generation control focuses the image on that passage while retaining nearby chat, character, location, and continuity context.
- Initial setup may involve selecting a hosted provider and entering or connecting API credentials.
- Existing providers should retrieve and align their available image models automatically.
- Adding a compatible hosted provider should be possible without source-code changes.

## Capabilities and Constraints

- Preserve one-click contextual generation as the default workflow.
- Support user-provided credentials for existing hosted providers.
- Make hosted-provider addition, model retrieval, and capability alignment easy.
- Learn from the broad feature/provider coverage of reviewed extensions without copying their UI complexity.
- Local-generation systems such as ComfyUI and A1111 are research references, not current product scope.
- Advanced features must not become mandatory setup or clutter the primary roleplay flow.
- Provider/model uncertainty must be communicated without requiring users to understand implementation terminology.
- The project remains a SillyTavern extension; a separate companion service must not be required for the normal hosted-provider path.

## Brand Commitments

The product follows an Apple-like simplicity philosophy: complexity is absorbed by the product, defaults are thoughtful, the primary action is unmistakable, and advanced control is available through progressive disclosure rather than presented up front.

This is a behavioral commitment, not a requirement to imitate Apple's visual styling.

## Evidence on Hand

- The current extension already supports the defining click-to-generate roleplay workflow.
- Local browser inspection on SillyTavern port 8001 showed that hiding model retrieval inside collapsed model management makes an existing feature appear absent.
- Comparative source research is recorded in `LEARNINGS.md`.
- Provider evidence status is recorded separately in `docs/PROVIDER_CATALOG.md`.
- No comparative usability study or generation-quality benchmark has been performed.

## Product Principles

1. **One click is the product.** During roleplay, generating a contextual image must remain one obvious action.
2. **Power without exposure.** Advanced capabilities may be extensive, but appear only when relevant or deliberately requested.
3. **Ready, not configured.** Setup should converge quickly on a working provider and compatible model instead of asking users to assemble a request.
4. **Plain truth over technical leakage.** Explain readiness, limitations, and recovery in user language; keep protocol terminology in Advanced or diagnostics.
5. **No infrastructure tax.** The normal hosted-provider path must not require a second service, dashboard, or local-generation installation.
6. **One product, not assembled features.** New capabilities reuse the same interaction language, data model, generation pipeline, and SillyTavern-native surfaces; they must not appear as provider-specific or borrowed mini-apps.
7. **Quality is systemic.** When an interaction, visual, accessibility, mobile, copy, or state-handling improvement is adopted, apply the same rule everywhere it is relevant across the extension rather than polishing only the new feature.

## Accessibility & Inclusion

Primary actions, status, errors, and advanced disclosures must remain keyboard accessible, readable at narrow/mobile web widths, and understandable without color alone. Provider errors should use plain language and preserve the user's settings and roleplay context.

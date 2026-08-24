# Image-Generation Extension Ecosystem Research

**Status:** Living research record; source evidence, not release verification

**Last updated:** 2026-08-24

**Purpose:** Preserve product, architecture, security, and UX lessons from comparable SillyTavern image-generation projects and international community patterns. Feature commitments and sequencing live in [ROADMAP.md](ROADMAP.md).

## Evidence rules

- **Verified in source** means the behavior was found in repository code.
- **Documented claim** means a README/community source claims it, but it was not exercised.
- **Observed locally** means it was checked in this extension or local SillyTavern UI.
- **Not tested** means no live provider, mobile, image-quality, or end-to-end run was performed.
- Repository snapshots can change; commit-pinned links are used where captured.
- No external code was copied. Ideas must be independently implemented and licenses respected.

## Current-extension findings

### Fetch Models visibility

Observed locally on SillyTavern port 8001: LinkAPI's control exists but is nested inside the collapsed **Manage models** disclosure. A user can reasonably conclude it is absent. This is a discoverability defect, not merely a documentation problem.

Discovery also assumes an OpenAI-style `/models` response and is enabled only for selected providers. A returned ID does not prove image generation, references, editing, sizes, aspect ratios, multiple outputs, or transport support.

### Provider and secret boundary

The extension has two LinkAPI transports: Gemini-compatible SillyTavern proxy and direct OpenAI Images. TokenReply is experimental. LinkAPI/TokenReply credentials are held in browser-side extension settings. Server-managed secrets are safer, but migration needs compatibility and rollback planning.

## Projects reviewed

| Project | Primary lesson | Evidence boundary |
| --- | --- | --- |
| [Quick Image Gen](https://github.com/platberlitz/sillytavern-image-gen) | Provider architecture, connection/preset separation, custom API safety | Source/docs reviewed previously; no live UAT |
| [Pawtrait](https://github.com/ThatGirl-me/Pawtrait) | Curated provider registry, per-provider credentials, capability-driven UX | Source/docs reviewed previously; no live UAT |
| [SLAYimages](https://github.com/wewwaistyping/SLAYimages) | Character/NPC/wardrobe continuity | `main` reviewed 2026-08-24; no live UAT |
| [IkarusAutoImage](https://github.com/IkarusV/IkarusAutoImage) | Tag automation and gallery workflows | `main` reviewed 2026-08-24; no live UAT |
| [Image Generation Suite](https://github.com/maiky93/image-generation-suite/tree/9db8b7dad2a40b2ccc47402cd6bb3de6959b6298) | ComfyUI/A1111 discovery, profiles, LoRAs | `9db8b7d`; syntax checked; no live UAT |
| [0cyris ImageGen](https://github.com/0cyris/SillyTavern-ImageGen/tree/ea470ddfe8116fa573867cfd645bf413e31b1939) | Provider breadth, prompt profiles, capabilities, cancellation | `ea470dd`; syntax checked; no live UAT |
| [Contextual Scene Painter](https://github.com/i5031337/sillytavern-contextual-scene-painter/tree/2c3cd30fb53def280ccb90db5a8a7959cfb043fa) | Context selection, anchoring, scene/background tasks | `2c3cd30`; no live UAT |
| [Picture Prompt](https://github.com/RetroVioletRed/SillyTavern-PicturePrompt/tree/5aa5631d31f1b8d9e0fff7da1b4e7a2b8ebe70f8) | Plan-first references, storage, diagnostics | `5aa5631`; no live UAT; AGPL-3.0 |
| [SD Proxy](https://github.com/platberlitz/sd-proxy) | Server-side multi-backend normalization, queues, progress, local-network access | `main` reviewed 2026-08-24; no deployment/provider UAT |

## Detailed lessons

### Quick Image Gen

Borrow connection/credential separation from portable generation recipes; capability contracts; bounded declarative custom APIs; visible readiness, prompt review, cancellation, and diagnostics; bounded redirects, response sizes, and polling; modular source and tests. Do not import its full batch/style/workflow scope into this focused extension.

### Pawtrait

Borrow centralized provider definitions, per-provider keys, capability-driven controls, redacted diagnostics, and explicit legacy migration. Do not treat model-name heuristics or arbitrary endpoints as authoritative/safe.

### SLAYimages

Source confirms structured inline instructions, character/user/NPC aliases, wardrobe references, multiple looks, cropping, deduplication, reference-aware cleanup, persistent error placeholders, bounded transient retries, mobile transport handling, and `/v1/models` discovery. It sends only real references for characters mentioned in the prompt, with deterministic priority and a five-image cap.

Borrow typed reference roles, alias-aware identities, reference-safe deletion, in-flight guards, persistent failures, and mobile handling. Avoid its approximately 8,000-line monolith, concurrent paid `Promise.all`, absent general Cancel, browser-stored keys/recovery data, silent full-context helper calls, and unresolved AGPL documentation mismatch.

### IkarusAutoImage

Source confirms configurable `[pic prompt="..."]` detection, malformed-tag normalization, main-response/separate-planner modes, injection positions, transformation rules, stable avatar-filename keys, multiple insertion modes, and per-chat gallery. Generation delegates to SillyTavern `/sd`.

Borrow optional planning, stable character keys/migration, tag repair/retrigger, and gallery prompt metadata. Avoid short-lived dedupe, duplicate-prone rescans, temporary chat mutation, and Stop controls that cannot abort active work.

### Image Generation Suite

Source confirms modular components, ComfyUI/A1111 discovery, model/VAE/sampler/scheduler/workflow listing, workflow placeholders, nested profiles, regex triggers, manual retrigger, and optional LLM LoRA selection.

Borrow workflow templates, shared profile components, raw/resolved prompt persistence, and manual recovery. Avoid imported raw-HTML interpolation, credential-bearing exports, full-prompt logging, unused abort signals, silent external classification, unbounded caches, and non-idempotent automation.

### 0cyris SillyTavern-ImageGen

Source confirms broad providers, parallel resource loading, dedicated prompt profiles using their completion presets, dry-run World Info, mode-specific context/reference policies, capability metadata, stoppable loader, abort propagation through most paths, swipe cancellation, and stale-chat checks.

Borrow independent prompt profiles, separate prompt-model/image-model reference controls, capability metadata, per-run controllers, stale guards, server secrets, reference validation, and build-artifact verification. Avoid abort-triggered fallback, server work continuing after client cancellation, discarded multi-image outputs, premature migration markers, and monolithic dispatch.

### Contextual Scene Painter

Source confirms `/drawscene`/`/drawbg`, message anchoring, selectable context, SillyTavern World Info selection, natural-language/tag presets, token budgets, prompt review, serialized profile switching, and background persistence.

Borrow task modes, anchoring, native World Info selection, approval, and serialized restoration. Avoid treating XML delimiters as injection defense, missing lifecycle/error controls, false success without artifacts, and global event mutation for request settings.

### Picture Prompt

This project injects visual context rather than generating images. Its key contribution is one plan selecting avatars, gallery, and lorebook images with labels, caps, detail, and placement; that plan drives injection, estimates, and diagnostics. Source also confirms IndexedDB blobs, quota reporting, repair, preprocessing, import/export, lifecycle cleanup, and status commands.

Borrow one-plan/multiple-consumer architecture, per-source controls, IndexedDB, upload validation, preflight/post-run indicators, and lifecycle cleanup. Avoid uncancellable fetches, ambiguous empty caches, substring routing, missing idempotency, weak import atomicity, and direct code reuse under AGPL-3.0.

### SD Proxy

SD Proxy is a standalone Express service and dashboard exposing an OpenAI-compatible image API over many remote and local backends. Source and documentation show server-side provider normalization, A1111/ComfyUI access, queue/history/gallery/cost APIs, session-scoped progress/log streams, local interruption, model proxying, reverse-proxy endpoints, and login protection.

This server boundary is valuable for work a browser extension cannot safely or reliably own: CORS-restricted calls, loopback/local-network backends, provider secrets, long-running job polling, authoritative queues, upstream cancellation, response-size enforcement, and SSRF controls. Its loopback URL restriction and model-proxy host controls are sound directions.

It should not become a mandatory second application for this extension's basic hosted-provider workflow. A standalone service adds another process, port, login/session, data store, configuration surface, updater, health check, log location, and failure domain. SD Proxy also currently defaults to `admin/admin` and a fixed session secret when environment values are absent, accepts JSON bodies up to 100 MB, and keeps substantial routing in one large server file. Those defaults are acceptable only for explicit local development, never for an automatically exposed service.

Architectural lesson: use a **hybrid optional server adapter**. Keep context selection, `GenerationPlan`, capability UX, message attachment, and gallery integration in the SillyTavern extension. Put only privileged/network/runtime responsibilities behind a narrow SillyTavern server plugin or optional companion service. Hosted providers may continue through supported SillyTavern/native routes; local backends, secret-bearing direct providers, async jobs, and cross-origin discovery can opt into the server adapter. The client and server must share a versioned protocol and normalized result/error contract.

## International ecosystem findings

Public discovery was uneven; these findings are directional, not a complete census.

- **Chinese-language spaces:** recurring interest in ComfyUI, structured tag prompts, post-narrative automation, mutually exclusive modes, and reusable workflows. Favor explicit trigger policies, visible queues, and typed prompt inputs.
- **Korean-language spaces:** publicly indexed SillyTavern material was sparse. Accessible setup, local backends, and fewer hidden steps reinforce localized onboarding and configuration diagnostics; evidence is insufficient for a distinct feature standard.
- **Japanese-language spaces:** local/private prompt transformation, tag workflows, and fine conversion control support local-first planning and inspectable natural-language/tag transforms.
- **Russian-language spaces:** strong patterns include per-message state, cancellation, classified errors, and ranked reference/lore selection. SLAYimages adds deep identity/wardrobe handling and bilingual docs.
- **Spanish/other localized spaces:** localized installation guidance and examples reduce support load. Internationalization should cover UI, provider errors, and docs.

## Cross-project principles

1. **Discovery is not capability.** Normalize model lists and annotate evidence-backed capabilities.
2. **One request plan.** Preview, validation, dispatch, persistence, retry, and diagnostics consume the same plan.
3. **One run coordinator.** Every paid run has an ID, controller, state, concurrency policy, and stale guard.
4. **References are typed assets.** Character, persona, NPC, outfit, lore, and prior-scene assets need role, priority, limit, and provenance.
5. **Secrets belong server-side where possible.** Never include them in portable presets or diagnostics.
6. **Outbound context is visible.** Show which text/images go to which provider.
7. **Automation is opt-in and idempotent.** Repeated events must not repeat paid work.
8. **Success means persisted artifact.** Completion follows normalization, storage, and correct attachment.
9. **Mobile and cancellation are lifecycle requirements.**
10. **Respect licenses.** Independently implement AGPL-derived ideas unless obligations are deliberately adopted.
11. **Server boundaries are capability-driven.** Do not require a companion service where SillyTavern already provides a safe route; do not force privileged work into the browser merely to avoid one.

## Product North Star and scope filter

The research catalogue is intentionally broader than the planned product. The North Star is: **during roleplay, click the image-generation button and receive a contextually appropriate image**. Provider breadth, reference systems, diagnostics, automation, and backend engineering are valuable only when they preserve or improve that simple interaction.

Near-term provider work is limited to hosted services. ComfyUI, A1111, Forge, local checkpoints, LoRAs, ControlNet, and workflow execution remain useful research sources but are outside the current planning horizon. Their presence in reviewed projects is not a commitment to expose them in this extension.

Feature evaluation follows progressive disclosure:

- Primary roleplay surface: one obvious Generate action and clear progress/result.
- Selected-text variation: highlighting part of a roleplay message makes that passage the primary image subject; the same wand is used and nearby context still supplies characters, location, and continuity.
- Normal setup: provider, credential, automatic connection/model retrieval, ready state.
- Advanced: custom hosted-provider format, endpoint details, capability overrides, diagnostics.
- Internal only: adapter selection, request normalization, queues, retry policy, and capability evidence mechanics.

## Target architecture

```text
Context selection + typed references
                 |
          GenerationPlan
                 |
        capability validation
                 |
       provider adapter registry
                 |
          RunCoordinator
                 |
     normalized artifact/error
                 |
 message attachment + gallery + diagnostics
```

Provider definitions own discovery, authentication mode, transports, and normalization. Model entries own capability claims and evidence. The plan owns intent. The coordinator owns time, cancellation, idempotency, and persistence boundaries.

## Research gaps

- Live LinkAPI and TokenReply model/request verification with non-production keys.
- Browser/mobile UAT for the six newly reviewed projects.
- Current SillyTavern server-secret integration design for third-party extensions.
- Provider pricing/cost-estimate availability.
- Measured generation-quality comparisons.
- Broader discovery in private or poorly indexed Asian communities.

These gaps remain roadmap acceptance criteria, not compatibility claims.

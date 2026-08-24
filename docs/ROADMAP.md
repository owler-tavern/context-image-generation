# Context Image Generation Roadmap

**Status:** Proposed roadmap; implementation has not begun unless marked Existing

**Date:** 2026-08-24

**Research basis:** [Ecosystem Research](EXTERNAL_EXTENSION_RESEARCH.md)

**Release evidence:** [Provider Catalog](PROVIDER_CATALOG.md)

## North Star

> During roleplay, click the image-generation button and receive a contextually appropriate image.

The extension may support many providers and sophisticated capabilities, but that complexity must be absorbed by the product. The ordinary user should not need to understand API protocols, capability schemas, queues, prompt construction, or backend topology.

Every roadmap feature must pass these product gates:

1. Does the primary roleplay workflow remain one obvious click?
2. Is the feature invisible until relevant or deliberately opened?
3. Can the extension choose a safe, compatible default automatically?
4. Are status and recovery expressed in plain user language?
5. Does the normal hosted-provider path work without a companion service?

If a feature fails a gate, it must be redesigned, restricted to Advanced, or deferred.

## Status and evidence rules

- **Existing**: present now; not necessarily live-provider verified.
- **Experimental**: deterministic implementation exists, live contract incomplete.
- **Next**: intended next planning order, not a completion claim.
- **Later**: depends on earlier foundations.
- **Research**: needs evidence/design before implementation.
- Deterministic behavior requires automated contracts; provider behavior requires separate sanitized live evidence.

## Current baseline — v1.7.1

| Capability | Status | Evidence boundary |
| --- | --- | --- |
| LinkAPI Gemini-compatible and direct Images routes | Existing | Adapter contracts; live account acceptance is separate |
| TokenReply text-only profiles | Experimental | No recorded live generation |
| File-backed gallery with legacy base64 support | Existing | Contract behavior; browser acceptance separate |
| Message, slash, auto-generate, and swipe triggers | Existing | Local implementation/contracts |
| Per-target in-flight duplicate guard | Existing | Not a complete run state machine |
| Fetch Models inside Manage models | Existing, poorly discoverable | Observed locally on port 8001 with collapsed parent |

## v1.8 — Visible, trustworthy provider discovery

**Goal:** Enable discovery for every provider without presenting returned model IDs as proven image capabilities.

| ID | Feature | Status | Learned from | Dependencies | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| R1 | Always-visible **Refresh Models** beside model selector | Next | Local 8001 defect; Pawtrait; QIG | None | Desktop/mobile browser and keyboard checks for every provider state |
| R2 | Provider discovery adapter contract | Next | QIG; Pawtrait; IGS; 0cyris | R1 | Contracts for OpenAI-list, native, static, and unsupported discovery |
| R3 | Discovery loading, cancel, stale-response, and retry states | Next | 0cyris; Russian ecosystem | R2 | Abort/race tests and browser verification |
| R4 | Non-destructive merge, refresh time, and source label | Next | Current behavior; Picture Prompt | R2 | Local entries survive success, empty response, and failure |
| R5 | Capability badges with evidence confidence | Next | 0cyris; ecosystem principle | R2 | UI distinguishes API, curated, heuristic, and unknown evidence |
| R6 | Search/filter and unsupported-model warning | Next | Broad-provider projects | R5 | Unknown models never silently enable unsupported controls |
| R7 | LinkAPI/TokenReply live discovery record | Research | Current evidence gaps | R2-R6 | Sanitized non-production-key result before status change |

Normalized models should carry equivalent data:

```js
{
  id,
  label,
  providerId,
  transport,
  capabilities: {
    imageGeneration,
    referenceImages,
    editing,
    multipleOutputs,
    aspectRatios,
    sizes,
  },
  evidence: { source, confidence, observedAt },
}
```

Unknown is a valid capability value; missing metadata must not become `true`.

## v1.9 — Safe lifecycle and preflight

**Goal:** Make every paid request inspectable, cancellable, idempotent, and safe from cross-chat persistence.

| ID | Feature | Status | Learned from | Dependencies | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| R8 | Immutable-ish `GenerationPlan` | Next | Picture Prompt; Scene Painter | v1.8 model contract | Preview and dispatch consume the same effective plan |
| R9 | Preflight: prompt, context, references, provider/model/options | Next | Picture Prompt; QIG | R8 | Browser shows exact outbound inputs before send |
| R10 | `RunCoordinator` state machine | Next | 0cyris; SLAY; Russian ecosystem | R8 | Queued/running/cancelling/failed/completed/stale tests |
| R11 | End-to-end abort propagation | Next | 0cyris strengths/defect | R10 | Cancel reaches all layers and never starts fallback |
| R12 | Bounded concurrency and removable queue | Next | SLAY concurrency risk | R10 | Maximum never exceeded; queued request can be removed |
| R13 | Durable generation ID and event idempotency | Next | Ikarus; IGS | R8-R10 | Duplicate events/rescans cause no second paid request |
| R14 | Stale chat/message guard before save | Next | 0cyris | R10 | Result cannot attach to the wrong chat/message |
| R15 | Normalized errors and bounded transient retry | Next | SLAY; Russian ecosystem | R10 | Auth/validation never retry; network/429/5xx follow policy |
| R16 | Redacted diagnostics export | Next | Pawtrait; Picture Prompt | R8-R15 | Keys, headers, base64, and private context excluded/redacted |
| R17 | Server-side secret migration design | Research | SillyTavern guidance; 0cyris | None | ADR covers compatibility, rollback, exports, and logs |
| R43 | Selected-text image focus using the existing wand | Next | Historical `feature/selected-text-image-prompt` branch; confirmed product decision | R8, R13 | Selected passage is the primary subject; nearby chat supplies identity, location, and continuity; no second persistent button |

## v2.0 — Visual identity and continuity

**Goal:** Replace incidental previous-image continuity with managed identities and typed references.

| ID | Feature | Status | Learned from | Dependencies | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| R18 | Typed reference library | Later | SLAY; Picture Prompt | R8 | Character/persona/NPC/outfit/lore/prior-scene roles tested |
| R19 | Aliases and multiple looks per identity | Later | SLAY | R18 | Unicode-aware matching and selected-look preview |
| R20 | Deterministic ranking and provider caps | Later | SLAY; Russian ecosystem | R5, R18 | Same input selects same assets; omissions explained |
| R21 | Per-source enablement, detail, and recipient preview | Later | Picture Prompt; 0cyris | R9, R18 | Prompt-model and image-model recipients distinguished |
| R22 | Upload validation/preprocessing | Later | Picture Prompt | R18 | Decode/type/size/dimension limits and optional conversion |
| R23 | Quota, orphan repair, reference-safe deletion | Later | Picture Prompt; SLAY | R18 | Shared assets survive; missing/unused assets reportable |
| R24 | Versioned continuity metadata | Later | Cross-project synthesis | R18-R20 | Artifacts record references, prompt version, capabilities |
| R25 | Gallery metadata and reproducible regeneration | Later | Ikarus; IGS | R8, R24 | Raw/effective prompt, options, model, source are inspectable |

## v2.1 — Context and controlled automation

**Goal:** Expand automation without hidden outbound calls, duplicated cost, or uncontrolled context sharing.

| ID | Feature | Status | Learned from | Dependencies | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| R26 | Message anchoring and scene/background modes | Later | Scene Painter | R8-R10 | Context deterministic for selected message |
| R27 | Natural-language and tag transforms | Later | Chinese/Japanese spaces; Scene Painter | R8 | Transform previewable and reversible |
| R28 | Optional separate prompt-planner profile | Later | Ikarus; 0cyris | R9, R17 | Provider/context disclosed; cancel propagates |
| R29 | Structured automatic trigger policies | Later | Chinese spaces; Ikarus; IGS | R10, R13 | Modes are explicit, mutually coherent, idempotent |
| R30 | Prompt repair and manual retrigger | Later | Ikarus; IGS | R13 | Retry reuses or deliberately versions generation ID |
| R31 | World Info selection through SillyTavern APIs | Later | Scene Painter; Picture Prompt | R8 | Only active entries selected |
| R32 | Prompt-injection-aware context policy | Later | Scene Painter risk | R8, R9 | Untrusted context cannot override task policy in fixtures |

## v2.2 — Hosted-provider portability

**Goal:** Make hosted-provider addition portable and safe after discovery and lifecycle contracts stabilize. Local-generation systems remain outside the current planning horizon.

| ID | Feature | Status | Learned from | Dependencies | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| R33 | ComfyUI patterns retained as research only | Deferred | IGS; Chinese spaces | None | No product implementation planned in the current horizon |
| R34 | A1111/local diffusion retained as research only | Deferred | IGS; `/sd` delegates | None | No product implementation planned in the current horizon |
| R35 | Connections separate from generation presets | Later | QIG; IGS | R17 | Exports omit keys/private assets by default |
| R36 | Declarative custom API profiles | Research/Later | QIG | R2, R10, R17 | No scripts; bounded polling/redirect/body/response |
| R37 | Localized UI, errors, and setup guides | Later | International research | Stable copy | Translation fallback and prioritized locales tested |
| R38 | Validated import/export with rollback | Later | Picture Prompt; IGS risks | R18, R35 | Size/count/type/schema limits; failures preserve state |
| R39 | Versioned optional server-adapter protocol | Research/Later | SD Proxy; 0cyris server plugin | R8, R10, R17 | Capability negotiation, health/version check, normalized results/errors |
| R40 | SillyTavern server plugin for privileged transports | Research/Later | SD Proxy hybrid lesson | R17, R39 | Secrets remain server-side; hosted/basic workflow works without companion service |
| R41 | Server-side queue, progress, cancellation, and async polling | Research/Later | SD Proxy | R10, R39-R40 | Restart/reconnect behavior, bounded polling, upstream abort, stale-job tests |
| R42 | Remote custom-endpoint safety policy | Research/Later | SD Proxy host controls; QIG | R36, R40 | Default-deny private/local targets, allowlist, size/time limits |

## Explicit deferrals and rejections

| Item | Decision | Reason |
| --- | --- | --- |
| Unbounded parallel tag generation | Rejected | Cost/rate-limit risk |
| Automatic paid fallback after failure | Rejected | May double-charge and violate cancellation |
| Executable JavaScript custom adapters | Rejected | Unsafe execution/credential boundary |
| Credentials in preset/profile exports | Rejected | Secret leakage |
| Model-name heuristic as authoritative capability | Rejected | IDs do not prove behavior |
| Silent full-chat helper-model calls | Rejected | Privacy/cost boundary |
| Copying AGPL implementation code | Rejected unless licensing changes | Project currently uses The Unlicense |
| Style marketplace/batch studio before lifecycle work | Deferred | Separate scope; foundations first |
| ComfyUI, A1111, Forge, LoRA, and ControlNet product support | Deferred outside current horizon | Current focus is straightforward hosted-provider setup and one-click RP generation |
| Visual-quality claims from repository review | Rejected | No comparative generation UAT |

## Feature traceability

| Research source | Roadmap features |
| --- | --- |
| Local LinkAPI/8001 observation | R1, R3, R4, R7 |
| Historical selected-text feature branch and confirmed interaction | R43 |
| Quick Image Gen | R2, R6, R9, R16, R35, R36 |
| Pawtrait | R2, R5, R16, R17 |
| SLAYimages | R10, R12, R15, R18-R20, R23 |
| IkarusAutoImage | R13, R25, R28-R30 |
| Image Generation Suite | R25, R29, R30, R33-R35 |
| 0cyris ImageGen | R5, R10-R11, R14, R17, R21, R28 |
| Contextual Scene Painter | R8-R9, R26, R31-R32 |
| Picture Prompt | R8-R9, R16, R18, R21-R23, R38 |
| Chinese/Japanese findings | R27, R29, R33, R37 |
| Korean/international onboarding | R6, R16, R37 |
| Russian findings | R10, R15, R20 |
| SD Proxy | R17, R33-R36, R39-R42 |

## Release gates

1. Deterministic unit/contract tests pass.
2. `git diff --check` passes.
3. Settings migration preserves provider/model/key associations.
4. Browser UAT covers desktop and narrow/mobile viewport.
5. Invalid-key/provider errors reveal no credentials.
6. Cancellation is verified through every involved layer.
7. Completion is reported only after correct storage and attachment.
8. Live-provider status changes are recorded in `PROVIDER_CATALOG.md` with date, route, and limits.
9. README, Developer Guide, Provider Catalog, research, and roadmap use consistent names/statuses.

## Immediate planning boundary

The next implementation specification should cover **v1.8 only**. Discovery, capability evidence, and visible UX are one independently reviewable subsystem. v1.9 lifecycle work should receive a separate specification after v1.8 interfaces are accepted. The optional server boundary (R39-R42) must not become a prerequisite for the basic hosted-provider path without a separate accepted ADR.

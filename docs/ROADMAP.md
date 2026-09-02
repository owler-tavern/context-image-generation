# Context Image Generation Product Roadmap

**Status:** Private working roadmap and evidence ledger. Implemented items are not release claims until their listed acceptance evidence is complete.

**Updated:** 2026-09-01

**Research basis:** `LEARNINGS.md`

## Product promise

> Turn the roleplay moment the user cares about into a visually continuous image, without leaving the conversation or becoming an image-generation operator.

This roadmap is organized around user value. Provider adapters, storage contracts, cancellation, queues, migrations, and diagnostics are enabling work or acceptance criteria. They are not product milestones by themselves.

## Product strategy

The extension should win on five things:

1. **The same character still looks like the same character.**
2. **The extension interprets the exact story moment with minimal user setup.**
3. **An almost-right image is easy to improve rather than discard.**
4. **Generated images become a usable visual memory of the story.**
5. **Automation reacts to meaningful story changes, not arbitrary message counts.**

Provider breadth is necessary infrastructure, but it is not the differentiator. Quick Image Gen and SD Proxy already serve users who want a broad image studio. This extension should remain roleplay-native and progressively disclose control.

## Current implementation — v2.5 scope / extension v1.8.0

The current branch contains the provider foundation and deterministic implementations of the retained P1-P6 flows. ADR-002 v2.5 narrows the active generation boundary to the message wand and `/proimagine` slash command, both routed through one Scene Generation kernel. At `410a6c6`, the expanded deterministic suite was green at **790/790**; later Task 6 correction evidence is recorded in `docs/STATUS.md`. This is **PROVEN deterministic** evidence for the listed contracts and production wiring; it does not by itself prove the promised player outcomes in a real host.

Real-host UAT has confirmed LinkAPI discovery with four usable models, populated Story Memory, cinematic manual retrigger/adjust/dismiss, provider-free Settings editing, five exact-message image attachments, and extension-owned 320/360/480px panel fit. The old per-message **Direct this scene** and **Visual Story** entries are intentionally removed: the message wand and `/proimagine` slash command are the only generation actions, while direction and character-source choices live in Settings. LinkAPI's public `/api/pricing` returned `model_price: 0.09375` for `gemini-3.1-flash-image-preview` on 2026-09-01, but the benchmark remains a quality failure, not a release claim.

This is **not yet a complete release claim**. The controlled benchmark allowed at most seven paid images and USD $0.65625; six originals were produced, but the two-character sequence is invalid because the persona changed between scenes and the quality scorecard is P1/failing. Some live interaction and focus/reload evidence also remains incomplete or conflicting. Settings is configuration-only; optional story tools stage context but never add a generation entry point. Legacy outfit data remains inert and preserved.

Evidence labels used in this ledger are **PROVEN deterministic** (repeatable local tests), **PROVEN live** (observed in the loaded SillyTavern host), **PARTIAL** (some acceptance evidence exists), **NOT TESTED** (no current evidence), **CONTRADICTED** (evidence conflicts with the intended outcome), and **DEFERRED** (explicitly outside the current release slice).

Classification used below:

- **A — net-new player capability:** changes what a player can do or the story outcome they can obtain.
- **B — improved packaging/discoverability:** makes an existing capability clearer, safer, or easier to reach.
- **C — enabling work:** required architecture, provider, persistence, or safety work; not a customer milestone by itself.

| Priority | Customer feature | Product classification | Current evidence | Remaining acceptance |
| --- | --- | --- | --- | --- |
| P0 | Trustworthy provider/model selection and custom connections | Mostly C; setup clarity is B | **PARTIAL:** deterministic route/discovery/no-spend contracts; **PROVEN live:** LinkAPI refresh returned four models with no generation request (`test/provider-*`, `test/model-*`, `test/no-spend-uat.test.mjs`) | **NOT TESTED:** distinct live LinkAPI route selection, one custom OpenAI connection, and one custom Gemini connection; TokenReply Nano route is **DEFERRED** |
| P1 | Appearance truth, remembered looks, and explainable continuity | A for multi-character/reference planning; B for avatar/description controls and reference explanations. Outfit controls and persisted outfit state are retired in v2.5. | **PARTIAL:** deterministic continuity/canon/reference contracts, current-chat identity isolation, Settings readiness, final-plan receipts, and inert legacy-data preservation (`test/rp-appearance-*.test.mjs`, `test/rp-reference-*.test.mjs`, `test/outfit-retirement.test.mjs`); **PARTIAL live:** three single-character and two two-character attachments, but the benchmark quality scorecard is P1/failing | **NOT TESTED:** valid replacement two-character sequence after persona correction, scored identity retention, lock persistence, and live receipt comprehension |
| P2 | Selected-passage/current-message scene interpretation | A for state delta, cast resolution, and artifact inspection; B for pre-existing selected-text/clicked-message/default controls | **PROVEN deterministic:** scene interpretation, selected-focus precedence, plan/artifact inspection (`test/rp-scene-*.test.mjs`, `test/generation-plan.test.mjs`, `test/runtime-plan-wiring.test.mjs`); **PARTIAL live:** exact-message attachments exercise planning | **NOT TESTED:** direct live selected-passage UAT and comparative subject-accuracy evidence |
| P3 | Improve, Vary, change scene, edit, reuse, and make canonical | Future/retained artifact workflows; v2.5 does not expose iteration as a generation entry point, and swipe navigation is navigation-only. | **PROVEN deterministic:** historical iteration artifact contracts and inert runtime wiring (`test/rp-iteration-*.test.mjs`, `test/phase-e-acceptance.test.mjs`, `test/rp-iteration-runtime-wiring.test.mjs`); **PARTIAL live:** Improve actions were retained on five images, but actions were not fully exercised | **NOT TESTED:** live Vary/Reuse/Canonical/two-up outcomes and usability; additional paid two-up remains **DEFERRED** until explicit spend approval |
| P4 | Visual story memory, search, favorites, collections, details, and Continue | A for timeline/search/favorites/collections/details; mixed B/A for exact-scene Continue | **PROVEN deterministic:** Story Memory runtime/UI, chat isolation, guided Continue preview, and final-plan reference receipts (`test/p4-story-memory-runtime.test.mjs`, `test/rp-story-memory-*.test.mjs`, `test/rp-reference-receipt.test.mjs`); **PARTIAL live:** populated timeline, selected Details, and 320px fit | **NOT TESTED:** live search/favorite/collection/Continue actions and a conclusive chat-switch isolation run |
| P5 | Story-aware cinematic suggestions and session limits | Provider-free staging only in v2.5; suggestions never generate and may prepare context for the next wand or slash command. | **PROVEN deterministic:** meaningful delta interpretation, duplicate/ambiguous suppression, queue/recovery, budgets, and lifecycle (`test/rp-cinematic-automation.test.mjs`, `test/rp-cinematic-runtime.test.mjs`, `test/rp-cinematic-ui.test.mjs`, `test/rp-cinematic-integration.contract.test.mjs`); **PROVEN live:** manual suggestion/adjust/dismiss were provider-free; cards only **stage for the next wand** | **DEFERRED:** automatic generation, card-triggered generation, and any separate cinematic generation entry point |
| P6 | Per-chat Wand Direction, Character Sources, and Cast Correction in Settings | A for durable direction/source/cast choices; B for readiness and progressive disclosure. Settings remains configuration-only. | **PROVEN deterministic:** chat-scoped framing/continuity/direction, Auto/Avatar/Description, explicit identity pinning, Include/Focus/Exclude/Auto cast correction, strict previous-image opt-in, and settings-only/no-duplicate-entry contracts (`test/rp-chat-canon.test.mjs`, `test/rp-cast-settings-*.test.mjs`, `test/settings-content-contract.test.mjs`); **PROVEN live:** Settings edits were provider-free at narrow widths | **NOT TESTED:** reload isolation and outcome evidence that deliberate source/cast choices change an attached wand result; old inline Direct-this-scene/Visual Story claims are **DEPRECATED** |

## Priority 0 — Trustworthy provider and model selection

### User outcome

Refreshing LinkAPI or TokenReply shows usable image models rather than a misleading zero, and changing the selected model changes the actual protocol and endpoint used for generation.

### First increment

- Make LinkAPI discovery retain returned curated Gemini/Nano Banana models as well as OpenAI Images models.
- Replace TokenReply's Grok-only discovery filter with explicit model-family route records.
- Require every generatable fetched model to declare its transport and endpoint class.
- Preserve saved models and explain the difference between an empty catalog and models rejected because their image route is unverified.
- Verify LinkAPI refresh and route selection without spending on generation. TokenReply generation remains deferred while its image service is unavailable.
- Add saved **OpenAI Images-compatible** and **Gemini-compatible** custom connections with user-entered base/model paths, explicit protocol routing, safe URL validation, and no arbitrary request templates.

### Success evidence

- **PROVEN deterministic:** A LinkAPI fixture containing Nano Banana and GPT Image returns both with distinct routes (`test/provider-catalog.test.mjs`, `test/provider-registry.test.mjs`).
- **PROVEN deterministic:** Selecting TokenReply Grok versus Nano Banana produces different endpoint classes; an unverified route is blocked before network I/O (`test/provider-route-resolution-hardening.test.mjs`, `test/provider-preflight-hardening.test.mjs`).
- **PROVEN live:** Browser UAT shows sanitized catalog counts and selected route metadata, and sends no image-generation request (LinkAPI discovery UAT artifact; no generation request recorded).
- **NOT TESTED:** A custom GPT Image connection and a custom Gemini/Nano Banana connection fetching catalogs and previewing distinct routes without exposing credentials or spending on generation.

## Priority 1 — Visual continuity

### User outcome

Characters remain recognizable across changing scenes, including two-character scenes. The user can see which appearance is active and deliberately change it when the story changes.

### Product features

| Feature | User experience | Competitive inspiration |
| --- | --- | --- |
| **Appearance truth** | Use a character-specific avatar when informative; otherwise use the written description. Text fills missing details without overriding visible avatar traits | Picture Prompt; SLAY Images |
| **Continuity shelf** | Show the active appearance for each present character beside the generation action | SLAY Images; Picture Prompt |
| **Remember this look** | Promote a successful image into a durable character appearance | SLAY Images |
| **Look selection and lock** | Select an alternate look and keep it active across subsequent scenes until deliberately changed | SLAY Images |
| **Two-character identity planning** | Preview both characters and keep their references and descriptions separated | SLAY Images; Picture Prompt |
| **Outfit selection and lock** | Name a complete outfit, hold it across scenes, and change it when the story changes | SLAY Images; Image Generation Suite |
| **Visible reference plan** | Show which avatars, remembered looks, or previous scenes will be sent and explain omissions caused by model limits | Picture Prompt; 0cyris ImageGen |

### Not in the first continuity increment

- Automatic face recognition
- Complex mix-and-match wardrobe categories
- Unlimited NPC orchestration
- Training LoRAs or embeddings
- Local diffusion workflow management

### Success evidence

- **PARTIAL live / quality failure:** A three-scene single-character sequence retains identity while setting and action change; the controlled benchmark has not passed its quality scorecard.
- **CONTRADICTED:** The two-character benchmark sequence cannot prove retained identities because the persona changed between scenes; obtain a valid replacement before claiming this outcome.
- **PROVEN deterministic; NOT TESTED live:** Saved appearance references remain optional, while legacy outfit data is preserved inertly without entering new plans (`test/rp-appearance-*.test.mjs`, `test/outfit-retirement.test.mjs`).
- **PROVEN deterministic; NOT TESTED live:** Clearing Gallery never destroys remembered appearances (`test/rp-appearance-migration.test.mjs`, `test/rp-appearance-removal.test.mjs`).
- **PROVEN deterministic; NOT TESTED live:** Settings show only current-chat reference readiness and Story Memory Details show a compact receipt derived from the final dispatched plan (`test/rp-reference-readiness.test.mjs`, `test/rp-reference-receipt.test.mjs`, `test/p4-story-memory-runtime.test.mjs`).

The agreed LinkAPI/Nano Banana 2 character-consistency benchmark runs only after these behaviors exist.

## Priority 2 — Better automatic scene interpretation

### User outcome

The user clicks the wand and receives an image of the intended story moment. Persistent visual preferences guide presentation; highlighted text can focus a specific passage without adding a pre-generation step.

### Product features

| Feature | User experience | Competitive inspiration |
| --- | --- | --- |
| **Generate this passage** | Highlight part of a message and click the existing wand; nearby context still supplies identity, location, and continuity | Contextual Scene Painter; current selected-text behavior |
| **Current-message interpretation** | Without a selection, treat the clicked message as the primary moment and use nearby context only to resolve cast, location, and current state | Pawtrait; Quick Image Gen |
| **Persistent visual defaults** | Configure reusable style, aspect ratio, framing preference, continuity strength, and optional custom visual instruction in Settings | Image Generation Suite; Quick Image Gen; current settings |
| **Automatic cast resolution** | Infer who is present from the selected message and recent context without adding narrator, GM, or absent characters | 0cyris ImageGen; SLAY Images |
| **Story-state delta** | Preserve durable identity facts, update current outfit/location/objects/injuries, and remove facts made obsolete by the new scene | SLAY Images; product synthesis |
| **Inspect interpretation after generation** | Let advanced users inspect the effective focus, references, and prompt from the resulting artifact rather than blocking generation beforehand | Ikarus Auto Image; Image Generation Suite |

### Product rule

The entry contract is strict: **wand click means generate immediately**, while `/proimagine` accepts an explicit prompt. Settings hold durable visual preferences; highlighted text supplies optional per-generation focus. The committed paths have no mandatory preflight or task picker.

### Success evidence

- **PROVEN deterministic; NOT TESTED live:** Users can generate a selected passage without copying it into a prompt box (`test/rp-selection.test.mjs`, `test/rp-wand.test.mjs`).
- **PROVEN deterministic:** With no selection, the clicked message remains the obvious primary subject (`test/rp-scene-generation.test.mjs`, `test/runtime-plan-wiring.test.mjs`).
- **PROVEN deterministic:** Cast, current state, and location are inferred without carrying obsolete scene facts forward (`test/rp-scene-interpretation.test.mjs`, `test/rp-scene-generation.test.mjs`).
- **PROVEN deterministic; PARTIAL live:** Persistent defaults apply consistently without repeated interaction (`test/rp-chat-canon.test.mjs`; live Settings edits observed).
- **NOT TESTED:** The generated subject matches the selected passage more reliably than full-message-only generation.

### Secondary directed path — committed as P6 Settings

The primary host wand still generates immediately. Per-chat framing, continuity, visual direction, character source, and deliberate identity pin choices are configured in Settings; opening or editing them never makes a provider request. There is no second chat-level Generate or Direct-this-scene entry.

## Priority 3 — Improve an almost-right image

### User outcome

A useful image becomes the beginning of an iteration loop rather than a dead-end artifact.

### Product features

| Feature | User experience | Competitive inspiration |
| --- | --- | --- |
| **Vary the shot** | Preserve character identity and story facts while changing pose, framing, or composition | Quick Image Gen; SD Proxy |
| **Keep characters, change scene** | Reuse active appearances while replacing location and obsolete scene state | SLAY Images; product synthesis |
| **Edit and regenerate** | Open the effective prompt and compact controls from the image itself | Pawtrait; Contextual Scene Painter |
| **Reuse recipe** | Restore the source passage, references, model, options, and creative controls | Quick Image Gen; Ikarus Auto Image; Image Generation Suite |
| **Retry with repaired prompt** | Correct malformed or unsuitable prompts without silently repeating a paid request | Ikarus Auto Image |
| **Make canonical** | Promote the chosen result to the active character look, prior-scene reference, or chat background | SLAY Images; Quick Image Gen |
| **Optional two-up choice** | Explicitly request two variations, show the additional cost, and retain only the chosen result by default | SD Proxy; Quick Image Gen |

### Success evidence

- **NOT TESTED live:** Reuse and Vary are understandable without documentation.
- **PROVEN deterministic; NOT TESTED live:** A variation never overwrites the original artifact (`test/rp-iteration-domain.test.mjs`, `test/rp-iteration-p3.test.mjs`).
- **NOT TESTED live:** The user can preserve identity while changing composition.
- **PROVEN deterministic; NOT TESTED live:** Additional paid outputs require explicit selection and cost disclosure (`test/rp-iteration-p3.test.mjs`, `test/generation-plan.test.mjs`).
- **PROVEN deterministic; NOT TESTED live:** Useful results can be promoted into continuity or background roles in one action (`test/rp-iteration-runtime-wiring.test.mjs`).

## Priority 4 — Visual story memory

### User outcome

Long-running roleplays develop a searchable visual history rather than an undifferentiated folder of generated files.

### Product features

| Feature | User experience | Competitive inspiration |
| --- | --- | --- |
| **Story timeline** | Browse images in chat order with their source moments | Quick Image Gen; per-chat galleries |
| **Favorites** | Mark important images without moving or duplicating files | SD Proxy; Quick Image Gen |
| **Search and filters** | Find by character, chat, task, model, prompt text, or date | SD Proxy |
| **Collections** | Group canon looks, locations, outfits, and memorable moments | SD Proxy |
| **Generation details** | Inspect source passage, effective prompt, references, model, and settings | Ikarus Auto Image; Image Generation Suite |
| **Continue from this scene** | Use a selected prior image and its still-valid facts for the next generation | Current previous-image behavior, made explicit |

### Success evidence

- **PARTIAL live:** A user can find an older canonical look or location without browsing filenames; timeline/details were opened, but search has not been exercised live.
- **PROVEN deterministic; NOT TESTED live:** Gallery clearing and Appearance memory remain independent (`test/rp-appearance-migration.test.mjs`, `test/rp-story-memory.test.mjs`).
- **PROVEN deterministic; PARTIAL live:** Every retained image records enough provenance to reproduce or intentionally vary it (`test/p4-story-memory-runtime.test.mjs`, `test/rp-iteration-domain.test.mjs`).
- **NOT TESTED live:** Search remains useful across long chats and many characters.

Folders, bulk operations, and a full digital-asset-management interface are later refinements, not prerequisites.

## Priority 5 — Story-aware cinematic automation ✅

### User outcome

Automation creates images at meaningful moments and remains understandable, optional, and budget-aware.

**Implementation status (v2.5):** Mounted in the real extension lifecycle when the optional story-tools switch is enabled. The runtime interprets accepted scene-state deltas from rendered chat messages, persists a chat-scoped session and queued events, and renders one recoverable suggestion card beside the triggering message. The card is provider-free: **Use for next wand** stages context in current-chat preferences, while Adjust and Dismiss remain local. Suggestions never generate; the only generation entry points are the wand and slash command.

### Product features

| Feature | User experience | Competitive inspiration |
| --- | --- | --- |
| **Story-change suggestions** | Stage context when a major location, cast, or emotional beat changes—not merely every N messages | Ikarus Auto Image; Chinese community patterns; product synthesis |
| **Suggested shot** | Offer a provider-free card the user can stage for the next wand, adjust, or dismiss | Pathweaver; Pawtrait |
| **Cinematic mode** | Choose conservative, balanced, or frequent story-beat illustration | Structured trigger systems across Ikarus and IGS |
| **Visible next trigger** | Explain what automation is waiting for and why it fired | Pathweaver; product synthesis |
| **Suggestion limit** | Bound provider-free suggestions without authorizing generation | Cost/readiness patterns from SD Proxy |
| **Manual retrigger** | Re-run a missed or failed story beat without replaying the chat event | Ikarus Auto Image; Image Generation Suite |

### Success evidence

- **PROVEN deterministic; PROVEN live for manual card:** Suggestions never generate solely because an ambiguous event fired twice (`test/rp-cinematic-automation.test.mjs`, `test/rp-cinematic-runtime.test.mjs`).
- **PARTIAL live:** Users can predict or disable suggestions; manual suggestion/adjust/dismiss was observed, but reload recovery remains untested.
- **PROVEN deterministic; PARTIAL live:** Location, cast, and outfit changes are reflected in the suggested shot (`test/rp-cinematic-automation.test.mjs`); only manual live retrigger is confirmed.
- **PROVEN deterministic; NOT TESTED live:** Suggestion limits stop queued provider-free suggestions at the configured boundary (`test/rp-cinematic-runtime.test.mjs`).
- **PROVEN deterministic; PROVEN live:** Suggested shots do not interrupt ordinary chat flow; manual cards were provider-free and inline (`test/rp-cinematic-ui.test.mjs`, `test/rp-cinematic-integration.contract.test.mjs`).

Focused evidence: `test/rp-cinematic-automation.test.mjs`, `test/rp-cinematic-runtime.test.mjs`, `test/rp-cinematic-ui.test.mjs`, and `test/rp-cinematic-integration.contract.test.mjs` cover interpretation deltas, duplicate/ambiguous suppression, queue recovery, manual retriggers, stale chat protection, provider-free stage/adjust/dismiss actions, no-hidden-network behavior, settings persistence, and narrow-safe controls. This deterministic evidence does not claim an automatic trigger or card-generated image; those are outside the v2.5 contract.

## Priority 6 — Wand direction & character sources in Settings ✅

### User outcome

The player can set durable, per-chat visual direction and character sources while keeping the ordinary host wand immediate and familiar. Settings configure; the wand generates.

### Product features

| Feature | User experience |
| --- | --- |
| **Settings entry** | In **Images & Cast → Current chat characters**, choose source and deliberate identity pinning; the message wand and slash command remain the only generation entries |
| **Player direction** | In Preferences, choose framing, continuity strength, and up to 1000 characters of optional visual direction for the current chat |
| **Appearance source** | For each current identity, choose Auto (recommended), Avatar, or Description; Auto follows the current host identity and never pins it |
| **Deliberate pinning** | Pin, replace, or unpin an identity explicitly; replacement requires confirmation and is isolated to the current chat |
| **Reference readiness** | Show which current-chat sources are available and may be used; exact used/omitted references appear only on the completed image receipt |
| **Cast correction** | In a collapsed Settings control, choose Auto, Include, Focus, or Exclude for current-chat characters and NPCs without adding another generation action |
| **Honest route and cost state** | Keep route readiness and exact-cost-unavailable messaging in the existing setup/advanced surfaces; do not invent a currency consequence |
| **Explicit spend boundary** | Settings edits, chat switching, and staged cinematic suggestions are local; only the host wand or slash command may enter the generation coordinator |
| **Per-chat recovery** | Direction, source, and pin choices persist in the chat canon without persisting raw story passages, prompts, secrets, or image payloads |

### Acceptance evidence

- **DEPRECATED:** A first-class `director` invocation and a visible per-message Direct-this-scene panel are no longer player requirements; the settings-only product boundary removed the duplicate entry and second Generate action.
- **PROVEN deterministic:** Per-chat framing, continuity, and visual direction are captured as wand plan settings; selected text remains the story focus (`test/rp-chat-canon.test.mjs`, `test/rp-selection.test.mjs`, `test/runtime-plan-wiring.test.mjs`).
- **PROVEN deterministic:** Auto follows current identity; explicit pin/source choices are stable chat-canon data (`test/rp-chat-canon.test.mjs`, `test/settings-content-contract.test.mjs`).
- **PROVEN deterministic:** Strict previous-image opt-in excludes prior-scene/Story Memory references when Off and allows the selected source only when On (`test/rp-cinematic-integration.contract.test.mjs`, `test/generation-plan.test.mjs`).
- **PROVEN deterministic; PROVEN live for edits:** Settings edits are provider-free, chat-scoped, and narrow-safe; no hidden Direct/Visual Story/inline memory buttons remain (`test/rp-director-integration.contract.test.mjs`, `test/settings-content-contract.test.mjs`; Settings UAT at 320px).
- **PROVEN deterministic:** Expanded suite is **790/790 at `410a6c6`**; this is contract evidence, not proof of image quality or every live path.
- **PARTIAL live:** Five image attachments retained existing Improve and Story Memory actions; the invalid two-character benchmark scene and failing quality scorecard prevent a consistency claim.
- **PROVEN deterministic; NOT TESTED live:** Compact Settings cast correction is player-facing and feeds the existing wand plan; a deliberate source/cast choice changing a live result after reload remains untested.

## Later creator and ecosystem opportunities

These remain secondary to the five product priorities:

- Reusable style and generation presets
- Import/export without credentials or private assets
- Optional dedicated prompt-planner profile
- Localized UI, errors, and onboarding
- Safe declarative custom hosted-provider profiles
- Optional server-side secret and transport adapter
- Provider capability discovery and readiness indicators

ComfyUI, A1111, Forge, checkpoints, LoRAs, ControlNet, workflow graphs, batch studios, and a style marketplace remain outside the current product horizon.

## Enabling requirements

The following are required underneath relevant features but are not marketed roadmap outcomes:

- Independent Gallery and Appearance asset lifecycles
- A shared generation plan used by preview and dispatch
- Request identity and duplicate-event protection
- Correct chat/message attachment
- Capability-aware provider controls
- Safe cancellation where the provider supports it
- Bounded retry and concurrency
- Credential redaction and secret migration design
- Upload validation, quota handling, and orphan repair
- Mobile, keyboard, and narrow-layout support

These requirements enter a feature specification only when that product feature needs them. They do not determine product sequencing by themselves.

## Product measures

Primary measures:

- Character-identity retention across sequential scenes
- Correct identity separation in two-character scenes
- Correct outfit and current-state retention
- Percentage of images retained, favorited, varied, or made canonical
- Percentage of generations requiring prompt editing
- Time from story moment to useful image
- Wrong-character, wrong-cast, and obsolete-scene-state reports
- Selected-text versus whole-message generation usage and success
- Automation suggestions approved versus dismissed

Operational measures such as cancellation success, duplicate requests, and provider errors remain quality gates, not product success metrics.

## Next acceptance steps

1. **Repair and score the benchmark.** Pricing is verified at USD $0.09375 for the selected LinkAPI model, but the seven-request/USD $0.65625 run is not a pass: six originals exist, the two-character sequence is invalid after a persona change, and the quality scorecard is P1/failing. Keep the same route and 16:9 setup, correct the persona, obtain a valid replacement, and score identity retention first. Do not present the current run as benchmark success.
2. **Complete player-action UAT on retained media and memory.** Exercise Improve/Vary, Reuse, Canonical, Story Memory search/favorite/collection/Continue, and explain which references were used. Presence of a button is not acceptance of its action.
3. **Verify the settings-only direction path.** Change framing, continuity, visual direction, Auto/Avatar/Description, and explicit pin/unpin in chat A; switch to chat B and back; confirm isolation, reload recovery, 320/360/480px keyboard safety, and zero provider calls during edits. The host wand must remain the sole manual generation action.
4. **Exercise optional cinematic behavior.** Enable the extra story-tools and cinematic toggles, trigger a card from a real accepted story-state change, verify disable/re-enable and Next-state explanation, stage it for the next wand, and confirm the staged shot is consumed once. Do not treat a card as a separate generation action.
5. **Live-validate guided Story Memory Continue.** The provider-free preview, strict opt-in, exact selected artifact, chat isolation, success-only consumption, and replacement-race protection are **PROVEN deterministic** at `698569c`; exercise the complete action in the loaded host without treating selection as generation.
6. **Live-validate compact cast correction and reference explanation.** Include/Focus/Exclude/Auto, current-chat NPC support, cross-chat reference isolation, readiness, and final-plan receipts are **PROVEN deterministic** at `35a03c1` and `410a6c6`; attach a corrected known-missed-character result and verify its Story Memory receipt.
7. **Finish P0 live configuration evidence.** Select distinct LinkAPI routes in the loaded profile and test one custom OpenAI Images-compatible and one custom Gemini-compatible connection without generation spend. TokenReply Nano remains deferred until authoritative route/service evidence exists.
8. **Prepare release-facing documentation only after those gates.** Keep this roadmap as the internal evidence ledger; make README changes separately and deliberately so public setup and feature copy stay concise.

The roadmap's first bet remains **make the same character remain recognizably the same across the story**. The current product boundary keeps that promise understandable: Settings configure the current chat, and the host wand generates immediately.

# Context Image Generation Product Roadmap

**Status:** Private working roadmap; proposed direction, not a release claim

**Updated:** 2026-08-31

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

## Current baseline — v1.7.1

Existing capabilities include message, slash, automatic, and swipe generation; character/persona context; avatar and previous-image references; a file-backed Gallery; and LinkAPI routes. These make generation possible, but they do not yet provide dependable continuity, reliable scene interpretation, or a strong iteration loop.

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

- A LinkAPI fixture containing Nano Banana and GPT Image returns both with distinct routes.
- Selecting TokenReply Grok versus Nano Banana produces different endpoint classes; an unverified route is blocked before network I/O.
- Browser UAT shows sanitized catalog counts and selected route metadata, and sends no image-generation request.
- A custom GPT Image connection and a custom Gemini/Nano Banana connection can fetch their catalogs and preview distinct routes without exposing credentials or spending on generation.

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

- A three-scene single-character sequence retains identity while setting and action change.
- A three-scene two-character sequence retains both identities without blending or duplication.
- Locked looks and outfits persist until explicitly changed.
- Clearing Gallery never destroys remembered appearances.
- The user can explain which visual references were used.

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

The wand contract is strict: **click means generate immediately**. Settings hold durable visual preferences; highlighted text supplies optional per-generation focus. The committed path has no mandatory preflight or task picker.

### Success evidence

- Users can generate a selected passage without copying it into a prompt box.
- With no selection, the clicked message remains the obvious primary subject.
- Cast, current state, and location are inferred without carrying obsolete scene facts forward.
- Persistent defaults apply consistently without repeated interaction.
- The generated subject matches the selected passage more reliably than full-message-only generation.

### Optional interaction exploration — not committed

A secondary **Generate with options** path could later support Portrait, Cast, Background, framing, mood, or prompt review. It would require a deliberate frontend and North Star decision—such as a split action or separate menu—and must never change the primary wand into a blocking form by accident.

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

- Reuse and Vary are understandable without documentation.
- A variation never overwrites the original artifact.
- The user can preserve identity while changing composition.
- Additional paid outputs require explicit selection and cost disclosure.
- Useful results can be promoted into continuity or background roles in one action.

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

- A user can find an older canonical look or location without browsing filenames.
- Gallery clearing and Appearance memory remain independent.
- Every retained image records enough provenance to reproduce or intentionally vary it.
- Search remains useful across long chats and many characters.

Folders, bulk operations, and a full digital-asset-management interface are later refinements, not prerequisites.

## Priority 5 — Story-aware cinematic automation ✅

### User outcome

Automation creates images at meaningful moments and remains understandable, optional, and budget-aware.

**Implementation status (v2):** Mounted in the real extension lifecycle. The runtime interprets accepted scene-state deltas from rendered chat messages, persists a chat-scoped session and queued events, and renders one recoverable suggestion card beside the triggering message. Approval revalidates the captured chat/message fingerprint and current route before entering the existing generation coordinator. Adjust and dismiss are provider-free. When a provider does not expose a finite exact price, the UI uses a generation-count ceiling and does not invent currency.

### Product features

| Feature | User experience | Competitive inspiration |
| --- | --- | --- |
| **Story-change triggers** | Generate when a major location, outfit, cast, or emotional beat changes—not merely every N messages | Ikarus Auto Image; Chinese community patterns; product synthesis |
| **Suggested shot** | Offer a generation card the user can approve, adjust, or dismiss | Pathweaver; Pawtrait |
| **Cinematic mode** | Choose conservative, balanced, or frequent story-beat illustration | Structured trigger systems across Ikarus and IGS |
| **Visible next trigger** | Explain what automation is waiting for and why it fired | Pathweaver; product synthesis |
| **Session budget** | Set a generation or cost ceiling for automatic work | Cost/readiness patterns from SD Proxy |
| **Manual retrigger** | Re-run a missed or failed story beat without replaying the chat event | Ikarus Auto Image; Image Generation Suite |

### Success evidence

- Automation never generates solely because an ambiguous event fired twice.
- Users can predict, approve, or disable automatic behavior.
- Location, cast, and outfit changes are reflected in the suggested shot.
- Session limits stop automatic spending at the configured boundary.
- Suggested shots do not interrupt ordinary chat flow.

Focused evidence: `test/rp-cinematic-automation.test.mjs`, `test/rp-cinematic-runtime.test.mjs`, `test/rp-cinematic-ui.test.mjs`, and `test/rp-cinematic-integration.contract.test.mjs` cover interpretation deltas, duplicate/ambiguous suppression, queue recovery, manual retriggers, stale chat protection, card actions, no-hidden-network behavior, coordinator dispatch, settlement, budget stop, settings persistence, and narrow-safe controls.

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

## Recommended next steps

1. **Make provider/model selection trustworthy.** Fix LinkAPI discovery, give TokenReply model families explicit routes, and verify selection without paid generation.
2. **Design the continuity workflow.** Specify Continuity shelf, Remember this look, active-look preview, look lock, and two-character reference planning as one user journey.
3. **Implement only the storage work that workflow requires.** Decouple Gallery and Appearance assets, migrate existing looks, and support safe cleanup.
4. **Ship the smallest valuable continuity increment.** One active look per character, visible reference preview, and look locking before alternate wardrobes or complex NPC management.
5. **Run the agreed character-consistency benchmark.** Use one single-character and one two-character three-scene sequence through LinkAPI Nano Banana 2, 16:9, within the USD $5 ceiling.
6. **Improve automatic scene interpretation.** Specify selected-text precedence, whole-message fallback, automatic cast resolution, story-state changes, and persistent visual defaults without adding a pre-generation screen.
7. **Add the iteration loop.** Vary, Edit and regenerate, Reuse recipe, and Make canonical should ship together around the generated artifact.
8. **Build visual story memory from proven metadata.** Add timeline, favorites, and search before collections or bulk management.
9. **Prototype story-aware automation last.** Test suggested shots and story-change triggers before enabling automatic paid generation.

The first roadmap bet is therefore not “make storage safer.” It is **make the same character remain recognizably the same across the story**. The second is not “add a Shot composer”; it is **make the immediate wand result depict the intended current moment**. Storage and planning mechanics are merely part of delivering those outcomes.

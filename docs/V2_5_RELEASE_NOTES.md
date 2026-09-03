# v2.5 release notes

## Scope

v2.5 implements ADR-002's focused generation boundary:

- The message wand generates from the current roleplay message or selected passage and delivers to that captured message.
- `/proimagine`, `/proimg`, and `/geminiimg` generate from an explicit prompt and deliver to preview/Gallery.
- Both entry points share one Scene Generation kernel for readiness, planning, dispatch, coordination, and normalized errors.
- Settings is configuration-only. Provider, model, scene preferences, optional avatar/previous-image references, and saved-appearance memory remain available. **Refresh Models** checks the selected provider and keeps existing local model IDs when discovery is empty or fails.
- Cinematic suggestions and Story Memory are provider-free staging surfaces for the next wand only. Gallery, Improve tools, and saved appearances remain provider-free support surfaces. They cannot introduce another generation entry point.
- Attire remains ordinary prompt/scene content. Outfit controls, automatic generation, generate-on-swipe, iteration dispatch, and Director dispatch are retired.
- Legacy `rp_outfits`, `outfit_pending`, per-chat `outfitState`, `sceneFacts.outfits`, historical outfit collections, and historical `activeOutfits` data remain inert and readable for rollback. Opaque `sceneFacts.outfits` values survive ordinary scene reconciliation and successful wand persistence without entering prompts or generation plans. No user-owned images or metadata are purged.

## Evidence

Deterministic settings, UI, provider-contract, Story Memory, and cinematic compatibility tests pass in the Task 7 focused run. Task 6's preservation and retirement evidence is recorded in `docs/STATUS.md`. Live wand/slash generation and paid-provider image quality remain **NOT TESTED**; no live or paid provider action was performed for this documentation change.

The extension manifest remains `1.8.0` because no exact semantic v2.5 version was approved during this task. The product scope is v2.5, but changing the manifest version requires an explicit semantic-version decision.

## Deferred

Purging legacy outfit data, deleting historical assets, adding Settings generation, adding new entry points, and paid-provider benchmarking remain separately authorized work.

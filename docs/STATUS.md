# v2.5 Status

## Objective
Implement ADR-002: two generation entry points, one kernel, optional references, and inert legacy outfit data.

## Current milestone
Task 7 — settings, styling, and release-documentation reconciliation complete; ready for Task 8 deterministic regression.

## Completed
- ADR-002 accepted and corrected to wand + slash.
- Generation source and delivery destination contracts implemented.
- Extracted a dependency-injected scene-generation kernel without production wiring.
- Defined the Task 4 composition seams for capture, reference materialization, plan/message construction, provider dispatch, and coordination.
- Historical Task 3: added dormant, dependency-injected message and preview/Gallery delivery adapters before production wiring.
- Historical Task 3: added pure wand and slash request factories plus thin entry adapters; Task 4 subsequently composed them into `index.js`.
- Composed the production kernel and registered exactly two generation sources: the message wand and `/proimagine` (including its existing aliases).
- Removed automatic, overswipe, iteration, Director, and cinematic provider dispatch while preserving legacy preferences and historical artifacts as inert/readable data.
- Added a deterministic optional-reference contributor pipeline in avatar, previous-image, saved-appearance order. Contributor failures are non-blocking notices; duplicate reference or asset IDs fail before planning.
- Moved saved appearance library, tombstone, chat-pin, and appearance-asset resolution out of kernel capture and behind the explicitly enabled saved-appearance contributor.
- Corrected the contributor boundary so disabled Appearance Memory cannot affect identities, cast truths, prompt descriptions, avatar policy, or saved-reference planning.
- Captured avatar, previous-image, and saved-appearance inputs once before asynchronous materialization, preventing delayed work from mixing chats.
- Decoupled saved-appearance asset resolution from the previous-image toggle and its selected Gallery item.
- Retired outfit UI, handlers, prompt projection, plan/provenance fields, settings normalization, and pending-recovery scheduling. Legacy `rp_outfits`, `outfit_pending`, chat `outfitState`, and historical `activeOutfits` artifacts remain inert and structurally preserved.
- Removed the remaining scene and cinematic outfit-state architecture. Current attire remains ordinary source text only; non-outfit scene facts remain available.
- Preserved realistic opaque legacy `outfitState` values larger than 8192 bytes across every ordinary chat-canon writer and the coordinated host metadata save seam without weakening the generic unknown-field budget.
- Added real extension-settings load/save and historical Story Memory artifact-reader coverage for compatibility preservation.
- Carried the current opaque `outfitState` through visible-canon replay before its first save and during final cleanup, even when the historical candidate omits the field or contains a stale value.
- Restored routine chat-canon persistence to SillyTavern's existing `saveChatConditional` coordination path; the preservation seam no longer selects direct one-to-one or group writers.
- Reconciled Settings copy with ADR-002: provider/model refresh is discoverable, Settings remains configuration-only, and cinematic/Story Memory surfaces only stage context for wand/slash.
- Removed retired outfit-only CSS selectors while retaining shared layout and cinematic suggestion styling.
- Reconciled PRODUCT, README, DEVELOPER_GUIDE, and ROADMAP with the two-entry v2.5 boundary; added `docs/V2_5_RELEASE_NOTES.md` with evidence and deferrals. Approved pre-existing README/DEVELOPER_GUIDE opening and ownership hunks remain unchanged.
- Kept `manifest.json` at `1.8.0`; no exact semantic v2.5 version was approved, so the release-note limitation is explicit rather than inferred.

## Verification
- `node --test test/scene-generation-contracts.test.mjs` — 8 passed.
- `node --test test/scene-generation-kernel.test.mjs` — 7 passed after the expected missing-module red run.
- `node --test test/scene-generation-delivery.test.mjs` — 5 passed after the expected missing-module red run.
- Focused kernel parity suite — 54 passed: `scene-generation-kernel`, `generation-plan`, `generation-coordinator`, `provider-dispatch`, `run-coordinator-phase-c`, and `no-spend-uat`.
- Task 4 focused authority suite — 91 passed, 0 failed.
- Full repository suite — 856 passed, 0 failed: `node --test test/*.mjs`.
- Task 5 focused contributor/kernel/reference suite — 40 passed, 0 failed.
- Task 5 full repository suite — 864 passed, 0 failed: `node --test test/*.mjs`.
- Task 5 correction RED — the production-boundary contract failed because `index.js` had no immutable contributor-capture assembly; deterministic race and disabled-appearance tests were added before production changes.
- Task 5 correction focused contributor/kernel/reference suite — 43 passed, 0 failed.
- Task 5 correction full repository suite — 867 passed, 0 failed: `node --test test/*.mjs`.
- Task 6 focused retirement/migration/chat-canon/plan/domain suite — 60 passed, 0 failed.
- Task 6 syntax checks — `index.js`, `lib/generation-plan.js`, and `lib/rp/continuity-shelf.js` passed `node --check`.
- Task 6 full repository suite — 870 passed, 0 failed: `node --test test/*.mjs`.
- Task 6 `git diff --check` — passed.
- Task 6 correction RED — the expanded retirement suite reported 2 passed and 5 failed for real settings/metadata seams, large opaque legacy state, scene retention, and cinematic events; a final source assertion exposed one stale cinematic outfit branch at 6 passed and 1 failed.
- Task 6 correction focused suite — 63 passed, 0 failed.
- Task 6 correction affected scene/cinematic/canon/settings/Story Memory suite — 122 passed, 0 failed.
- Task 6 correction full repository suite — 873 passed, 0 failed: `node --test test/*.mjs`.
- Task 6 correction round 2 RED — the retirement suite reported 5 passed and 3 failed for coordinated-save bypass, 17KB replay loss, and missing production wiring.
- Task 6 correction round 2 focused suite — 64 passed, 0 failed.
- Task 6 correction round 2 affected replay/persistence/scene/cinematic/canon/settings/Story Memory suite — 156 passed, 0 failed.
- Task 6 correction round 2 full repository suite — 874 passed, 0 failed: `node --test test/*.mjs`.
- Task 7 RED — new ADR-002 settings assertions failed on missing Refresh Models copy and stale cinematic/Story Memory wording before implementation; existing cinematic/Story Memory contracts also caught wording regressions during the green pass.
- Task 7 focused settings/provider/documentation suite — 76 passed, 0 failed: `node --test test/settings-content-contract.test.mjs test/settings-ui-contract.test.mjs test/provider-contracts.test.mjs test/p4-story-memory-runtime.test.mjs test/rp-cinematic-integration.contract.test.mjs`.
- Task 7 `git diff --check` — passed before final allowlist staging.

## Failures / open issues
- Live browser UAT is outstanding.
- No paid-provider verification is authorized.
- Independent re-review of the Task 6 correction is outstanding.
- Full Task 8 deterministic regression is outstanding.
- Live wand/slash generation, paid-provider verification, and image-quality acceptance remain **NOT TESTED**.

## Decisions
- Settings is configuration-only.
- Legacy outfit data is preserved, not purged.
- Saved appearance contributes only when Appearance Memory is explicitly enabled; avatar, previous image, and saved appearance can all be absent without blocking a text-only plan.
- Legacy outfit records are preserved as opaque compatibility data; no production path interprets, writes, replays, or injects them into generation.
- v2.5 documentation names only wand and slash as generation entry points; cinematic suggestions, Story Memory, Gallery, Improve tools, and saved appearances are staging/configuration surfaces.

## Next action
Run Task 8 syntax/full deterministic regression and independent critique; keep live provider generation out of scope unless separately authorized.

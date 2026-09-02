# v2.5 Status

## Objective
Implement ADR-002: two generation entry points, one kernel, optional references, and inert legacy outfit data.

## Current milestone
Task 6 — outfit behavior retired without deleting legacy user data; awaiting independent review.

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

## Failures / open issues
- Live browser UAT is outstanding.
- No paid-provider verification is authorized.
- Independent re-review of the Task 5 correction is outstanding.

## Decisions
- Settings is configuration-only.
- Legacy outfit data is preserved, not purged.
- Saved appearance contributes only when Appearance Memory is explicitly enabled; avatar, previous image, and saved appearance can all be absent without blocking a text-only plan.
- Legacy outfit records are preserved as opaque compatibility data; no production path interprets, writes, replays, or injects them into generation.

## Next action
Obtain independent review of Task 6, then proceed with the focused settings/documentation alignment task.

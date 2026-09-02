# Task 2 Report: Defer hidden Gallery work and update visible additions incrementally

## Status

Complete. Gallery DOM construction is deferred while Images & Cast is hidden. A visible, current Gallery prepends one newly persisted item; full rendering remains the recovery path for stale, forced, clear, migration, and multi-item replacement cases.

## Files and commit

- `lib/gallery-render-state.js` — DOM-free dirty/refresh/incremental-add controller.
- `index.js` — Gallery state integration, shared tile construction, lazy/async image attributes, and prepend/delete reindexing.
- `test/gallery-render-state.test.mjs` — controller behavior coverage.
- `test/settings-load-performance.test.mjs` — hidden Images & Cast stale-state contract.
- `test/settings-content-contract.test.mjs` — incremental Gallery and image decoding contract.
- Commit: `perf: defer hidden gallery rendering`.

## RED/GREEN evidence

1. RED: `node --test test/gallery-render-state.test.mjs` — 1 failing file because `lib/gallery-render-state.js` did not exist (`ERR_MODULE_NOT_FOUND`).
2. GREEN: `node --test test/gallery-render-state.test.mjs` — 4/4 passed.
3. RED: `node --test test/gallery-render-state.test.mjs test/gallery-dialog.test.mjs test/settings-load-performance.test.mjs test/settings-content-contract.test.mjs` — 29/31 passed, 2 expected failures: full `renderGallery()` from `addToGallery()` and no Gallery dirty marker in hidden Images & Cast mutations.
4. GREEN/final: `node --test test/gallery-render-state.test.mjs test/gallery-dialog.test.mjs test/settings-load-performance.test.mjs test/settings-content-contract.test.mjs` — 31/31 passed.
5. Final checks: `node --check index.js` and `git diff --check` — exit 0.

## Decisions

- The Gallery render controller stays DOM-free and begins dirty, so first exposure renders once while hidden mutations never construct tiles.
- The controller preserves dirty state if a full render or incremental prepend throws, making a later refresh safe.
- `addToGallery()` prepends only when the just-inserted item remains at index zero after trimming and the Gallery controller is visible and clean; every other case leaves it stale.
- One tile builder is used by both full rendering and prepend. Gallery images use `loading: 'lazy'` and `decoding: 'async'` without changing persistence or storage.
- Prepend and visible clean deletion reindex the tile plus preview, remember, and delete controls. If deletion cannot trust the current DOM, the controller is dirtied for a full later refresh.

## Concerns

- Deterministic coverage is complete for the specified controller and source/DOM contracts. Live SillyTavern browser UAT, including visual confirmation of image decoding behavior and action controls after a real delete/prepend sequence, remains unrun.

## Self-review

- Preserved Task 1 optional-feature lazy-loading seams; no optional-feature imports or lifecycle code changed.
- Preserved user-owned dirty documentation by staging only the six Task 2 files named above.
- Confirmed all remaining full Gallery rendering flows go through the state controller's `renderAll` callback.

## Fix round 1: trim-safe incremental prepend and action reindexing

### RED/GREEN evidence

1. RED: `node --test test/gallery-render-state.test.mjs` — 1 failing test file because the new trim-eligibility and action-reindex exports were not yet available from `lib/gallery-render-state.js`.
2. GREEN: `node --test test/gallery-render-state.test.mjs` — 7/7 passed, including a real 50-item `trimGalleryToLimit()` fixture and prepend/deletion action-index fixtures.
3. GREEN/final: `node --test test/gallery-render-state.test.mjs test/gallery-dialog.test.mjs test/settings-load-performance.test.mjs test/settings-content-contract.test.mjs` — 34/34 passed.
4. Final checks: `node --check index.js` and `git diff --check` — exit 0.

### Correction

- Incremental prepend is allowed only when the post-trim Gallery is exactly the inserted item followed by every previously rendered item. Any eviction, replacement, or other sequence change dirties the controller and performs one visible full refresh.
- The shared reindexer now updates every tile and its preview, remember, and delete targets after both prepend and visible clean deletion.

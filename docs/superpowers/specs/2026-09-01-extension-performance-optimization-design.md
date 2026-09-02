# Extension Performance Optimization Design

## Status

Approved in chat on 2026-09-01. Implementation has not started.

## Goal

Reduce the context-image-generation extension's startup work, hidden Gallery work, retained session state, and settings-migration serialization cost without changing generation behavior or avatar-reference handling.

## Scope

The implementation covers four areas:

1. Lazy loading for large opt-in Story Memory, Iteration, Cinematic, and Director runtime/UI modules.
2. Deferred and incremental Gallery rendering.
3. Bounded iteration, Cinematic, and Director session state.
4. Focused settings-migration change detection that avoids whole-object serialization.

Avatar fetching, avatar base64 conversion, provider dispatch, core generation, image navigation, and persistence-verification comparisons are explicitly out of scope.

## Architecture

### Optional feature loading

Add a focused loader module that memoizes dynamic imports for the four optional feature groups. `index.js` keeps core generation and provider modules as static imports, but requests an optional feature group only when its setting is enabled or its surface is opened. Concurrent requests for the same group share one promise. Import failures remain retryable and use the extension's existing error-reporting path.

Existing feature APIs and persisted settings remain unchanged. The change is an internal module-loading boundary, not a public interface migration.

### Gallery rendering

Separate Gallery state mutation from Gallery DOM rendering. Mutations always update and save settings, then mark the Gallery dirty. When the Gallery is hidden, no tile rebuild occurs. Opening or otherwise exposing the Gallery consumes the dirty state and renders once.

When the Gallery is already visible and a single generated image is added, prepend one tile instead of clearing and rebuilding the complete container. Full rendering remains available for initialization, clearing, migration, and multi-item replacement. Gallery images use lazy loading and asynchronous decoding. Existing dialog, deletion, and appearance-link behavior remains unchanged.

### Bounded runtime state

Iteration invocation reservations gain a release operation called from terminal success, failure, or cancellation paths. A small bounded recent-reservation guard may remain to prevent immediate duplicate replay, but it cannot grow without limit.

Cinematic and Director chat-state maps use least-recently-used eviction with a fixed maximum. Reading or updating a chat refreshes its recency. The current chat and any in-flight chat cannot be evicted. Runtime destruction continues to clear all state.

### Settings migration

Migration helpers expose or derive focused change signals for the provider settings, extra story tools, appearance library, outfit catalog, and outfit pending state. `loadSettings()` uses those signals rather than serializing both complete structures with `JSON.stringify`.

This change is restricted to startup/settings migration. JSON serialization used for request bodies, persistence read-back verification, diagnostics, or intentional deep cloning is unaffected.

## Error handling

- Optional-module load failures are reported through existing UI/logging behavior and do not mark a module as successfully loaded.
- A hidden Gallery remains dirty after a failed render so a later visible refresh can retry.
- Runtime eviction never removes active or in-flight state.
- Migration failures retain current fail-safe behavior and must not overwrite persisted settings with partial data.

## Testing and measurement

Implementation follows test-driven development. Each production change begins with a regression test that fails for the intended missing behavior.

Required automated coverage:

- Optional modules are absent from the eager import graph and loader promises are memoized.
- Hidden Gallery mutations do not rebuild tiles; opening it performs one refresh.
- Visible single-image additions avoid a full rebuild and image elements request lazy loading and async decoding.
- Iteration reservations are released at terminal completion.
- Cinematic and Director maps stay within their bounds while preserving active/in-flight state.
- Settings migration no longer performs whole-object serialization comparisons in the targeted path.

Required final verification:

- Expand and run every `test/*.test.mjs` file with Node's test runner.
- Run `node --check index.js` and syntax checks for new JavaScript modules.
- Run `git diff --check`.
- Recalculate the eager module count and raw/gzip footprint, reporting before and after figures.

Live SillyTavern browser tracing, heap snapshots, and interaction measurements remain a separate acceptance step unless a runnable host session is available during implementation. They must be labeled `NOT TESTED` if unavailable.

## Success criteria

- Large opt-in feature modules are not part of the extension's eager startup graph.
- Generating while Gallery is hidden performs no Gallery tile rebuild or eager image decode.
- The identified runtime collections have explicit release or bounded eviction behavior.
- Targeted settings migrations avoid whole-object stringify equality checks.
- Avatar-reference behavior is byte-for-byte untouched.
- The complete deterministic suite passes with no syntax or whitespace errors.

# Unified Setup and model methods implementation plan

> Execute the approved design in dependency order with focused regression tests and independent review. Preserve all pre-existing local edits; do not commit or reset the shared checkout.

**Goal:** One explicit active connection and model, with a saved custom connection supporting both Gemini-compatible and OpenAI Images generation methods.

**Spec:** `docs/SETUP_UX_REVIEW.md`, amended by the user's approval of model-specific methods and LinkAPI as the two-method acceptance case.

**Architecture:** Extend schema-1 custom connections with optional `generationMethods`; preserve legacy fields and credentials. Resolve each model's saved transport through one pure method resolver. Retain existing provider adapters. Setup owns activation and model choice independently from connection editing/catalog fetch.

**Stack:** Existing browser JavaScript, jQuery, SillyTavern styles and Node tests; no production dependency additions.

## Constraints and decisions

- No inference of generation protocol from model names. Known LinkAPI routes use documented registry mappings; custom assignments use an explicit default or per-model choice.
- `generationMethods` keys: `openai-images` ({baseUrl,generationPath}) and `gemini-compatible` ({baseUrl}). Origins may differ; credentialRef remains shared.
- No experimental checkbox. Optional capabilities remain conservative; unresolved protocols still block with a useful next step.
- Keep actual first-request confirmation at generation, scoped to the selected custom model/method. Catalog success cannot claim image success.
- Save/fetch do not activate. Explicit chooser/Use connection activates; remember model per connection.
- Settings remains configuration-only. Wand/slash are the only image-generation entry points.
- Legacy connection records, keys, unrelated settings and dirty changes are preserved. Existing absent no-spend UAT fixture is reported separately.

## Stages

- [x] 1. Extend custom contracts, route resolution, discovery, persistence and dispatch. Test legacy round trips, mixed roots, model assignment refresh, per-method evidence and both adapters.
  - Own: lib/providers/custom-connections.js, model-discovery.js, model-manager.js, model-record-store.js, diagnostics.js, dispatch.js and focused tests.
  - Produce: `resolveCustomModelRoute(connection, model)` returning protocol, transportId, endpointClass, endpoint, revision; invalid assignments fail without guessing. `customModelRouteRevision(connection, model)` scopes mixed-model evidence.
- [x] 2. Rebuild Setup markup/styles around active connection, one searchable model selector, conditional method chooser, focused connection editor and separate troubleshooting. Explicit labels and narrow-width layout.
  - Own: settings.html Setup only, style.css scoped additions, test/setup-redesign-markup.test.mjs.
- [x] 3. Integrate activation, per-connection selected models, truthful readiness and method editing in index.js and pure setup helpers. Remove checkbox UI/handlers and enforcement while preserving old stored fields inertly. Add/refresh never switches active provider.
  - Own: index.js, lib/settings-ui.js, lib/providers/ui-projection.js, model-selector-ui.js and integration tests.
- [x] 4. Verify full available suite, inspect browser if available, independent review, fix findings, update docs/status. Record live-provider limits honestly.

## Verification and rollback

Use failing behavioral regressions before edits. Mocked requests must prove exact model/adapter/URL plus shared credentials and no cross-model evidence promotion. Full suite uses `node --test` with the known missing-fixture test explicitly excluded, and a separate report of that exclusion. Runtime browser checks must distinguish mock/static work from live provider generation. Changes are localized and additive; rollback reverts only this task's explicit diffs after preserving settings with the new optional fields.

## Acceptance evidence

932 available tests pass. Actual Setup browser save/activate/model-method switching and reload were exercised using isolated data. Live LinkAPI catalog and paid two-method generation remain unverified; see docs/STATUS.md.

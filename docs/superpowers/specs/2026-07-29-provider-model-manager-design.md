# Provider Model Manager Design

## Status

Approved by user on 2026-07-29. The user explicitly authorized specification creation and implementation without a separate spec-review pause.

## Goal

Give every provider a consistent model-management workflow: built-in defaults, manual actual model IDs, optional fetched model IDs, and safe persistence. The selected ID is sent unchanged as the provider request's `model` field.

## Scope

- Replace provider-specific model discovery with registry-driven discovery metadata.
- Add a per-provider Model Manager in extension settings.
- Support add, edit, remove, reset, and fetch/refresh operations.
- Keep current LinkAPI discovery behavior, migrated onto the shared mechanism.
- Enable a standard OpenAI-compatible `GET /v1/models` attempt for TokenReply, marked Experimental because its response contract has not been live-verified.
- Preserve all existing provider routes, model capabilities, credentials, avatar/sizing controls, and the manual LinkAPI legacy recovery setting.

## Non-goals

- No live request with an API key during development.
- No automatic model discovery or background refresh.
- No provider/model aliasing: user edits change the actual model ID sent to the provider.
- No claim that TokenReply discovery or a particular model is live-verified.

## User Experience

The standard provider/model selector remains the quick path. A **Manage models** action opens a compact per-provider editor:

- Built-in models are visible and can be reset to their registry-defined IDs.
- Local models can be added with an actual Model ID, edited, or removed.
- **Fetch models** appears only when the selected provider declares discovery metadata.
- Fetch adds or refreshes discovered entries, never deleting a manual or edited entry.
- Duplicate IDs collapse to one entry.
- A selected model that is not currently in the list remains visible so persisted settings do not silently change.

For TokenReply, the manager begins with `grok-imagine-image` and `grok-imagine-image-quality`. Fetch models attempts the standard `/v1/models` endpoint only when the user clicks it, and an unsuccessful attempt leaves the current local list untouched.

## Data Model

Persist under the extension settings, keyed by provider:

```js
provider_models: {
  tokenreply: [
    { id: 'grok-imagine-image-quality', source: 'builtin' },
    { id: 'my-provider-model', source: 'manual' },
    { id: 'fetched-model', source: 'fetched' }
  ]
}
```

The registry remains the source of immutable provider defaults and capabilities. Settings are an overlay:

1. Registry built-ins are loaded first.
2. The local provider-model list overlays those entries by exact ID.
3. A local edited built-in is represented as a local entry; reset removes that overlay and restores the registry ID.
4. Fetched/manual entries receive conservative capabilities from the provider discovery profile. For OpenAI Images, that means text-only/no reference images unless live-verified metadata says otherwise.

## Registry Contract

Each provider may declare:

```js
ui: {
  modelDiscovery: {
    endpoint: '/models',
    responseFormat: 'openai-list',
    filter: 'image', // optional provider-specific safe filter
    experimental: true, // optional disclosure
  }
}
```

The discovery function resolves the provider transport/base URL and key from registry/settings, performs one user-triggered `GET`, parses OpenAI-style `{ data: [{ id }] }`, validates IDs, then returns normalized entries. The caller owns persistence and UI messaging.

LinkAPI retains its image-model filtering. TokenReply accepts standard returned IDs but labels the operation Experimental; it does not infer image capability from arbitrary fetched IDs.

## Safety and Failure Behavior

- Never log API keys or Authorization headers.
- Never replace or delete local models after a failed fetch.
- Never automatically retry fetches or image generations.
- Surface HTTP status plus the provider's safe response message in the browser console/UI.
- Reject empty IDs and collapse duplicates after trimming whitespace.

## Testing

Contract tests cover:

1. Registry defaults plus local overlay projection.
2. Editing a model ID changes the selected/request model exactly.
3. Fetch merge preserves manual and edited entries.
4. Duplicate and empty model IDs are handled safely.
5. LinkAPI discovery keeps image-model filtering.
6. TokenReply discovery uses `/v1/models`, uses a user-supplied key only in the request, and leaves settings unchanged on failure.
7. Existing native SillyTavern, LinkAPI proxy, direct Images, avatar, sizing, and legacy fallback tests remain green.

## Rollback

This is a separate commit series on `feature/provider-adapter-architecture`. The existing `provider-adapter-baseline-v1.7.1` tag remains the known-good pre-adapter baseline; this model-manager work can also be reverted as its own commit range without changing provider credentials.
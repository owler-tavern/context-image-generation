# ADR-001: Separate Gallery history from Appearance assets

## Status

Accepted direction; implementation required before the settings branch may merge to `main`.

## Date

2026-08-25

## Context

Gallery is presented as disposable generated-image history. Appearance memory represents durable character, persona, and chat-scoped NPC looks. The testing implementation stored only appearance metadata and used the corresponding Gallery item as the image source.

UAT demonstrated the resulting contradiction: **Clear Gallery** either preserved images the user explicitly asked to clear or removed the only asset behind remembered appearances. A user who remembers an appearance should not need to understand this storage dependency.

## Decision

Give Gallery and Appearance memory independent asset lifecycles.

- Gallery owns disposable generation-history entries.
- **Remember appearance** promotes the selected Gallery artifact into an appearance-owned file store.
- Appearance records reference the promoted asset, never the Gallery entry.
- Character and persona looks follow their durable identity lifecycle.
- Named NPC identity metadata and its looks remain scoped to the chat that created them.
- **Clear Gallery** removes Gallery history only.
- **Remove appearance** removes the look and deletes its promoted asset only when no other look references it.
- Migration promotes existing referenced Gallery assets before severing their Gallery dependency; failure preserves the old data and reports a recoverable state.

## Alternatives considered

### Preserve referenced Gallery entries

Rejected because **Clear Gallery** would not clear the visible Gallery and users would need to understand hidden reference protection.

### Clear Gallery and delete dependent appearances

Accepted only as an interim fail-safe on the testing branch. It is truthful and avoids broken records, but it destroys continuity data during an operation users reasonably understand as history cleanup.

### Store duplicate Base64 data inside appearance metadata

Rejected because extension settings would become a second unbounded image store. Promoted assets must remain file-backed, validated, quota-managed, and reference-counted.

## Consequences

- Appearance storage needs a versioned schema, migration, quota, orphan cleanup, and reference-safe deletion.
- Gallery limits and cleanup no longer need appearance exceptions.
- Clear Gallery becomes predictable and requires no explanation of internal dependencies.
- Existing Gallery-backed looks require an atomic, rollback-safe migration.
- Acceptance must cover durable character/persona looks, chat-scoped NPC looks, shared assets, Gallery clearing, appearance removal, and migration failure.

# ADR-002: Generation entry points and continuity scope

## Status

Accepted.

## Date

2026-09-02

## Context

The extension's primary user motive is to generate an image from the current roleplay scene using a provider and model the user selects or adds. The product had expanded into adjacent visual-story capabilities, including attire state, outfit libraries, cinematic tooling, Story Memory, iteration, and appearance management.

This expansion created a risk that optional continuity and asset-management features would compete with the direct image-generation workflow. It also introduced multiple possible sources of truth for character attire: the current scene and prompt versus separately persisted outfit state.

The product needs an explicit generation boundary so future work does not create additional generation paths or make optional continuity state a prerequisite.

## Decision

### Generation entry points

The extension supports exactly two generation entry points:

1. **Wand click** — generates from the current roleplay message or selected passage with relevant nearby context.
2. **Slash command** — generates from the prompt supplied directly by the user, preserving the original extension capability.

Both entry points must use the same Scene Generation kernel. They may differ in how they capture user intent, context, and delivery target, but they must share provider/model readiness, generation planning, dispatch, duplicate-request protection, and error handling.

Settings configures provider, model, scene preferences, and optional references. Settings must not expose an image-generation action.

No optional feature may introduce another independent generation path. In v2.5, cinematic suggestions and Story Memory may stage inputs only for the next wand. The slash command consumes its explicit prompt and does not consume those staged values.

### Primary generation inputs

Generation relies primarily on:

1. the explicit prompt and current scene;
2. character and persona avatars, when enabled and available;
3. the previous generated image, when explicitly enabled and available.

The prompt and current scene are authoritative. Missing optional references must not block generation or imply incomplete setup.

### Saved character appearance

Saved character appearance is an optional continuity capability. It may contribute a reference when explicitly enabled and available, but it is not part of the required generation path.

The saved-appearance capability must sit behind a removable interface. Removing or disabling it must not require changes to the two generation entry points or the Scene Generation kernel.

### Attire and outfit state

Attire is ordinary scene and prompt content. The target architecture does not include:

- outfit creation or editing;
- outfit libraries;
- outfit selection or locks;
- attire-specific persistence;
- automatic outfit-state extraction or reconciliation;
- attire recovery or migration machinery.

This avoids competing sources of truth. What characters are wearing should be determined from the current scene, prompt, and ordinary character context.

Migration compatibility is deliberately narrower than product behavior. Existing `sceneFacts.outfits` values and historical outfit collections remain readable, opaque rollback data. Ordinary scene reconciliation and successful wand persistence carry `sceneFacts.outfits` forward without interpreting, changing, or injecting it. Historical outfit collections are visible read-only and cannot receive new outfit-specific mutations.

## Target architecture

~~~text
Wand click ---- current scene/context ---+
                                         +--> Scene Generation kernel --> Delivery adapter
Slash command - explicit user prompt ----+

Optional reference contributors:
- character/persona avatars
- previous generated image
- saved character appearance
~~~

The Scene Generation kernel owns prompt and scene normalization, provider/model readiness, one generation plan, dispatch, and normalized generation results. A message-attachment delivery adapter serves the wand; a preview/Gallery delivery adapter preserves slash-command behavior. Optional reference contributors enrich the plan through explicit interfaces and never become generation entry points.

## Consequences

- New generation entry points require revisiting this ADR.
- Slash-command compatibility remains supported.
- Settings remains configuration-only and never generates an image.
- Appearance memory may remain available through progressive disclosure, but it cannot be required for ordinary generation.
- Attire and outfit-management implementation should be retired from the target architecture through a separately planned, migration-safe change.
- Removing attire functionality must preserve user data until the deletion and migration behavior is explicitly designed and approved.
- Opaque legacy `sceneFacts.outfits` values and historical outfit collections remain readable but cannot influence prompts, suggestions, references, or generation plans.
- Story Memory, cinematic tools, iteration, Gallery, and other adjacent features are not approved as generation entry points by this decision.
- Existing Gallery and Appearance asset lifecycles remain separate under ADR-001; this decision does not recombine their storage.

## Verification implications

Architecture and acceptance tests should demonstrate that:

- both entry points reach the shared Scene Generation kernel;
- Settings contains no image-generation action;
- optional reference contributors can be absent without blocking generation;
- no optional feature bypasses shared readiness, dispatch, spending, or attachment controls;
- attire information in the current prompt or scene does not depend on persisted outfit state;
- disabling or removing saved appearance does not alter the core generation interface;
- wand delivery attaches to the captured message while slash delivery preserves its preview/Gallery result.

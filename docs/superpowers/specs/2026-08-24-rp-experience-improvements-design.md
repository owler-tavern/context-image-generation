# RP Experience Improvements Design

**Status:** Proposed for implementation on `codex/rp-experience-improvements`

**Product authority:** `PRODUCT.md`

**Roadmap:** `docs/ROADMAP.md`

## Goal

Improve contextual image generation during roleplay without changing its defining interaction: click the existing message wand and receive an image attached to that message.

## Product constraints

- The normal RP path remains one click.
- No new permanent RP toolbar, provider selector, model selector, prompt box, queue panel, or reference panel.
- Existing spinner, continued roleplay, message attachment, gallery, image swipes, and swipe regeneration remain.
- A selected passage becomes the image's primary subject; nearby context still supplies identity, location, atmosphere, and continuity.
- Hosted providers remain the current scope. Local generation is excluded.
- Complexity appears only when relevant, requested, or required for recovery.

## Delivery stages

### Stage 1: Focus and correctness

1. Selected-text generation with the existing wand.
2. Stable chat/message targeting and stale-result protection.
3. Plain-language provider error classification.

This stage is independently releasable and is the only stage included in the first implementation plan.

### Stage 2: Identity foundation

1. Unified identities for current character, active persona, group characters, named NPCs, and temporary NPCs.
2. Alias-aware resolution from selected text and nearby context.
3. Deterministic reference ranking under provider limits.

Stage 2 requires a separate approved specification after Stage 1 browser acceptance.

### Stage 3: User-controlled continuity

1. Remember an appearance from a generated image.
2. Multiple named looks per identity.
3. Optional previous-scene continuity after character references.

Stage 3 requires a separate approved specification because storage, cropping, identity scope, and migration are independent product decisions.

### Stage 4: Optional intent and automation

1. Optional portrait/establishing-shot intents through the existing menu.
2. Suggested image moments before any automatic generation.
3. Opt-in important-moment automation only after durable idempotency evidence.

## Stage 1 design

### Selected-text interaction

When the user invokes the existing wand, the extension checks the browser selection.

A selection is eligible only when:

- it is non-empty after trimming;
- its range is contained inside the same `.mes` element as the clicked wand;
- it belongs to the rendered message text, not controls, hidden markup, an image caption, another message, or the settings drawer;
- its normalized length is within a documented prompt-focus limit.

If eligible, the extension captures plain text immediately before awaiting any work. The selected passage is passed separately from the complete source message.

If no eligible selection exists, behavior is byte-for-byte equivalent at the prompt-contract level to current whole-message generation.

The prompt builder receives:

```js
{
  sourceMessage,
  focusText: string | null,
  sender,
  messageId,
}
```

When `focusText` is present, the final user content explicitly states that it is the primary visual moment. Existing nearby-message, character-description, avatar, previous-image, and system-instruction behavior remains available as supporting context.

The feature must not mutate the RP message or depend on selection remaining active after the click.

### Stable generation target

At click time, capture a target containing:

```js
{
  chatId,
  messageId,
  messageFingerprint,
}
```

`chatId` uses SillyTavern's stable current chat identifier. `messageFingerprint` is derived from stable message attributes available at click time and is used to detect deletion/replacement rather than as a security hash.

Before attachment, validate that the current chat and target message still match.

- Same chat and message: attach normally.
- Different active chat: do not touch its DOM or save it as the target chat.
- Deleted or replaced target: do not attach by numeric index.
- Unsafe target: retain the image in the extension gallery with its source metadata and show one quiet informational toast.

The first slice does not attempt background mutation of an unopened SillyTavern chat unless a supported host API is found and contract-tested. Correct non-attachment is preferable to writing the wrong chat.

### Error classification

Provider adapters normalize failures into stable categories:

```js
{
  category: 'authentication' | 'rate_limit' | 'model_unavailable' |
    'unsupported_capability' | 'content_policy' | 'network' |
    'empty_result' | 'provider' | 'unknown',
  userMessage,
  technicalMessage,
  status,
  providerId,
}
```

The RP toast shows only `userMessage`. Console diagnostics may include the technical message, status, provider, model, and request ID, but never credentials, Authorization headers, base64, or full private context.

Required user messages:

| Category | Message pattern |
| --- | --- |
| Authentication | `[Provider] rejected the API key. Check it in extension settings.` |
| Rate limit | `[Provider] is busy. Try again shortly.` |
| Model unavailable | `This image model is unavailable. Choose another model in extension settings.` |
| Unsupported capability | `This model cannot use one of the selected image features.` |
| Content policy | `The provider declined this image request because of its content policy.` |
| Network | `Could not reach [Provider]. Check your connection and try again.` |
| Empty result | `[Provider] completed the request but returned no image.` |
| Provider/unknown | `Image generation failed. Try again or check provider settings.` |

Clicking the existing wand again remains the retry behavior. No inline Retry or new persistent error component is added.

## Existing behavior preserved

- Existing message wand and icon placement.
- Spinner and duplicate in-flight target guard.
- Current settings-panel Generate action and slash commands.
- Media-gallery attachment and swipe behavior.
- Opt-in overswipe regeneration.
- File-backed extension gallery.
- Existing provider dispatch and manual LinkAPI recovery route.
- No automatic paid fallback.

## Accessibility and mobile

- Selection behavior must use plain browser selection APIs and degrade to whole-message generation when selection cannot be resolved.
- Keyboard selection followed by keyboard activation of the wand must work.
- Touch text selection must not require a hover-only action.
- Errors are understandable without color and are announced through the existing toast mechanism.
- No interaction depends on long press, because mobile browsers reserve it for text selection and context menus.

## Privacy and security

- Only selected plain text is captured; no selected HTML is sent.
- Selection cannot originate outside the clicked message.
- Logs record selection length, not selected text.
- Error normalization strips credentials and large image payloads.
- Gallery fallback metadata must not store provider credentials or Authorization material.

## Testing strategy

### Deterministic contracts

- Eligible selection inside the clicked message is captured.
- Cross-message, control, empty, and whitespace selections are rejected.
- Whole-message behavior is unchanged with no eligible selection.
- Focus text is primary while complete message/context remains supporting input.
- Target validation accepts the original unchanged message.
- Target validation rejects changed chat, deleted message, and replaced message.
- Unsafe attachment retains the artifact without saving the active wrong chat.
- Representative provider/status/message failures normalize to every category.
- Redaction removes keys, Authorization values, base64, and private request bodies.

### Browser acceptance

- Select part of a bot message and click its wand.
- Select part of a user message and click its wand.
- Click without selection and confirm current behavior.
- Select text in one message and click another message's wand; confirm whole-message behavior for the clicked message.
- Generate, switch chats before completion, and confirm no wrong attachment.
- Exercise invalid-key and simulated rate-limit/network errors.
- Verify desktop mouse, keyboard selection, and narrow/mobile touch selection.
- Confirm swipes and overswipe regeneration remain unchanged.

## Explicit non-goals for Stage 1

- Cancel button or upstream cancellation.
- Inline Retry component.
- New progress UI.
- Prompt editor.
- Identity/reference library.
- NPC appearance persistence.
- Automation or image-moment detection.
- Provider/model controls in chat.
- Local generation.

## Acceptance boundary

Stage 1 is complete only when deterministic tests pass and live SillyTavern browser acceptance confirms selected-text focus, unchanged whole-message behavior, safe cross-chat handling, useful errors, and swipe-regeneration parity. Provider-quality judgments and later identity stages remain separate.

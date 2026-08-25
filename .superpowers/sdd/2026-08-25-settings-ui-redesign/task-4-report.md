# Task 4 Report: Unify Preferences and Images & Cast

## RED -> GREEN evidence

- RED: `node --test test/settings-content-contract.test.mjs` initially reported 5 expected contract failures: the four preference groups, Gallery/Appearance structure, semantic primary actions, and reference-capability feedback were absent.
- RED: after the first GREEN pass, the added gallery-preview/identity-action contract failed because gallery preview was mouse-only and appearance actions had generic labels.
- GREEN: `node --test test/settings-content-contract.test.mjs` passed 7/7 after adding semantic preview and identity actions.
- Focused: settings and RP/gallery/appearance coverage passed 36/36.
- Full: `node --test test/*.mjs` passed 224/224.

## Delivered

- Preferences has visible Image, Scene context, References, and Automation groups in order, with existing control IDs and handlers preserved.
- Unsupported reference-image routes keep saved preferences and show a polite capability note; the note clears when the selected route supports references.
- Images & Cast now shows Gallery before a directly visible Appearance memory section. Empty states explain the RP wand and Remember appearance workflow, while identity copy distinguishes durable user/character identities from chat-local NPCs.
- Generate, clear, gallery preview, and appearance actions are semantic, keyboard-accessible buttons with named outcomes. Gallery actions use 44px touch targets and shared settings focus treatment.
- Touched layout styling moved to named CSS classes while retaining SillyTavern theme variables and responsive layout.

## Commit

`feat: unify preferences and image identity UI`

## Self-review

- Preserved gallery preview, remember/remove/use, protected-artifact retention, and current-chat identity resolution.
- Confirmed every existing preference control remains exactly once and no nested details were added outside the sole Setup Advanced disclosure.
- `git diff --check` is clean for Task 4 content.

## Concerns

- Browser UAT is `NOT TESTED`: this extension requires a running SillyTavern host, and no Chrome DevTools/browser session is available in this workspace. Automated contract, RP, and full-suite evidence is green.

## Review round 1/5

### RED -> GREEN evidence

- RED: image-size projection test showed the missing preservation contract for a stored `4K` preference across unsupported, partially-supported, and restored model capability projections.
- RED: current-chat appearance test could not import visibility/action guards; gallery dialog test could not import a focus controller; content contract lacked the size note and real dialog semantics.
- RED: final visual contract failed until the gallery preview had an inset focus ring and the dialog close control had a 44px target. A final dialog-name/focus test then failed until the dialog was named and its close control had a visible focus state.
- GREEN: focused settings/RP/gallery/dialog coverage passed 58/58.
- GREEN: `node --test test/*.mjs` passed 229/229; `git diff --check` passed.

### Delivered

- Image-size preference projection now keeps the persisted value when a model has no matching size capability, renders a saved-preference note, and restores the selected value when support returns.
- Appearance memory shows durable identities plus only current-chat NPCs. The same visibility guard prevents use/remove changes for a foreign-chat NPC row.
- Gallery preview is a labelled modal dialog with focus transfer, Escape and backdrop dismissal, focus trapping, focus restoration, meaningful image text, and a touch-safe close button.
- Gallery preview focus is inset inside the clipped card, so keyboard focus remains visible.

### Commit

`fix: preserve settings and harden gallery dialog`

### Concern

- Browser UAT remains `NOT TESTED` for the same unavailable SillyTavern host/DevTools session; deterministic behavior and contract coverage are green.

## Review round 2/5

### RED -> GREEN evidence

- RED: the new effective-image-size regression showed that a plan for an unsupported route still copied the persisted `4K` value into `plan.options.imageSize`.
- GREEN: `node --test test/effective-image-size.test.mjs test/generation-plan.test.mjs test/provider-dispatch.test.mjs test/openai-images.test.mjs test/provider-ui-projection.test.mjs test/settings-ui.test.mjs` passed 34/34.
- GREEN: `node --test test/*.mjs` passed 231/231; `git diff --check` passed.

### Delivered

- Generation-plan creation now preserves `settings.image_size` as the durable preference while resolving a separate effective plan value from positively evidenced, allowed model sizes.
- Unsupported routes receive an empty effective size, so host and OpenAI transports omit their resolution/size request fields. Returning to a route which allows `4K` resolves it again without rewriting settings.
- OpenAI Images consumes only the resolved plan image-size option. The legacy compatibility entry point maps its legacy aspect ratio once at the boundary into that same plan option.
- New transport-level regression coverage verifies durable `4K` restoration, empty unsupported plans, and size-free host/OpenAI request payloads.

### Commit

`fix: resolve effective image size per route`

### Concern

- Browser UAT remains `NOT TESTED` for the same unavailable SillyTavern host/DevTools session; deterministic unit, integration, and full-suite evidence is green.

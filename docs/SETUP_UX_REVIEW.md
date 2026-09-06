# Setup screen: end-user review and proposed design

Date: 2026-09-05. Scope: the complete Setup panel in `settings.html`, its state changes in `index.js`, provider/model projections, readiness logic, and supporting CSS. This is a review and design recommendation; no runtime UI changes were made in this review.

## Verdict

Setup does not reliably answer the user's first question: **Which connection and model will generate my next image?** It exposes several implementation tools where the user expects one configuration flow. The main redesign should establish a single active connection and model, explicit activation, and truthful readiness.

The product's existing boundary remains: Settings configures; the message wand and `/proimagine` generate. A setup redesign should preserve that boundary and the user's saved credentials, connections, models, and preferences.

## Evidence and method

- Two independent assessments: Sol reviewed the user journey and information architecture; Terra reviewed detector output and source accessibility/responsiveness. Findings were kept separate until the design assessment completed.
- The parent traced state transitions and exercised `deriveSetupReadiness` with a catalog-only model with no transport: it returned `Ready to generate`. This is a deterministic reproduction of an overclaim, not a live provider test.
- Mechanical detector: one warning in the entire settings file, for the runtime-populated preview image in Characters & Library; zero Setup-specific warnings. A clean mechanical scan does not establish usability.
- Browser inspection was attempted. No usable browser surface was available; opening `http://127.0.0.1:8001/` failed with `Browser is not available: iab`. No rendered layout, actual theme contrast, keyboard walkthrough, mobile interaction, or live provider behavior is claimed.
- No provider calls, settings edits, or image generations were performed during this review.

## Ranked findings

| Priority | Problem and source | End-user consequence | Recommended change |
|---|---|---|---|
| P1 | Active Provider is separate from the custom Saved connection editor. `testCustomConnectionFromEditor` in `index.js` assigns `currentSettings.provider` and may select the first returned model. | Checking a connection silently changes what the next wand uses. Selecting a saved connection for editing does not activate it, despite looking like another selector. | One visible active connection chooser. Save edits and refresh models without activation. Provide an explicit **Use this connection** action for newly added connections. |
| P1 | `deriveSetupReadiness` in `lib/settings-ui.js:15` checks only provider, key presence, and membership in a model list. It does not establish a dispatchable route or successful generation. | Users see Ready and then encounter a gate or unresolved route at generation. | Derive status from the actual generation requirements; distinguish saved configuration, successful catalog access, and successful image generation. |
| P1 | Setup has a primary model dropdown plus an Advanced model list, ID editor, route chooser, Add model, Save ID, and Remove local (`settings.html:56`). | Users cannot tell whether they are choosing a model, editing a catalog entry, or configuring a protocol. Raw catalogs may contain text-only models. | One searchable primary model chooser. Keep manual IDs behind **Enter a model ID**. Show supported image choices first and retain access to unclassified catalog results explicitly. |
| P1 | Experimental permission lives inside model management. Provider/model changes clear approvals; a separate first-generation confirmation also exists. | A user asks to generate but must acknowledge implementation uncertainty through controls unrelated to their task. | Remove the experimental checkbox. Explain limitations next to the selected model. Keep real protocol validation and unsupported-option handling in the runtime. |
| P1 | Advanced setup combines custom-provider creation, protocol/path/auth fields, model management, route summaries, raw diagnostics, cancellation, and last-plan inspection (`settings.html:17-57`). | Adding an ordinary proxy feels like operating an API development console. Finding one setting exposes many unrelated decisions. | Put connection editing in a focused section; reveal technical overrides only for custom connections. Give diagnostics a separate Troubleshooting disclosure. |
| P1 | `cig_managed_model_list` and `cig_managed_model_id` lack explicit programmatic labels (`settings.html:56`). | Advanced model controls have ambiguous accessible names. | Every remaining input/select needs an explicit label. Verify keyboard and screen-reader behavior in the real host. |

Further issues: **Enabled** means eligible to appear in Provider choices, not active; the provider list includes unavailable future integrations; the custom credential has both an editor field and an upper credential field; statuses are distributed across badges, hints, toasts, previews, and warnings. These all reinforce uncertainty about which configuration is in use.

The earlier LinkAPI fetch patch restores visibility of returned IDs. It does not complete the model-selection design: a raw catalog is not a curated list of working image models. The redesign must retain discoverability without silently hiding entries or presenting every ID as image-capable.

## Proposed primary screen

Illustrative returning-user state, not a claim about the user's current configuration:

```text
SETUP

Generate images with
[ My image proxy                         v ]
[ Edit connection ]       [ Add connection ]

Image model
[ Search or select a model               v ]
[ Refresh models ]        Enter a model ID

Connection reached. Models loaded.
Image generation has not been tried with this model.

Use the wand on a chat message to generate an image.

> Troubleshooting
```

The selected connection is the active connection. Its saved name appears consistently in the chooser, status, errors, and any generation progress UI. Selecting another saved connection is an explicit switch and updates the visible model/status together. Remember the last model for each connection.

Show only available, configured connections in this returning-user chooser, including the existing SillyTavern-managed connection. **Add connection** offers supported provider presets and **Custom API**. Unimplemented integrations do not belong among ordinary choices.

First run uses the same screen with an empty state: **Choose an image connection** and the Add connection form. Keep this a single screen with conditional fields, without introducing a mandatory multi-page wizard.

## Connection editing

Common fields: **Connection name**, provider preset, and **API key** where required. Show **Key saved** with a deliberate Replace action instead of duplicating credential inputs.

For Custom API, additionally show **API address** and **API type** with supported choices such as OpenAI Images and Gemini-compatible. These protocol choices are necessary facts; do not guess them from a domain or model name. Explain where to find the choice in the provider's instructions.

Keep model-list and generation-path overrides and non-default authentication under **Advanced connection settings**. Presets supply their existing route defaults. Preserve existing accepted URL formats during implementation; if the form later accepts full base URLs, normalization must be specified and tested rather than silently stripping paths.

| Action | Exact behavior |
|---|---|
| Save connection / Save changes | Save the displayed connection only; preserve the active connection. Show Saved inline. |
| Cancel editing | Discard unsaved form edits; preserve active setup. |
| Refresh models | Read that saved connection's catalog; update only its model list and check result. Do not activate it or overwrite a selected model. |
| Use this connection | Explicitly activate the saved connection and its chosen model. Show its name in the primary chooser/status. |
| Choose another active connection | Switch explicitly and restore its last model. Never reuse an unrelated model merely because it occupied a global field. |

An inactive editor should say **Editing [name]. Images currently use [active name].** This warning is only needed while the two differ. Unsaved edits should remain visibly unsaved; checking a saved connection must not pretend to test unsaved input.

## Model selection

- Keep a single searchable chooser and display the actual ID alongside any friendly label.
- Known image models appear first. Unclassified results remain accessible through **Show all returned models**, clearly labeled **Image support not confirmed**. Explain if no image models could be identified.
- A user-configured protocol plus a chosen model permits a minimal generation attempt through the existing wand/slash flow. Unknown optional capability support remains disabled with a plain explanation, such as **Reference images are unavailable for this model**.
- A model with no usable protocol is a real setup problem. Show **Choose the API type for this model** and take the user to the relevant connection setting. A checkbox cannot resolve that missing information.
- Preserve the selected model on refresh. If it disappears from the catalog, retain it with **Not in the latest model list**; do not silently select the first result. Whether it can still be tried depends on the saved route, not catalog membership alone.
- Manual-ID entry is an escape hatch in this same flow, not a second competing model manager.

## Truthful status and recovery

One persistent status area should state the active connection/model, the current outcome, and one relevant next action. Keep technical details expandable.

| State | User-facing message / action |
|---|---|
| Missing credentials | **Add your API key** → Edit connection |
| Saved but unchecked | **Connection saved. Models have not been loaded.** → Refresh models |
| Catalog fetch running | **Loading models from [name]…**; keep selected configuration visible |
| Catalog access succeeded | **Connection reached. Models loaded. Image generation has not been tried.** |
| No identified image models | **The connection returned models, but image support is unknown.** → Show returned models / Enter model ID |
| Missing protocol | **Choose the API type before generating.** → Edit connection |
| Model can be attempted | **Use the wand on a chat message to try this model.** |
| Image generation succeeded | **Last image generated successfully with [connection / model].** Scope evidence to the unchanged connection/model. |
| Key rejected | **[Connection] rejected the API key.** → Edit key |
| Fetch failed | **Could not load models. Your current selection is unchanged.** → Retry / Details |
| Generation failed | Name the active connection and the actionable reason. Keep the chat, selected model, and saved settings intact. |

A successful catalog request must never imply successful image generation. Avoid a green Ready claim when a known runtime gate will reject the request. Do not add a settings-only paid test-generation action; the existing generation entry points remain the acceptance path.

## What to preserve

- The basic provider/credential/model order and separation from visual preferences and character settings.
- Native controls, host theme integration, keyboard-friendly disclosures, responsive stacking, and accessible busy/status mechanisms already present in source.
- Catalog failure preservation, cancellation support, explicit destructive confirmation, and conservative handling of optional image features.
- Existing transport adapters and validation boundaries. This redesign needs a clearer state/presentation contract, not provider rewrites.

## Heuristic assessment

Independent design-review severity, 0 = no identified issue, 4 = severe task blocker. These are expert judgments from source and reported user confusion, not measured user success rates.

| Heuristic | Severity | Quality equivalent (4 minus severity) |
|---|---:|---:|
| Status visibility | 3 | 1 |
| User language | 3 | 1 |
| Control and freedom | 2 | 2 |
| Consistency | 3 | 1 |
| Error prevention | 3 | 1 |
| Recognition over recall | 3 | 1 |
| Efficiency | 1 | 3 |
| Minimalism | 3 | 1 |
| Recovery | 2 | 2 |
| Help | 2 | 2 |
| Total | 25/40 | 15/40 |

Normalized heuristic health: approximately 38/100. The separate technical assessment found sound source-level UI primitives; that does not offset the journey failures. Visual/aesthetic quality remains unscored without rendering.

## Cognitive walkthroughs and acceptance criteria

| User task | Current risk | Redesign acceptance |
|---|---|---|
| First-time hosted-provider setup | Many provider options, uncertain model availability, readiness overclaim | Choose preset, enter key, load models, choose model, explicitly use connection; see an accurate next step. |
| Add a custom proxy | Protocol editor is buried; fetch changes the active setup | Save and inspect a new proxy without changing an existing LinkAPI setup. Activate only through an explicit action. |
| Return after a week | Saved, enabled, editor-selected, and active are easy to confuse | Identify next generation's connection and model directly on opening Setup. |
| Switch between two providers | Global selection and cleared approvals add friction | Restore each connection's model, show the new active pair, and preserve unrelated preferences. |
| Recover from failed fetch | Catalog, connection, and generation success look similar | Keep the current choice, show a persistent error and retry, never report successful generation from a catalog response. |
| Use keyboard / screen reader | Unnamed Advanced model controls | Every control has a name; focus remains predictable after refresh; errors and active changes are announced. |

First-timer red flag: finding a proxy requires opening a technical section before understanding the active provider. Returning-user red flag: inspecting one saved connection can coexist with a different active one. Power-user red flag: checking a draft can change the live choice. These are distinct failures of the same state model.

## Recommended implementation sequence

1. Define and test active versus editing connection state; remove hidden activation from model fetching. Use `/journey` and `/organize` for this contract.
2. Unify connection controls and the model chooser; preserve persisted settings and per-connection model choices. Use `/articulate` for action labels and `/include` for accessible controls.
3. Replace experimental consent with inline capability information and align readiness with real runtime requirements. Use `/fortify` for failure states and recovery.
4. Verify the complete first-run, custom-add, switch, refresh-failure, reload, and live-generation paths in SillyTavern. Confirm desktop and narrow-width layouts under the host theme.

Questions skipped: the reported confusion and product boundary establish the redesign priority. This document proposes the change; implementation and live acceptance are not claimed.

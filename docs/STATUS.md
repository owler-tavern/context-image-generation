# v2.5 status

## Objective
Ship the consolidated branch review and September 16 user feedback on `codex/v2.5`, preserving both local installations and existing user data.

## Current milestone
Extension review shipped. Follow-up host correction: SillyTavern patched and offline verified; TauriTavern source/build work in progress.

## Completed
- Integrated Add/Edit connection beside the active connection selector, with focus and explicit activation.
- Combined model search, selection, and refresh; removed blank conditional actions and garbled labels.
- Simplified Scene details to Generation instruction; removed empty Automation UI and retired preference handlers. Legacy saved values remain inert.
- Kept reference controls visible with supported/unsupported/unknown explanations and preserved choices across model changes.
- Preserved source-story prompts; added an explicit aspect-ratio instruction while retaining structured request fields.
- Preserved exact provider model IDs. Added current final Gemini choices only for Google AI Studio; host migration metadata produces a nonblocking advisory.
- Recovered stale-target/chat-save-failure images even when optional Gallery is disabled. Recovery awaits settings persistence and errors do not announce success.
- Preserved sanitized HTTP-200 host errors and provider/model attribution; repaired string-message prompt flattening.
- Restored the missing tracked test helper, added `npm test` and GitHub Actions, and set release metadata to 2.5.0.
- Removed four obsolete tracked agent reports/specs; ignored local attachment caches and working notes without deleting them. Retained decision records and compatibility data.

## Verification
- Host follow-up: installed SillyTavern handler and prompt converter passed 55 offline assertions across 12 image cases after reproducing 15 failures before the fix. Exact preview IDs, three aspect ratios, resolution, and both avatar byte strings are preserved. Fetch was stubbed; no provider request was made.
- Extension suite after host-patch tooling: **957 passed, 0 failed**. Host JavaScript syntax check passed.
- Final integrated `npm test`: **954 passed, 0 failed**, including the previously missing no-spend helper. The committed Git archive was independently extracted into a clean temporary directory and also passed all 954 tests.
- Initial full run: 952 passed, 2 failed. Both were obsolete assertions for intentionally removed behavior: no Gallery recovery on thrown chat-save errors, and the retired visual-preference handler. Corrected expectations and reran the whole suite.
- Independent Sol source review: no remaining P1 implementation finding after correcting host model scoping and consistent recovery visibility.
- Actual SillyTavern 1.18.0 staging host, isolated temporary profile on loopback port 8017: Add opens/focuses editor; Close hides it; custom credential-free connection saves without switching the active provider; model search filters actual options; no visible blank CIG buttons; retired controls absent.
- Browser Gemini model switch: avatar preference remained checked/enabled and 16:9 remained selected. 390px viewport: panel clientWidth/scrollWidth both 381px. Screenshot inspected.
- Browser tests used no user chats/credentials and sent no provider catalog or generation request. An unrelated global Extension Manager startup notice was dismissed.

## Known limitations
- Installed SillyTavern backend was corrected locally to accept the two Gemini 3 preview image IDs and preserve absent optional image settings. Restart SillyTavern to load the change. Host updates may overwrite it; the repeatable patch and offline verifier are documented in `docs/HOST_GEMINI_FIX.md`. Updating the extension alone does not patch the host.
- Real provider-generated dimensions, image quality, and avatar likeness remain **NOT VERIFIED**. No paid generation was performed.
- Native TauriTavern runtime remains **NOT VERIFIED**; browser acceptance was performed in SillyTavern. Both receive the same extension files, not a claim of identical host behavior.
- Broad entrypoint refactoring and thumbnail/decode performance optimization are deferred: no measured performance problem or safe migration evidence justifies a broad rewrite in this fix release.

## Decisions
Wand and slash remain the only generation actions. No automatic retries, model aliases, generation timeout, or legacy user-data purge was introduced. See the consolidated review for issue disposition.

## Next action
Reload both applications after the synchronized branch update. Validate actual provider dimensions and avatar likeness on an explicitly selected compatible host/provider route; native TauriTavern acceptance remains outstanding.

# v2.5 status

## October 9 scene-only prompt filtering
- Objective: send narration/dialogue rather than scene plans, tracker text, nested visual dashboards, or hidden thoughts.
- Preset correction: the supplied scene was one example, not a universal schema. Removed the `<prose>`-only assumption; preserve narrative outside/inside any wrapper and exclude positively identified metadata. Extended tag spelling variants, metadata HTML attributes/summary labels, and paired bracket blocks. No model call or host regex execution is introduced.
- Current state: raw clicked-message text also entered the supporting-context prompt and scene/cast inference.
- Target and scope: one dependency-free scene-text extractor and prompt assembler at the shared capture boundary; reuse providers, references, generation instructions, delivery, and original chat/target fingerprints.
- Stages: remove identified metadata across preset structures; clean supporting context and validate selected focus; exercise final provider payloads and run regressions.
- Implemented: shared filtering for wand/slash, cleaned inference and context, metadata-only failure before provider dispatch. No stored messages or settings are rewritten.
- Verification before preset correction: **976 tests passed, 0 failed, 0 skipped** (`npm test`), including 12 new scene-filter tests. Neutral fixtures mirror the supplied wrapper structure; Gemini proxy/native request builders and mocked OpenAI Images dispatch contain only the cleaned scene plus existing instructions. JavaScript syntax and `git diff --check` passed. No provider/network call was sent.
- Preset correction verification: **980 tests passed, 0 failed, 0 skipped** in the final `npm test` after all review fixes. Includes 16 scene-filter tests covering alternative wrappers, unwrapped narrative, HTML metadata containers, summary labels, and paired brackets. Syntax and diff checks passed. These fixtures are simulated formats, not acceptance evidence for every user preset.
- Critique/fixes: independent reviewer identified two P2 text-preservation issues (longer closing code fences and the word `hidden` inside quoted attribute values). Both corrected and regression-tested; re-review approved with no new findings. Initial targeted-test failures also exposed fixture whitespace and missing dispatch-harness route/signal fields; the corrected harness reaches the mocked endpoint. The final full run followed all code changes.
- Preset correction critique: independent reviewer identified occurrence-level bracket pairing and quote-aware summary parsing issues, including bracket-like text inside comments/attributes and nested summary formatting. All reported examples now have passing regression assertions. The shared quote-aware token stream is reused for those paths. Review stopped after three rounds as required by the critic policy.
- Risks: unknown unwrapped tracker formats cannot be identified universally; incomplete omitted blocks discard their remainder. Installed-host and paid-provider behavior remain unverified.
- Next action: use short boundary snippets from the owner's other presets to establish rules for remaining unlabelled/unknown trackers, then verify actual installed-host prompts. This is not universal preset acceptance.

## Objective
Add the exact LinkAPI Nano Banana 2.1 model on `codex/v2.5`, preserving the previous Nano Banana 2 controls and the existing generation/delivery workflow.

Previous release objective:
Ship the consolidated branch review and September 16 user feedback on `codex/v2.5`, preserving both local installations and existing user data.

## Current milestone
October 7 follow-up: LinkAPI `gemini-nano-banana-2.1` native Gemini integration is implemented and mock-verified on `codex/v2.5`; all 964 regression tests pass. Live provider/browser acceptance remains open.

Extension review shipped. Follow-up host correction: SillyTavern patched and offline verified; TauriTavern stable 2.2.0 replacement built and tested, staged pending closure of the running app for smoke testing and installation.

## October 7 implementation plan
- Current state: LinkAPI Gemini presets use the host proxy, whose image-model allowlist does not include the new gateway ID.
- Target: a selectable built-in model sends native `contents` to the exact user-supplied `https://linkapi.ai/v1beta/models/gemini-nano-banana-2.1:generateContent` endpoint, using the existing LinkAPI key and generation coordinator.
- Extend the registry, route-evidence contract, and dispatch adapter boundary; reuse bounded response reading, image decoding, error normalization, model discovery, and UI projection. Preserve all existing routes and saved selections.
- Stages: add the curated native route and adapter; exercise selection/discovery/reload and mocked dispatch success/failures; run the complete regression suite and inspect the final diff.
- The owner confirmed that all previous Nano Banana 2 features are available for this model. Preserve the same four-reference extension limit, image sizes, aspect ratio, thinking, and Google Search controls; translate them into native Gemini fields. This is an owner-supplied compatibility requirement, not live provider verification.
- Live browser CORS and paid provider generation require separate acceptance evidence. Rollback is the narrow extension commit; no host patch, credential migration, or saved-model rewrite is required.

## Completed
- October 7: added the exact Nano Banana 2.1 model and native route using the existing LinkAPI key. Preserved avatar/previous-image bytes and full ordered prompts; added native aspect ratio, 512px–4K resolution, thinking, and Google Search fields. Existing model routes, saved selections, delivery, and catalog safety remain unchanged.
- Follow-up cleanup: removed runtime handlers/rendering for retired Automation controls, manual-retrigger/focus/settings-update helper APIs, unused automatic-generation/swipe defaults, and retired scene-preference interpretation/defaults. Existing bounded saved values remain opaque compatibility data; active optional cinematic cards retain their runtime. Removed obsolete tests alongside deleted APIs and retained migration regression coverage.
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
- October 7: **964 tests passed, 0 failed, 0 skipped** (`npm test`), including 16 new native-route tests. These exercise UI projection, catalog refresh/reload, settings migration, exact URL/auth/payloads, all image-size/thinking options, avatar/previous-image byte preservation, validated image decoding, HTTP and HTTP-200 errors, credential redaction, redirects, cancellation, and bounded response reading. Fetch is mocked; no paid request was sent.
- October 7 syntax checks and `git diff --check` passed. Source critique found no remaining implementation blocker; direct-browser CORS and real provider capability acceptance remain the principal open risks.
- October 7 initial checks: one new test incorrectly expected fetched copies to retain built-in route evidence; corrected it to exercise the curated selection after reload. The first full run passed 963/964; its sole failure was the expected LinkAPI help-copy fixture, updated for the new route. The complete rerun passed.
- October 7 `npm audit --omit=dev` could not run (`ENOLOCK`): this dependency-free repository has no lockfile. No dependency was added.
- Retired-feature cleanup: **948 tests passed, 0 failed**; syntax and diff checks passed. Nine fewer tests overall reflect removed API tests and added legacy roundtrip coverage. No new browser or provider verification was performed for this cleanup.
- Host follow-up: installed SillyTavern handler and prompt converter passed 55 offline assertions across 12 image cases after reproducing 15 failures before the fix. Exact preview IDs, three aspect ratios, resolution, and both avatar byte strings are preserved. Fetch was stubbed; no provider request was made.
- Extension suite after host-patch tooling: **957 passed, 0 failed**. Host JavaScript syntax check passed.
- TauriTavern stable `v2.2.0` host: exact-model allowlist correction and regression test implemented; standard release executable built successfully. Frontend/type checks, 890 contract tests (3 skipped), Rust crate-boundary checks, split-crate Rust tests (including 646 application tests), 5 host-resource tests, and development workspace compilation passed. The full modality regression is included. Native launch and installation remain pending.
- TauriTavern Clippy ran but failed on three `result_large_err` findings in unchanged `tt-adapter-sync/src/sync/job_executor.rs` at lines 62, 123, and 182. The overall required gate is therefore **PARTIAL**, not green; no unrelated sync changes were made.
- Final integrated `npm test`: **954 passed, 0 failed**, including the previously missing no-spend helper. The committed Git archive was independently extracted into a clean temporary directory and also passed all 954 tests.
- Initial full run: 952 passed, 2 failed. Both were obsolete assertions for intentionally removed behavior: no Gallery recovery on thrown chat-save errors, and the retired visual-preference handler. Corrected expectations and reran the whole suite.
- Independent Sol source review: no remaining P1 implementation finding after correcting host model scoping and consistent recovery visibility.
- Actual SillyTavern 1.18.0 staging host, isolated temporary profile on loopback port 8017: Add opens/focuses editor; Close hides it; custom credential-free connection saves without switching the active provider; model search filters actual options; no visible blank CIG buttons; retired controls absent.
- Browser Gemini model switch: avatar preference remained checked/enabled and 16:9 remained selected. 390px viewport: panel clientWidth/scrollWidth both 381px. Screenshot inspected.
- Browser tests used no user chats/credentials and sent no provider catalog or generation request. An unrelated global Extension Manager startup notice was dismissed.

## Known limitations
- October 7 Nano Banana 2.1: native browser CORS, live key/model acceptance, actual resolution/aspect ratio, generated-image quality, and reference likeness remain **NOT VERIFIED**. Full feature parity is enabled per the owner's explicit requirement; mocked payload/response tests do not establish provider behavior. No authenticated provider call or installed-host UI smoke test was performed for this addition.
- Installed SillyTavern backend was corrected locally to accept the two Gemini 3 preview image IDs and preserve absent optional image settings. Restart SillyTavern to load the change. Host updates may overwrite it; the repeatable patch and offline verifier are documented in `docs/HOST_GEMINI_FIX.md`. Updating the extension alone does not patch the host.
- Real provider-generated dimensions, image quality, and avatar likeness remain **NOT VERIFIED**. No paid generation was performed.
- Native TauriTavern runtime remains **NOT VERIFIED**; browser acceptance was performed in SillyTavern. Both receive the same extension files, not a claim of identical host behavior.
- TauriTavern's running 2.2.0 executable still has the old model gate. The corrected standard executable and verified original backup are prepared. The user was asked to save/close the app before replacement because its single-instance plugin prevents a reliable isolated smoke launch while the original remains active. No app or profile data was replaced.
- Broad entrypoint refactoring and thumbnail/decode performance optimization are deferred: no measured performance problem or safe migration evidence justifies a broad rewrite in this fix release.

## Decisions
Wand and slash remain the only generation actions. No automatic retries, model aliases, generation timeout, or legacy user-data purge was introduced. See the consolidated review for issue disposition.

Removed UI features should not retain executable handlers, helper APIs, or new defaults without an active caller. Retained legacy scene values and retrigger session records are bounded compatibility data only, so an ordinary save does not unnecessarily destroy user data. Optional cinematic observation/staging still has active UI callers and is not removed by the retired-settings cleanup.

## Next action
Reload/update the extension, select **LinkAPI → Nano Banana 2.1**, and perform a live generation with the existing LinkAPI key to confirm browser CORS and provider acceptance of the enabled controls. Keep generated quality/dimension/reference evidence separate from the deterministic suite.

Historical host follow-up:
After the user saves/closes TauriTavern, smoke-test the staged standard executable with its isolated portable marker, then replace only the installed executable after rechecking its original hash. Do not copy the portable marker into the installed directory. Restart SillyTavern to load its host patch. Actual provider dimensions and avatar likeness remain unverified.

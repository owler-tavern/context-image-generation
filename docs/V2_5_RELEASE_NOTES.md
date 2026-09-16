# v2.5 release notes

Version: **2.5.0**. Generation entry points remain the message wand and `/proimagine` (aliases `/proimg`, `/geminiimg`); both use the shared kernel. Settings actions are configuration-only and never generate images. Catalog discovery does not verify a generation route or image quality.

## Changes
- Add/Edit connection opens a focused editor directly below the active connection selector. Saving a new connection does not activate it automatically.
- Model search, selection, and Refresh Models share one area. Blank readiness actions and garbled separators are fixed.
- Scene details contains only Generation instruction. Empty Automation UI is removed. Retired depth/framing/continuity/custom-direction values remain stored but inert.
- Avatar and previous-image controls remain visible across model changes, with explanations when capability is unknown or unsupported. Saved preferences are retained.
- Source-story text stays authoritative. Aspect ratio remains in structured requests and now has an explicit prompt instruction as well.
- Host model migrations produce an advisory, not a silent provider-model substitution. Google AI Studio has explicit current final Gemini options; LinkAPI IDs are not invented or renamed.
- HTTP-200 host errors retain sanitized reasons and provider/model attribution. String-format message content is preserved in Images prompts.
- Stale-message and chat-save-error images get durable Gallery recovery even if the optional Gallery is off. Failed recovery persistence does not claim success.
- Clean-checkout tests now work through `npm test`; CI runs them on pushes and pull requests. Obsolete agent reports were removed.

## Compatibility and evidence
Legacy outfit data remains inert and preserved. Optional Story Memory, cinematic suggestions, Appearance Memory, Gallery, and Improve tools do not add generation actions. Cinematic suggestions and Story Memory stage context for the next wand only.

954 deterministic tests passed. Isolated SillyTavern browser checks verified settings interactions and narrow layout; see `STATUS.md` for exact evidence. Native TauriTavern and paid-provider generation are **NOT VERIFIED**.

Some SillyTavern versions omit image configuration for exact preview model IDs. The follow-up includes an opt-in, backed-up host patch and offline verifier; see `HOST_GEMINI_FIX.md`. The installed SillyTavern host correction passed 55 request assertions, and the extended extension suite passed 957 tests. Host changes are separate from extension updates. Actual provider dimensions and avatar likeness remain unverified.

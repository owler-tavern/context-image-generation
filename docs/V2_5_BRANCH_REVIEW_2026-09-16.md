# Consolidated v2.5 review and implementation

Updated 2026-09-16. This combines the branch review and all eight user feedback items. Original reviewed GitHub revision: `cdd52f0`. Current acceptance evidence and release limits: [STATUS.md](STATUS.md).

| Priority | Issue / requested outcome | Disposition |
| --- | --- | --- |
| P1 | Add connection appears ineffective; separate bottom editor | Implemented and browser verified: integrated top editor opens, focuses, closes, saves, and activates explicitly. |
| P2 | Blank action and garbled model/readiness labels | Fixed conditional visibility and encoding; browser found zero blank visible CIG buttons. |
| P2 | Separate model search is confusing | Search, selector, and Refresh Models consolidated; browser filtering verified. |
| P2 | Scene details should contain only general instruction/prompt | Implemented. Removed depth/framing/continuity/custom-direction controls and active overrides; preserved stored legacy values. |
| P1 | Avatar references disappear on model changes | Fixed visibility/capability projection. Supported Gemini remains enabled; unknown/unsupported models remain visible-disabled with explanation. Browser confirmed saved avatar choice survives switching. |
| P2 | Empty Automation section | Removed. No automatic generation restored. |
| P1 | Aspect ratio ignored; avatar adherence regressed | Request fields retained, explicit ratio prompt added, original story text restored. Installed host exact-ID allowlist mismatch identified. Advisory added without changing provider IDs. Actual generated dimensions/likeness remain unverified and host-bound for affected preview IDs. |
| P1 | Stale-message/chat-save-error image recovery loses visible output | Fixed recovery independent of optional Gallery; durable save awaited, failed persistence reports failure, existing file preview retained. Regression tests pass. |
| P1 | HTTP-200 host errors lose real cause/provider | Fixed sanitized error envelopes and provider/model attribution; formerly untracked regressions now included. |
| P1 | Missing ignored test helper breaks fresh checkout | Recovered helper into tracked test/support; package test command and CI added. Complete suite passes. |
| P2 | Images adapter drops string-content messages | Fixed and regression-tested. |
| P2 | Divergent local installations | Existing SillyTavern fixes reconciled into this branch; original local work backed up before synchronization. Final Git receipt is recorded separately. |
| P2 | Outdated release/status documentation | Reconciled version 2.5.0, user/developer guides, release notes, and this single issue ledger. |
| Improvement | Unnecessary repository artifacts | Removed four obsolete agent reports/specs already deleted in the other installation. Ignored local task attachments/notes, preserving their contents. Kept decision records and user data. |
| Improvement | Large entrypoint / potential memory costs | Deferred broad rewrite and speculative thumbnail/decode optimization; removed obsolete UI handlers and per-keystroke visual-direction saves. No performance gain claimed without measurement. |
| Acceptance | Both-host/provider/image-quality proof | SillyTavern settings browser acceptance and 954 deterministic tests pass. Native TauriTavern, live provider dimensions, and avatar likeness remain NOT VERIFIED. |

## Release boundary

Implemented fixes are suitable for the requested development-branch push. This is not full cross-host or live-provider release acceptance. No provider request, silent model rename, automatic generation retry, timeout reintroduction, or user asset purge was performed.

## Implementation sequence

1. Inventory both checkouts and preserve pre-existing work.
2. Implement UI, provider, and recovery changes with disjoint ownership.
3. Restore clean-checkout test infrastructure and remove confirmed obsolete artifacts.
4. Independent Sol review; correct findings; run full suite and isolated browser acceptance.
5. Commit and push `codex/v2.5`; align installations after backing up original local changes.

Rollback: prior tracked branch revision remains in Git; local-only changes are preserved in a separate backup before synchronization. Retired preferences and assets are retained for compatibility.

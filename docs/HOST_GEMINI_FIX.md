# Gemini preview image settings: host correction

The extension sends the exact selected model, aspect ratio, image resolution, and reference images to the host. An outdated host image-model allowlist can drop `responseModalities` and `imageConfig` while still forwarding the reference images. Adding a ratio instruction to the prompt does not repair this boundary.

## SillyTavern

The September 16 local correction adds `gemini-3-pro-image-preview` and `gemini-3.1-flash-image-preview` to the known image-model list. It also prevents absent optional ratio/resolution fields from becoming the string `undefined`. It never renames the selected model.

From this extension directory, substitute your actual host directory:

```powershell
node scripts/patch-sillytavern-gemini.mjs --host-root '<SillyTavern directory>'
node scripts/patch-sillytavern-gemini.mjs --host-root '<SillyTavern directory>' --apply
node scripts/verify-sillytavern-gemini.mjs --host-root '<SillyTavern directory>'
```

The first command checks without writing. Applying creates an original-file backup under the OS temporary directory and prints its path. The patch is idempotent and rejects unfamiliar host mappings. Restart SillyTavern after application. To undo, stop the host and restore the printed backup only if no later host changes need preserving.

Host updates can replace the correction. Rerun the verifier after updates; do not blindly restore an old host file over a newer release. Installing/updating this extension does not automatically modify host code.

## Evidence and limits

The verifier extracts the installed host's actual request handler and prompt converter and replaces transport with a local recorder. Before correction: 15 failing assertions. After correction: 55 passing assertions across 12 image cases, covering exact model URLs, 16:9/9:16/1:1, 1K resolution, two reference-image payloads, and optional settings. This is an offline request-conversion test, not a live provider or full runtime test.

Existing TauriTavern request logs also showed reference image parts present when structured image settings were absent. Avatar likeness is not proven merely by successful transmission. Actual output dimensions and likeness require an explicitly authorized provider generation.

## TauriTavern

TauriTavern 2.2.0 compiles this conversion into its native executable. Its source image allowlist omits `gemini-3.1-flash-image-preview` in `src-tauri/crates/tt-application/src/services/chat_completion_service/payload/makersuite.rs`. The extension cannot patch the running native handler.

The correction adds that exact ID and extends the existing image-settings regression test. The focused Rust test passed against both development source and the installed version's stable `v2.2.0` tag (`2b4de4b8`). The standard desktop release build succeeded against stable, with no unrelated development changes. Native launch and installation are pending. A portable-feature executable must not replace the standard installed executable because it selects a different data location.

The durable source diff is `docs/patches/tauritavern-gemini-preview.patch`. Apply it only to a compatible TauriTavern source checkout, after `git apply --check`; it is not an extension patch or executable. Its production change is one additional exact model ID. The regression test checks both preview models for the complete text/image modality list, requested resolution, and aspect ratio. Rebuild using TauriTavern's documented standard desktop build and verification commands. An upstream app update may supersede this local correction; never copy an old executable over a newer version without reviewing compatibility.

Build preparation used an isolated Rust/Cargo installation under the OS temporary directory, leaving the user's toolchain and PATH unchanged. The first build attempt passed frontend bundling but could not locate Cargo in its child process; setting PATH within the build process corrected that issue. The standard release profile uses full LTO and one codegen unit, so a cold native build can take substantially longer than the focused Rust tests.

Built executable: version `2.2.0`, 50,979,328 bytes, SHA-256 `17B411EC320F9A849C31ED475CE758A7B313B9C91F3591709CE7E217A7418315`. Original installed executable: 58,212,864 bytes, SHA-256 `60EC274988A6EE4F204C84D77B261EE35BFE51DA3DA46ECE1AAF93C3D273EB85`. The original has a verified local backup before replacement.

Validation: frontend/type checks, 890 contract tests (3 skipped), Rust crate boundaries, split-crate workspace tests (646 application tests), 5 host-resource tests, and development workspace compilation passed. Clippy executed but reported three `result_large_err` findings in unchanged `tt-adapter-sync/src/sync/job_executor.rs` at lines 62, 123, and 182. The overall gate remains partial. Initial check prerequisites were corrected in the isolated environment: Git Bash for Linux-installer tests, network access for cross-platform crate inspection, and the Clippy component.

Installation is pending the user saving/closing the running app. TauriTavern's single-instance plugin means a second launch can activate the old app rather than validate the replacement. First smoke-test the staged standard build using `portable.flag` and isolated data beside that executable. Then close the test app, verify the installed original has not changed, and replace only the standard executable with the built file. Never copy the test portable marker into the installed application directory. Preserve the original executable backup; no user profile migration or provider generation is part of this correction.

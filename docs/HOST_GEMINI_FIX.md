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

TauriTavern 2.2.0 compiles this conversion into its native executable. Its source image allowlist omits `gemini-3.1-flash-image-preview` in `src-tauri/crates/tt-application/src/services/chat_completion_service/payload/makersuite.rs`. The extension cannot patch the running native handler. A source correction and rebuilt application are being prepared; native runtime verification remains pending.

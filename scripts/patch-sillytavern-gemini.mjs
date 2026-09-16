import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const PREVIEW_MODELS = ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'];

/** Narrow, idempotent patch for hosts with the known Gemini exact-ID gate. */
export function patchSillyTavernGeminiSource(source) {
    const start = source.indexOf('async function sendMakerSuiteRequest(');
    const end = source.indexOf('\nasync function ', start + 1);
    if (start < 0 || end < 0) throw new Error('Unrecognized host request handler; no changes made.');
    const handler = source.slice(start, end);
    const list = /const imageGenerationModels = \[([\s\S]*?)\];/u.exec(handler);
    if (!list || !handler.includes('requestImages && imageGenerationModels.includes(model)')) {
        throw new Error('Unrecognized host image-model gate; no changes made.');
    }
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const missing = PREVIEW_MODELS.filter(model => !list[1].includes(`'${model}'`) && !list[1].includes(`"${model}"`));
    const replacement = missing.length
        ? list[0].replace(/[ \t]*\];$/u, `${missing.map(model => `            '${model}',`).join(newline)}${newline}        ];`)
        : list[0];
    let nextHandler = handler.replace(list[0], replacement);
    for (const field of ['request_image_aspect_ratio', 'request_image_resolution']) {
        const oldValue = `String(request.body.${field})`;
        const fixedValue = `String(request.body.${field} ?? '')`;
        if (!nextHandler.includes(oldValue) && !nextHandler.includes(fixedValue)) {
            throw new Error(`Unrecognized host ${field} mapping; no changes made.`);
        }
        nextHandler = nextHandler.replace(oldValue, fixedValue);
    }
    return source.slice(0, start) + nextHandler + source.slice(end);
}

async function main() {
    const args = process.argv.slice(2);
    const hostIndex = args.indexOf('--host-root');
    if (hostIndex < 0 || !args[hostIndex + 1]) {
        throw new Error('Usage: node scripts/patch-sillytavern-gemini.mjs --host-root <SillyTavern directory> [--apply]');
    }
    const file = resolve(args[hostIndex + 1], 'src/endpoints/backends/chat-completions.js');
    const before = await readFile(file, 'utf8');
    const after = patchSillyTavernGeminiSource(before);
    if (before === after) return console.log(JSON.stringify({ status: 'already-patched', file }));
    if (!args.includes('--apply')) return console.log(JSON.stringify({ status: 'patch-required', file, models: PREVIEW_MODELS }));
    const backupRoot = join(tmpdir(), 'cig-host-backups');
    await mkdir(backupRoot, { recursive: true });
    const backupDirectory = await mkdtemp(join(backupRoot, 'gemini-'));
    const backup = join(backupDirectory, 'chat-completions.js');
    await writeFile(backup, before, 'utf8');
    // Refuse to overwrite a host file that changed after inspection.
    if (await readFile(file, 'utf8') !== before) throw new Error('Host file changed while preparing the patch; no changes made.');
    await writeFile(file, after, 'utf8');
    console.log(JSON.stringify({ status: 'patched', file, backup, models: PREVIEW_MODELS }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

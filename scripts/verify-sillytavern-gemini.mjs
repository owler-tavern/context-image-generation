#!/usr/bin/env node
/**
 * Offline regression harness for SillyTavern's installed Gemini endpoint.
 *
 * It loads the host's real prompt converter and MakerSuite handler into a VM,
 * replaces only fetch with a local recorder, and never reads credentials.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { buildGeminiProxyRequest } from '../lib/providers/gemini-proxy.js';

const argv = process.argv.slice(2);
const hostRootIndex = argv.indexOf('--host-root');
if (hostRootIndex === -1 || !argv[hostRootIndex + 1] || argv.some(arg => arg === '--help' || arg === '-h')) {
    console.error('Usage: node scripts/verify-sillytavern-gemini.mjs --host-root <SillyTavern-root>');
    process.exitCode = 2;
} else {
    await main(path.resolve(argv[hostRootIndex + 1]));
}

async function main(hostRoot) {
    const endpointPath = path.join(hostRoot, 'src', 'endpoints', 'backends', 'chat-completions.js');
    const converterPath = path.join(hostRoot, 'src', 'prompt-converters.js');
    const [endpointSource, converterSource] = await Promise.all([readFile(endpointPath, 'utf8'), readFile(converterPath, 'utf8')]);
    const convertSource = extractFunction(converterSource, 'convertGooglePrompt');
    const handlerSource = extractFunction(endpointSource, 'sendMakerSuiteRequest');
    const harness = loadHostFunctions(convertSource, handlerSource);
    const failures = [];
    let assertions = 0;

    const check = (label, fn) => {
        try {
            fn();
            assertions += 1;
        } catch (error) {
            failures.push(`${label}: ${error.message}`);
        }
    };

    const imageModels = [
        'gemini-3.1-flash-image-preview',
        'gemini-3-pro-image-preview',
        'gemini-3.1-flash-image',
        'gemini-3-pro-image',
    ];
    const avatarOne = 'QVZBVEFSX09ORV9FWFBBQ1RfQllURVM=';
    const avatarTwo = 'QVZBVEFSX1RXT19FWFBBQ1RfQllURVM=';

    for (const model of imageModels) {
        for (const aspectRatio of ['16:9', '9:16', '1:1']) {
            const request = buildGeminiProxyRequest({
                model,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: 'Render the scene.' },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${avatarOne}` } },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${avatarTwo}` } },
                ] }],
                apiKey: 'offline-key',
                baseUrl: 'https://offline.invalid/gemini',
                aspectRatio,
                imageSize: '1K',
            });
            const captured = await harness.send(request);
            const body = captured.payload;
            check(`${model} ${aspectRatio} preserves exact model URL`, () => assert.equal(captured.url, `https://offline.invalid/gemini/v1beta/models/${model}:generateContent?key=offline-key`));
            check(`${model} ${aspectRatio} enables image output`, () => assert.deepEqual(body.generationConfig.responseModalities, ['text', 'image']));
            check(`${model} ${aspectRatio} forwards image settings`, () => assert.deepEqual(body.generationConfig.imageConfig, { imageSize: '1K', aspectRatio }));
            check(`${model} ${aspectRatio} preserves both avatar byte strings`, () => assert.deepEqual(
                body.contents[0].parts.filter(part => part.inlineData).map(part => part.inlineData),
                [{ mimeType: 'image/png', data: avatarOne }, { mimeType: 'image/jpeg', data: avatarTwo }],
            ));
        }
    }

    const disabledImageRequest = buildGeminiProxyRequest({
        model: 'gemini-3.1-flash-image', messages: [{ role: 'user', content: 'Do not render.' }], apiKey: 'offline-key', baseUrl: 'https://offline.invalid/gemini',
    });
    disabledImageRequest.request_images = false;
    const disabledImageCapture = await harness.send(disabledImageRequest);
    check('known image model with request_images false has no image modality', () => assert.equal('responseModalities' in disabledImageCapture.payload.generationConfig, false));
    check('known image model with request_images false has no image config', () => assert.equal('imageConfig' in disabledImageCapture.payload.generationConfig, false));

    const unknownImageRequest = buildGeminiProxyRequest({
        model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'Text only.' }], apiKey: 'offline-key', baseUrl: 'https://offline.invalid/gemini',
    });
    const unknownImageCapture = await harness.send(unknownImageRequest);
    check('unknown text model with request_images true has no image modality', () => assert.equal('responseModalities' in unknownImageCapture.payload.generationConfig, false));
    check('unknown text model with request_images true has no image config', () => assert.equal('imageConfig' in unknownImageCapture.payload.generationConfig, false));

    const missingSettings = buildGeminiProxyRequest({
        model: 'gemini-3.1-flash-image', messages: [{ role: 'user', content: 'Default image.' }], apiKey: 'offline-key', baseUrl: 'https://offline.invalid/gemini',
    });
    // Exercise the host's optional-field boundary after the extension has built
    // the normal proxy request.  An omitted control must remain omitted.
    delete missingSettings.request_image_aspect_ratio;
    delete missingSettings.request_image_resolution;
    const missingCapture = await harness.send(missingSettings);
    check('missing image size is not serialized as literal undefined', () => assert.notEqual(missingCapture.payload.generationConfig.imageConfig?.imageSize, 'undefined'));
    check('missing image ratio is not serialized as literal undefined', () => assert.notEqual(missingCapture.payload.generationConfig.imageConfig?.aspectRatio, 'undefined'));
    check('missing image settings do not create an empty image config', () => assert.equal('imageConfig' in missingCapture.payload.generationConfig, false));

    const receipt = `host=${hostRoot} cases=${imageModels.length * 3} assertions=${assertions} failures=${failures.length} transport=stubbed`;
    if (failures.length) {
        console.error(`FAIL ${receipt}`);
        for (const failure of failures) console.error(`- ${failure}`);
        process.exitCode = 1;
    } else {
        console.log(`PASS ${receipt}`);
    }
}

function loadHostFunctions(convertSource, handlerSource) {
    let captured;
    const context = vm.createContext({
        URL,
        AbortController,
        console: { debug() {}, info() {}, warn() {}, error() {} },
        getConfigValue: (_key, fallback) => fallback,
        tryParse: value => { try { return JSON.parse(value); } catch { return undefined; } },
        GEMINI_MEDIA_RESOLUTION: { low: 'media_resolution_low', high: 'media_resolution_high' },
        enableThoughtSignatures: true,
        CHAT_COMPLETION_SOURCES: { VERTEXAI: 'vertexai' },
        API_VERTEX_AI: 'https://vertex.invalid',
        API_MAKERSUITE: 'https://makersuite.invalid',
        GEMINI_SAFETY: [],
        VERTEX_SAFETY: [],
        calculateGoogleBudgetTokens: () => undefined,
        getPromptNames: request => ({
            charName: String(request.body.char_name || ''), userName: String(request.body.user_name || ''), groupNames: [], startsWithGroupName: () => false,
        }),
        fetch: async (url, init) => {
            captured = { url: String(url), payload: JSON.parse(init.body), init };
            return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'tiny' } }] } }] }) };
        },
    });
    vm.runInContext(`${convertSource}\nglobalThis.__convertGooglePrompt = convertGooglePrompt;\n${handlerSource}\nglobalThis.__sendMakerSuiteRequest = sendMakerSuiteRequest;`, context, { filename: 'installed-sillytavern-gemini.vm.js' });
    return {
        async send(body) {
            captured = undefined;
            let sent;
            const response = {
                headersSent: false,
                status() { return this; },
                send(value) { sent = value; this.headersSent = true; return value; },
            };
            const request = { body: structuredClone(body), socket: { removeAllListeners() {}, on() {} }, user: { directories: {} } };
            await context.__sendMakerSuiteRequest(request, response);
            assert.ok(captured, `installed host did not invoke the stubbed fetch (response: ${JSON.stringify(sent)})`);
            return captured;
        },
    };
}

function extractFunction(source, name) {
    const start = source.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`));
    if (start < 0) throw new Error(`Installed host source does not contain function ${name}`);
    const open = source.indexOf('{', start);
    if (open < 0) throw new Error(`Installed host function ${name} has no body`);
    let depth = 0;
    let quote = null;
    let lineComment = false;
    let blockComment = false;
    for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];
        if (lineComment) { if (char === '\n') lineComment = false; continue; }
        if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index += 1; } continue; }
        if (quote) {
            if (char === '\\') { index += 1; continue; }
            if (char === quote) quote = null;
            continue;
        }
        if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
        if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
        if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1).replace(/^export\s+/u, '');
        }
    }
    throw new Error(`Installed host function ${name} has an unterminated body`);
}

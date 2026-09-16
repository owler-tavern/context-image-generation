import test from 'node:test';
import assert from 'node:assert/strict';
import { patchSillyTavernGeminiSource } from '../scripts/patch-sillytavern-gemini.mjs';

const fixture = `// unrelated prefix
async function sendMakerSuiteRequest(request, response) {
    const model = String(request.body.model);
    const aspectRatio = String(request.body.request_image_aspect_ratio);
    const imageSize = String(request.body.request_image_resolution);
    function getGeminiBody() {
        const imageGenerationModels = [
            'gemini-3-pro-image',
            'gemini-3.1-flash-image',
        ];
        const enableImageModality = requestImages && imageGenerationModels.includes(model);
    }
}
async function otherHandler() { return 'untouched'; }
`;

test('host patch adds exact preview IDs, preserves model selection, and is idempotent', () => {
    const patched = patchSillyTavernGeminiSource(fixture);
    assert.match(patched, /'gemini-3-pro-image-preview'/u);
    assert.match(patched, /'gemini-3\.1-flash-image-preview'/u);
    assert.match(patched, /const model = String\(request.body.model\);/u);
    assert.match(patched, /String\(request.body.request_image_resolution \?\? ''\)/u);
    assert.match(patched, /String\(request.body.request_image_aspect_ratio \?\? ''\)/u);
    assert.equal(patchSillyTavernGeminiSource(patched), patched);
    assert.ok(patched.startsWith('// unrelated prefix\n'));
    assert.ok(patched.endsWith("async function otherHandler() { return 'untouched'; }\n"));
});

test('host patch preserves Windows line endings', () => {
    const patched = patchSillyTavernGeminiSource(fixture.replaceAll('\n', '\r\n'));
    assert.equal(patched.replaceAll('\r\n', '').includes('\n'), false);
});

test('host patch refuses unfamiliar handlers and partially changed field mappings', () => {
    assert.throws(() => patchSillyTavernGeminiSource('unfamiliar host'), /no changes made/u);
    assert.throws(() => patchSillyTavernGeminiSource(fixture.replace('imageGenerationModels.includes(model)', 'otherGate(model)')), /no changes made/u);
    assert.throws(() => patchSillyTavernGeminiSource(fixture.replace('String(request.body.request_image_resolution)', 'readSize(request)')), /no changes made/u);
});

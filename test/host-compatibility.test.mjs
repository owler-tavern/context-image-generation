import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHostImageModelCompatibility, readHostImageModelCompatibility } from '../lib/providers/host-compatibility.js';

test('reports an exact host migration without silently aliasing the selected provider model', () => {
    const result = inspectHostImageModelCompatibility({
        modelId: 'gemini-3.1-flash-image-preview',
        transportId: 'sillytavern-gemini-proxy',
        hostScriptText: `{ oldKey: 'google_model', oldValue: 'gemini-3.1-flash-image-preview', newKey: 'google_model', newValue: 'gemini-3.1-flash-image' }`,
    });
    assert.equal(result.state, 'advisory');
    assert.equal(result.selectedModelId, 'gemini-3.1-flash-image-preview');
    assert.equal(result.alternativeModelId, 'gemini-3.1-flash-image');
    assert.match(result.userMessage, /will not silently change/i);
});

test('does not infer incompatibility for a host that does not advertise an exact migration', () => {
    assert.deepEqual(inspectHostImageModelCompatibility({
        modelId: 'vendor/image-model', transportId: 'host-chat-image', hostScriptText: 'const unrelated = true;',
    }), { state: 'unknown', reason: 'The host does not advertise an exact compatibility decision for this model.' });
});

test('does not apply SillyTavern frontend inspection to browser-native transports', async () => {
    let calls = 0;
    const result = await readHostImageModelCompatibility({
        modelId: 'gpt-image-2', transportId: 'openai-images', fetchImpl: async () => { calls += 1; },
    });
    assert.equal(result.state, 'not-applicable');
    assert.equal(calls, 0);
});

test('keeps a host with no public SillyTavern asset at unknown compatibility', async () => {
    const result = await readHostImageModelCompatibility({
        modelId: 'gemini-3.1-flash-image-preview',
        transportId: 'host-chat-image',
        fetchImpl: async () => ({ ok: false }),
    });
    assert.equal(result.state, 'unknown');
});

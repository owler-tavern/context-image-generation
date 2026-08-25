import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { inspectGenerationPlan } from '../lib/providers/preflight.js';
import { createDiagnosticsExport, serializeDiagnosticsExport } from '../lib/providers/diagnostics.js';

test('preflight inspector exposes safe plan metadata without prompt, context, secrets, or assets', () => {
    const plan = createGenerationPlan({
        id: 'generation:private-target',
        invocation: 'wand',
        target: { chatId: 'private-chat', messageId: 4 },
        resolved: {
            connectionId: 'openai:default', providerId: 'openai', modelId: 'gpt-image-1', transportId: 'openai-images',
            endpoint: 'https://api.openai.com/v1',
            capabilities: { referenceImages: { state: 'supported', source: 'official-docs', confidence: 'high' }, maxReferenceImages: 1 },
        },
        prompt: {
            sourceMessage: 'PRIVATE PROMPT secret-token-123',
            focusText: 'PRIVATE FOCUS',
            nearbyMessages: [{ text: 'PRIVATE CONTEXT' }],
            intent: 'portrait',
        },
        references: [{ id: 'asset:private', role: 'character', url: 'data:image/png;base64,AAAA' }],
        identities: [{ id: 'private-identity' }],
        options: { aspectRatio: '3:4', imageSize: '2K', systemInstruction: 'PRIVATE SYSTEM INSTRUCTION' },
        policy: { source: 'manual', preflightAccepted: true },
    });
    const inspected = inspectGenerationPlan(plan);
    assert.equal(Object.isFrozen(inspected), true);
    assert.deepEqual(inspected.route, {
        providerId: 'openai', modelId: 'gpt-image-1', transportId: 'openai-images', connectionId: 'openai:default',
    });
    assert.deepEqual(inspected.prompt, { hasSourceMessage: true, hasFocusText: true, nearbyMessageCount: 1, intent: 'portrait' });
    assert.deepEqual(inspected.references, { count: 1, roles: ['character'] });
    assert.equal(inspected.options.systemInstruction, undefined);
    assert.doesNotMatch(JSON.stringify(inspected), /PRIVATE|secret-token|base64|chatId|messageId/i);
});

test('diagnostics export keeps normalized run/discovery metadata and strips private fields', () => {
    const diagnostics = createDiagnosticsExport({
        generatedAt: '2026-08-25T12:00:00.000Z',
        runs: [{
            runId: 'run:1', state: 'failed', createdAt: '2026-08-25T11:59:00.000Z', completedAt: '2026-08-25T12:00:00.000Z',
            plan: {
                schema: 2, id: 'private-generation', idempotencyKey: 'private-idempotency', invocation: 'wand',
                target: { chatId: 'private-chat', messageId: 4 },
                resolved: { providerId: 'zai', modelId: 'glm-image', transportId: 'zai-native', endpoint: 'https://private.example' },
                prompt: { sourceMessage: 'PRIVATE CONTEXT' },
            },
            terminal: { error: { category: 'authentication', providerId: 'zai', modelId: 'glm-image', requestId: 'req-1' } },
        }],
        discovery: {
            zai: { evidence: { kind: 'native', source: 'provider /models endpoint', observedAt: '2026-08-25T11:00:00.000Z', retryCount: 1 }, warning: { code: 'DISCOVERY_AUTH_FAILED', userMessage: 'PRIVATE API KEY ERROR' } },
        },
    });
    const text = serializeDiagnosticsExport(diagnostics);
    assert.equal(diagnostics.schema, 1);
    assert.equal(diagnostics.runs[0].providerId, 'zai');
    assert.equal(diagnostics.runs[0].modelId, 'glm-image');
    assert.equal(diagnostics.discovery.zai.warning.code, 'DISCOVERY_AUTH_FAILED');
    assert.doesNotMatch(text, /PRIVATE|private-chat|private-idempotency|https?:|"sourceMessage"|"messageId"|api.?key/i);
    assert.doesNotMatch(text, /headers|authorization|base64/i);
});

test('diagnostics export is bounded and deterministic for malformed input', () => {
    const diagnostics = createDiagnosticsExport({ runs: Array.from({ length: 100 }, (_, index) => ({ runId: `run:${index}`, state: 'queued' })) });
    assert.equal(diagnostics.runs.length, 32);
    assert.equal(typeof serializeDiagnosticsExport(diagnostics), 'string');
});

test('diagnostics serializer re-sanitizes schema-looking caller input', () => {
    const text = serializeDiagnosticsExport({
        schema: 1,
        runs: [{
            runId: 'run:unsafe', state: 'failed',
            plan: {
                target: { chatId: 'DO-NOT-EXPORT' },
                resolved: { providerId: 'zai', modelId: 'glm-image', endpoint: 'https://private.example' },
                prompt: { sourceMessage: 'PRIVATE PROMPT' },
            },
            terminal: { error: { message: 'PRIVATE RAW ERROR api_key=secret-value' } },
        }],
        discovery: { zai: { warning: { code: 'DISCOVERY_FAILED', userMessage: 'PRIVATE API KEY' } } },
    });
    assert.doesNotMatch(text, /DO-NOT-EXPORT|PRIVATE|private\.example|secret-value|"sourceMessage"|"messageId"|api.?key/i);
});

test('runtime retains only the redacted plan inspection', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /lastGenerationPlanInspection\s*=\s*inspectGenerationPlan\(dispatchedPlan\)/);
    assert.doesNotMatch(source, /lastGenerationPlan\s*=\s*dispatchedPlan/);
});

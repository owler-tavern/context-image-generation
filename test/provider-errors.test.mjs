import test from 'node:test';
import assert from 'node:assert/strict';
import { attachNormalizedProviderError, getSafeProviderErrorLogFields, normalizeProviderError } from '../lib/providers/errors.js';

const context = { providerId: 'linkapi', providerLabel: 'LinkAPI', modelId: 'gemini-image', requestId: 'req-42' };

test('classifies authentication, rate limit, model, capability, and policy failures', () => {
    assert.equal(normalizeProviderError(new Error('invalid API key'), { ...context, status: 401 }).category, 'authentication');
    assert.equal(normalizeProviderError(new Error('too many requests'), { ...context, status: 429 }).category, 'rate_limit');
    assert.equal(normalizeProviderError(new Error('model not found'), { ...context, status: 404 }).category, 'model_unavailable');
    assert.equal(normalizeProviderError(new Error('reference images are not supported'), { ...context, status: 400 }).category, 'unsupported_capability');
    assert.equal(normalizeProviderError(new Error('blocked by content policy'), { ...context, status: 400 }).category, 'content_policy');
    assert.equal(normalizeProviderError(new Error('request blocked by content policy'), { ...context, status: 403 }).category, 'content_policy');
});

test('classifies network and empty-result failures without an HTTP status', () => {
    assert.equal(normalizeProviderError(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }), context).category, 'network');
    assert.equal(normalizeProviderError(new Error('No image was returned by the API'), context).category, 'empty_result');
});

test('projects required user copy and metadata while redacting sensitive diagnostics', () => {
    const normalized = normalizeProviderError(new Error('invalid API key Bearer secret-key'), {
        ...context,
        status: 401,
        responseText: JSON.stringify({ error: { message: 'invalid API key Bearer secret-key', request: 'private roleplay context' } }),
    });
    assert.deepEqual({
        category: normalized.category,
        userMessage: normalized.userMessage,
        status: normalized.status,
        providerId: normalized.providerId,
        requestId: normalized.requestId,
    }, {
        category: 'authentication',
        userMessage: 'LinkAPI rejected the API key. Check it in extension settings.',
        status: 401,
        providerId: 'linkapi',
        requestId: 'req-42',
    });
    assert.doesNotMatch(normalized.technicalMessage, /secret-key|private roleplay context|Bearer/i);
});

test('uses the generic provider message for unrecognized failures', () => {
    const normalized = normalizeProviderError(new Error('unexpected upstream response'), context);
    assert.equal(normalized.category, 'unknown');
    assert.equal(normalized.userMessage, 'Image generation failed. Try again or check provider settings.');
});

test('classifies an upstream server failure as a provider failure', () => {
    const normalized = normalizeProviderError(new Error('upstream unavailable'), { ...context, status: 503 });
    assert.equal(normalized.category, 'provider');
    assert.equal(normalized.userMessage, 'Image generation failed. Try again or check provider settings.');
});

test('attached provider errors expose only the redacted technical message', () => {
    const error = attachNormalizedProviderError(new Error('Bearer secret-key'), { ...context, status: 500 });
    assert.equal(error.name, 'ProviderError');
    assert.equal(error.message, '[redacted credential]');
});

test('redacts common bare provider key prefixes from diagnostics', () => {
    const normalized = normalizeProviderError(new Error('upstream returned sk-proj-abc123456789 and AIzaSyAbcdefghijklmnop and key-123456789abcdef'), context);
    assert.doesNotMatch(normalized.technicalMessage, /sk-proj|AIzaSy|abc123456789|Abcdefghijklmnop|key-123456789abcdef/i);
    assert.match(normalized.technicalMessage, /\[redacted credential\]/);
});

test('safe error log fields never include provider response text', () => {
    const normalized = normalizeProviderError(new Error('private roleplay and sk-proj-secret123456'), context);
    assert.deepEqual(getSafeProviderErrorLogFields(normalized), {
        category: 'unknown',
        status: undefined,
        providerId: 'linkapi',
        modelId: 'gemini-image',
        requestId: 'req-42',
    });
    assert.equal(Object.hasOwn(getSafeProviderErrorLogFields(normalized), 'technicalMessage'), false);
});

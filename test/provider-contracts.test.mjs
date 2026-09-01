import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelDefinition } from '../lib/providers/contracts.js';

const provider = {
    id: 'fixture',
    transportIds: ['openAiImages', 'sillyTavernGeminiProxy'],
};

test('fetched and manual models without a route remain unavailable', () => {
    for (const source of ['fetched', 'manual']) {
        const model = normalizeModelDefinition({ id: `${source}-model`, providerId: 'fixture', source }, provider);
        assert.equal(model.transportId, null);
        assert.deepEqual(model.routeEvidence, { state: 'unverified' });
    }
});

test('malformed, stale, and consent-only route evidence stays unverified', () => {
    const malformed = normalizeModelDefinition({
        id: 'malformed-route', providerId: 'fixture', source: 'manual', transportId: 'openAiImages',
        routeEvidence: { state: 'verified', source: 'official-docs', observedAt: 'not-a-date', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
    }, provider);
    const stale = normalizeModelDefinition({
        id: 'stale-route', providerId: 'fixture', source: 'manual', transportId: 'openAiImages',
        routeEvidence: { state: 'verified', source: 'official-docs', observedAt: '2020-01-01T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
    }, provider);
    const consentOnly = normalizeModelDefinition({
        id: 'consent-only-route', providerId: 'fixture', source: 'manual', transportId: 'openAiImages', preflightAccepted: true,
    }, provider);

    assert.deepEqual(malformed.routeEvidence, { state: 'unverified' });
    assert.deepEqual(stale.routeEvidence, { state: 'unverified' });
    assert.deepEqual(consentOnly.routeEvidence, { state: 'unverified' });
});

test('user-configured evidence cannot self-attest as verified', () => {
    const model = normalizeModelDefinition({
        id: 'configured-route', providerId: 'fixture', source: 'manual', transportId: 'openAiImages',
        routeEvidence: { state: 'verified', source: 'user-configured-protocol', observedAt: '2026-08-30T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
    }, provider);
    assert.equal(model.routeEvidence.state, 'configured');
    assert.equal(model.routeEvidence.source, 'user-configured-protocol');
});

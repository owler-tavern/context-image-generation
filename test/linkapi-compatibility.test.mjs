import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveTransport } from '../lib/providers/registry.js';
import { migrateProviderSettings } from '../lib/providers/settings-migration.js';

test('keeps LinkAPI on registry-declared Gemini and OpenAI image routes without a legacy recovery control', async () => {
    const [index, settings] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    ]);

    assert.equal(resolveTransport('linkapi', 'gemini-3.1-flash-image-preview'), 'sillyTavernGeminiProxy');
    assert.equal(resolveTransport('linkapi', 'gpt-image-2-c'), 'openAiImages');
    assert.doesNotMatch(index, /linkapi_use_legacy_routing|linkapi-legacy-recovery|generateLegacyLinkApiImage/);
    assert.doesNotMatch(settings, /legacy LinkAPI routing|cig_linkapi_use_legacy_routing/i);
});

test('removes the obsolete LinkAPI legacy flag during settings migration without changing the declared route', () => {
    const migrated = migrateProviderSettings({
        provider: 'linkapi',
        model: 'gpt-image-2-c',
        linkapi_use_legacy_routing: true,
    });

    assert.equal(Object.hasOwn(migrated, 'linkapi_use_legacy_routing'), false);
    assert.equal(resolveTransport(migrated.provider, migrated.model), 'openAiImages');
});

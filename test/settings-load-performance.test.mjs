import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('stable settings load does not delete and recreate retired director sessions', () => {
    const start = indexSource.indexOf('async function loadSettings()');
    const end = indexSource.indexOf('function toggleProviderSpecificSettings()', start);
    const loadSettings = start >= 0 && end > start ? indexSource.slice(start, end) : '';

    assert.ok(loadSettings, 'loadSettings source should be available');
    assert.doesNotMatch(
        loadSettings,
        /delete cigSettings\.director_sessions;[\s\S]*cigSettings\.director_sessions\s*=/u,
        'a stable load must not force a full SillyTavern settings save by recreating retired state',
    );
});

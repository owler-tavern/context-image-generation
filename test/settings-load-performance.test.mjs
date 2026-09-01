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

test('ordinary message rendering and chat startup do not schedule full image-navigation scans', () => {
    const renderedStart = indexSource.indexOf('function onCigMessageRendered(messageId)');
    const eventsEnd = indexSource.indexOf('SlashCommandParser.addCommandObject', renderedStart);
    const runtimeEvents = renderedStart >= 0 && eventsEnd > renderedStart
        ? indexSource.slice(renderedStart, eventsEnd)
        : '';

    assert.ok(runtimeEvents, 'message lifecycle source should be available');
    assert.doesNotMatch(
        runtimeEvents,
        /scheduleImageArrowConfiguration|configureAllCigImageArrows/u,
        'idle message and chat lifecycle must not add image-navigation timers or full DOM scans',
    );
});

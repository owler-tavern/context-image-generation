import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScenePrompt, extractSceneText } from '../lib/scene-prompt.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { buildGenerationMessages } from '../lib/rp/reference-message-parts.js';
import { buildGeminiProxyRequest } from '../lib/providers/gemini-proxy.js';
import { buildLinkApiNanoRequest } from '../lib/providers/linkapi-gemini-native.js';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { getModelDefinition } from '../lib/providers/registry.js';

// Same wrapper/nesting structure as the supplied scene, with neutral content.
const structuredMessage = `<scene_plan><summary>Scene Plan</summary><details>PLAN_ONLY: include an absent character.</details></scene_plan>
<tracker>TRACKER_ONLY: time and location</tracker>
<prose>
Mira entered the quiet office.

<span style="color:#8b7355">"Good afternoon &amp; welcome."</span>
<true_thoughts character="Mira">THOUGHT_ONLY: an internal monologue.</true_thoughts>

She set her bag beside the desk.
<visuals><div class="panel">VISUAL_ONLY: a dashboard <div>nested panel</div></div><style>.panel { color: red; }</style></visuals>

They looked out the window.
</prose>
<status><summary>STATUS_ONLY: Mira and an absent character</summary><details>Inventory</details></status>
<threads><summary>THREAD_ONLY</summary></threads>
<plotlines>PLOT_ONLY</plotlines><horae>HORAE_ONLY</horae><horaeevent>EVENT_ONLY</horaeevent>
<momentum>MOMENTUM_ONLY<momentum_route primary="A"></momentum_route></momentum>
[PARALLEL|Other location|Other characters]
PARALLEL_ONLY: an unrelated scene
[/PARALLEL]
<director_choices>CHOICE_ONLY</director_choices>`;
const expected = 'Mira entered the quiet office.\n\n"Good afternoon & welcome."\n\nShe set her bag beside the desk.\n\nThey looked out the window.';

test('extracts only prose and removes whole nested tracker/thought/visual blocks', () => {
    assert.equal(extractSceneText(structuredMessage), expected);
});

test('preserves plain narration, comparisons, dialogue and full source length', () => {
    const source = 'A value < 3 and 5 > 2.\n\n"Keep the dialogue."\n' + 'Long narrative. '.repeat(1200);
    assert.equal(extractSceneText(source), source.trim());
});

test('cleans unwrapped messages without keeping metadata, scripts, CSS or code', () => {
    const source = `<tracker>HIDDEN</tracker>Before.<br>After.
<script>RUN_CODE()</script><style>.x { color: red; }</style><!-- COMMENT -->
<status><status>Nested secret</status>Outer secret</status>
[PARALLEL|Elsewhere]Off-scene[/PARALLEL]
\`\`\`js
/tracker/gi
\`\`\`
Final.`;
    assert.equal(extractSceneText(source), 'Before.\nAfter.\n\nFinal.');
});

test('handles case, attributes containing angle brackets, multiple prose sections and entities', () => {
    assert.equal(extractSceneText('<PROSE id="a > b"><p>A &lt; B &#38; C &#x1f338;.</p><p>“Quoted.”</p></PROSE>Outside<prose>Next.</prose>'), 'A < B & C 🌸.\n\n“Quoted.”\n\nOutside\nNext.');
    assert.equal(extractSceneText('<prose>Literal &lt;status&gt;word&lt;/status&gt;.</prose>'), 'Literal <status>word</status>.');
});

test('keeps narration after longer closing code fences and excludes unclosed code', () => {
    for (const marker of ['`', '~']) {
        assert.equal(extractSceneText(`${marker.repeat(3)}js\nTRACKER_CODE\n${marker.repeat(4)}\nMira entered the office.`), 'Mira entered the office.');
        assert.equal(extractSceneText(`Before.\n${marker.repeat(3)}js\nTRACKER_CODE`), 'Before.');
        assert.equal(extractSceneText(`${marker.repeat(4)}js\n${marker.repeat(3)}\nTRACKER_CODE\n${marker.repeat(4)}\nAfter.`), 'After.');
    }
});

test('excludes hidden content and tolerates incomplete prose or metadata without raw fallback', () => {
    assert.equal(extractSceneText('<prose>A<span hidden>Secret</span>B<div aria-hidden="true">Secret</div>C</prose>'), 'A\n\nB\n\nC');
    assert.equal(extractSceneText('<prose>A<div hidden><div>Nested secret</div>Still secret</div>B</prose>'), 'A\n\nB');
    assert.equal(extractSceneText('<prose>Kept.<visuals>Unclosed panel'), 'Kept.');
    assert.equal(extractSceneText('Kept.<tracker>Unclosed tracker'), 'Kept.');
    assert.equal(extractSceneText('<scene_plan>Fake <prose>Not a scene</prose></scene_plan>Real.'), 'Real.');
    assert.equal(extractSceneText('<prose/>Ordinary unwrapped narration'), 'Ordinary unwrapped narration');
    assert.equal(extractSceneText('Kept.<!-- Unclosed comment with secret'), 'Kept.');
});

test('preserves narration before/after prose and alternative narrative wrappers', () => {
    assert.equal(extractSceneText('Before.\n<prose>Inside.</prose>\nAfter.'), 'Before.\n\nInside.\n\nAfter.');
    for (const wrapper of ['narration', 'story', 'scene', 'chapter', 'unknown-narrative']) {
        const result = extractSceneText(`<${wrapper}><p>Mira walked into the office.</p><tracker>SECRET</tracker><p>"Hello."</p></${wrapper}>`);
        assert.equal(result, 'Mira walked into the office.\n\n"Hello."');
    }
});

test('recognizes metadata tag spelling variants without requiring a prose wrapper', () => {
    for (const wrapper of ['scene-plan', 'scenePlan', 'scene_plan', 'character-status', 'characterStatus', 'tracker-panel', 'trueThoughts']) {
        assert.equal(extractSceneText(`Before.<${wrapper}><div>SECRET</div></${wrapper}>After.`), 'Before.\n\nAfter.');
    }
});

test('excludes metadata HTML containers identified by actual attributes or summary labels', () => {
    for (const attribute of ['class="panel tracker"', 'id="status-panel"', 'data-type="scene_plan"', 'data-role="character-status"']) {
        assert.equal(extractSceneText(`Before.<div ${attribute}><div>SECRET</div>MORE_SECRET</div>After.`), 'Before.\n\nAfter.');
    }
    assert.equal(extractSceneText('Before.<details><summary><b>Character Status</b></summary><div>SECRET</div></details>After.'), 'Before.\n\nAfter.');
    assert.equal(extractSceneText('Before.<details><summary title="a > b">Status</summary>SECRET</details>After.'), 'Before.\n\nAfter.');
    assert.equal(extractSceneText('<details><summary><span title="a > b">Status</span></summary>SECRET</details>After.'), 'After.');
    assert.equal(extractSceneText('<p class="style" title="status tracker">Narrative.</p><details><summary>The old house</summary>Scene text.</details>'), 'Narrative.\n\nThe old house\nScene text.');
});

test('removes paired bracket metadata while preserving ordinary brackets and narrative blocks', () => {
    assert.equal(extractSceneText('[scene]Mira entered.[/scene]\n[tracker]SECRET [stats]NESTED[/stats][/tracker]\n"Welcome."'), 'Mira entered.\n\n"Welcome."');
    assert.equal(extractSceneText('[STATUS]SECRET[/STATUS]Narration.[ooc]Instructions[/ooc]After.'), 'Narration.\n\nAfter.');
    assert.equal(extractSceneText('She read [status] on the screen and [an ordinary aside].'), 'She read [status] on the screen and [an ordinary aside].');
    assert.equal(extractSceneText('She read [letter]Stay safe[/letter].'), 'She read [letter]Stay safe[/letter].');
    assert.equal(extractSceneText('She read [status] on the screen.\n[status]SECRET[/status]\nShe left.'), 'She read [status] on the screen.\n\nShe left.');
    assert.equal(extractSceneText('[tracker]OUTER[tracker]INNER[/tracker]SECRET[/tracker]After.'), 'After.');
    assert.equal(extractSceneText('[status]SECRET<!-- [/status] -->MORE_SECRET[/status]After.'), 'After.');
    assert.equal(extractSceneText('[status]SECRET<span title="[/status]">MORE_SECRET</span>[/status]After.'), 'After.');
});

test('treats actual hidden attributes separately from words inside quoted attribute values', () => {
    assert.equal(extractSceneText('<prose>She said <span title="a hidden garden">hello</span>.</prose>'), 'She said hello.');
    assert.equal(extractSceneText("<prose><span title='aria-hidden=true hidden' aria-hidden='false'>Visible</span></prose>"), 'Visible');
    assert.equal(extractSceneText('<prose>Before.<span title="a hidden garden" HIDDEN="false">Secret</span>After.</prose>'), 'Before.\n\nAfter.');
    assert.equal(extractSceneText('<prose>Before.<span ARIA-HIDDEN=true>Secret</span>After.</prose>'), 'Before.\n\nAfter.');
});

test('rejects metadata-only inputs before provider dispatch', () => {
    assert.throws(() => buildScenePrompt({ sourceMessage: '<tracker>Only tracker data</tracker>' }), /No scene text remains/);
    assert.throws(() => buildScenePrompt({ sourceMessage: '<prose><visuals>Only a panel</visuals></prose>' }), /No scene text remains/);
});

test('cleans supporting context and accepts only focus present in surviving prose', () => {
    const input = { sourceMessage: structuredMessage, nearbyMessages: [{ text: structuredMessage, name: 'Mira', isUser: false }], sender: '{{char}} (Mira)', useStoryContext: true };
    const selected = buildScenePrompt({ ...input, focusText: 'She set her bag beside the desk.' });
    assert.equal(selected.sourceMessage, expected);
    assert.equal(selected.nearbyMessages[0].text, expected);
    assert.match(selected.messageContent, /^\[Primary visual moment/);
    assert.doesNotMatch(JSON.stringify(selected), /_ONLY|<span|<prose|color:/);
    const trackerSelection = buildScenePrompt({ ...input, focusText: 'TRACKER_ONLY: time and location' });
    assert.equal(trackerSelection.focusText, null);
    assert.doesNotMatch(trackerSelection.messageContent, /Primary visual moment|TRACKER_ONLY/);
    assert.deepEqual(buildScenePrompt({ ...input, nearbyMessages: [{ text: '<status>Metadata only</status>' }] }).nearbyMessages, []);
    assert.equal(buildScenePrompt({ sourceMessage: '<prose>Mira wore **red** silk.</prose>', focusText: 'Mira wore red silk.' }).focusText, 'Mira wore red silk.');
});

test('provider messages and both Gemini request shapes retain cleaned scene and existing controls', () => {
    const prompt = buildScenePrompt({ sourceMessage: structuredMessage, focusText: 'They looked out the window.', nearbyMessages: [{ text: structuredMessage, name: 'Mira' }], useStoryContext: true });
    const plan = createGenerationPlan({ id: 'clean-scene', invocation: 'wand', prompt, options: { systemInstruction: 'Watercolor style.', aspectRatio: '16:9' } });
    const messages = buildGenerationMessages(plan);
    const proxy = buildGeminiProxyRequest({ model: 'gemini-3.1-flash-image-preview', messages, aspectRatio: '16:9' });
    const native = buildLinkApiNanoRequest({ ...plan, messages });
    for (const body of [messages, proxy, native]) {
        const serialized = JSON.stringify(body);
        assert.match(serialized, /Mira entered the quiet office/);
        assert.match(serialized, /Watercolor style/);
        assert.match(serialized, /16:9/);
        assert.doesNotMatch(serialized, /_ONLY|<span|<prose|color:/);
    }
});

test('OpenAI Images dispatch sends cleaned scene without raw metadata or supporting-context leakage', async () => {
    const prompt = buildScenePrompt({ sourceMessage: structuredMessage, nearbyMessages: [{ text: structuredMessage, name: 'Mira' }], useStoryContext: true });
    const model = getModelDefinition('openai', 'gpt-image-1');
    const base = { id: 'clean-images', invocation: 'slash', prompt, provider: { providerId: 'openai', modelId: model.id }, resolved: { providerId: 'openai', modelId: model.id, transportId: 'openai-images', endpoint: 'https://api.openai.com/v1', modelDefinition: model }, options: { systemInstruction: 'Watercolor style.' } };
    const preliminary = createGenerationPlan(base);
    const plan = createGenerationPlan({ ...base, messages: buildGenerationMessages(preliminary) });
    let sent;
    await assert.rejects(dispatchProviderRoute({
        plan, connection: { id: 'openai:default', enabled: true, providerId: 'openai' }, signal: new AbortController().signal,
        transportContext: { apiKey: 'mock-key', fetchImpl: async (url, options) => {
            sent = JSON.parse(options.body);
            return new Response(JSON.stringify({ error: { message: 'Intentional mock stop after payload capture' } }), { status: 400 });
        } },
    }), /400|Intentional mock stop/);
    assert.ok(sent);
    assert.match(sent.prompt, /Mira entered the quiet office/);
    assert.match(sent.prompt, /Watercolor style/);
    assert.doesNotMatch(sent.prompt, /_ONLY|<span|<prose|color:/);
});

test('production snapshot uses cleaned sources for interpretation and outgoing prompts', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const capture = source.slice(source.indexOf('function captureGenerationSnapshot'), source.indexOf('async function buildMessages'));
    assert.match(capture, /const scenePrompt = buildScenePrompt\(/);
    assert.match(capture, /mes: scenePrompt\.sourceMessage/);
    assert.match(capture, /selectedPassage: scenePrompt\.focusText/);
    assert.match(capture, /prompt: \{ \.\.\.scenePrompt/);
    assert.doesNotMatch(capture, /sourceMessage: prompt, focusText, nearbyMessages: recentMessages/);
});

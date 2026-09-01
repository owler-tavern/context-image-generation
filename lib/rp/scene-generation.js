import { interpretScene } from './scene-interpretation.js';

export const SCENE_STATE_SCHEMA = 1;
export const SCENE_STATE_METADATA_KEY = 'contextImageGenerationStoryState';

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function boundedText(value, max = 12000) {
    const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
    return text.length <= max ? text : text.slice(0, max);
}

function boundedPrompt(value, max = 16000) {
    const text = String(value ?? '').trim();
    return text.length <= max ? text : text.slice(0, max);
}

function normalizedSettings(settings = {}) {
    return {
        framing: boundedText(settings.framing_preference || settings.framing || 'auto', 40) || 'auto',
        continuity: boundedText(settings.continuity_strength || settings.continuity || 'balanced', 40) || 'balanced',
        custom: boundedText(settings.custom_visual_instruction || '', 4000),
    };
}

function knownSceneLines(state) {
    const scene = isRecord(state?.sceneFacts) ? state.sceneFacts : {};
    const lines = [];
    const cast = Array.isArray(scene.cast) ? scene.cast.map((entry) => boundedText(entry?.label || entry?.identityId, 120)).filter(Boolean) : [];
    if (cast.length) lines.push(`Present cast: ${cast.join(', ')}.`);
    if (typeof scene.location === 'string' && scene.location.trim()) lines.push(`Location: ${boundedText(scene.location, 200)}.`);
    for (const [key, label] of [['outfits', 'Outfits'], ['objects', 'Objects'], ['injuries', 'Injuries']]) {
        const entries = Array.isArray(scene[key]) ? scene[key] : [];
        const values = entries.map((entry) => {
            const value = boundedText(entry?.value, 200);
            if (!value) return '';
            const owner = boundedText(entry?.identityId || entry?.holderIdentityId, 120);
            return owner ? `${value} (${owner})` : value;
        }).filter(Boolean);
        if (values.length) lines.push(`${label}: ${values.join('; ')}.`);
    }
    return lines;
}

/** Builds the provider-facing scene text from an already reconciled state. */
export function buildScenePrompt({ sourcePassage = '', state = {}, settings = {} } = {}) {
    const visual = normalizedSettings(settings);
    const lines = [boundedText(sourcePassage) || 'Scene moment unavailable.'];
    lines.push(...knownSceneLines(state));
    lines.push(`Framing: ${visual.framing}.`);
    lines.push(`Continuity strength: ${visual.continuity}.`);
    if (visual.custom) lines.push(`Additional visual instruction: ${visual.custom}`);
    return lines.join('\n');
}

/** Captures the interpretation and effective prompt synchronously; no network work occurs. */
export function buildSceneGenerationSnapshot({ selectedPassage, focusText, clickedMessage, sourceMessage, recentContext, identities = [], priorStoryState, settings = {} } = {}) {
    const interpretation = interpretScene({
        selectedPassage: selectedPassage ?? focusText,
        clickedMessage: clickedMessage ?? sourceMessage,
        recentContext,
        identities,
        priorStoryState,
    });
    const state = clone(interpretation.storyStateDelta?.nextState || { schema: SCENE_STATE_SCHEMA, durableIdentityFacts: {}, sceneFacts: {} });
    const sourcePassage = boundedText(interpretation.focusPassage?.text || '');
    return Object.freeze({
        interpretation: clone(interpretation),
        state,
        sourcePassage,
        inspection: clone(interpretation.inspection),
        prompt: buildScenePrompt({ sourcePassage, state, settings }),
    });
}

/**
 * Returns the bounded metadata that is safe to attach to an inline artifact.
 * Raw evidence and identity descriptions stay in the transient generation plan.
 */
export function createSceneArtifactMetadata(snapshot = {}) {
    return {
        schema: SCENE_STATE_SCHEMA,
        sourcePassage: boundedText(snapshot.sourcePassage || ''),
        prompt: boundedPrompt(snapshot.prompt || ''),
        state: clone(snapshot.state || { schema: SCENE_STATE_SCHEMA, durableIdentityFacts: {}, sceneFacts: {} }),
        inspection: clone(snapshot.inspection || {
            title: 'Scene interpretation',
            confidence: 'low',
            lines: ['Scene interpretation unavailable.'],
            statuses: {},
            warnings: ['Scene interpretation was unavailable when this image was generated.'],
        }),
    };
}

export function sceneStatePendingKey(entry) {
    return String(entry?.chatId ?? '').trim();
}

export function createSceneStatePending({ chatId, epoch = 0, state, target } = {}) {
    const id = sceneStatePendingKey({ chatId });
    if (!id) throw new TypeError('A chat ID is required for pending scene state.');
    return {
        schema: SCENE_STATE_SCHEMA,
        chatId: id,
        epoch: Number.isInteger(epoch) ? epoch : 0,
        state: clone(state || { schema: SCENE_STATE_SCHEMA, durableIdentityFacts: {}, sceneFacts: {} }),
        target: clone(target || null),
    };
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
}

/**
 * Persists accepted state only for the captured chat/message. Pending state is
 * retained on uncertain reads so a reload can retry without leaking into a
 * different chat.
 */
export async function persistAcceptedSceneState({ pending, isCurrent, getState, setState, savePending, readPending, saveChat, readback, removePending, scheduleRetry } = {}) {
    if (!pending || typeof isCurrent !== 'function' || typeof getState !== 'function' || typeof setState !== 'function') return { status: 'indeterminate', reason: 'invalid-input' };
    if (!isCurrent(pending)) return { status: 'stale', reason: 'chat-changed' };
    try {
        await savePending?.(clone(pending));
        if (readPending) {
            const pendingRead = await readPending(clone(pending));
            if (pendingRead?.status === 'indeterminate') {
                scheduleRetry?.();
                return { status: 'indeterminate', verification: pendingRead };
            }
            if (pendingRead?.status === 'confirmed-absent') {
                scheduleRetry?.();
                return { status: 'confirmed-absent', verification: pendingRead };
            }
        }
        const previous = clone(getState());
        setState(clone(pending.state));
        const saved = await saveChat?.(clone(pending.target), clone(pending));
        if (saved?.saved === false || !isCurrent(pending)) return { status: 'stale', reason: 'chat-changed' };
        const verification = await readback?.(clone(pending));
        if (verification?.status === 'confirmed') {
            await removePending?.(clone(pending));
            return { status: 'confirmed', verification };
        }
        if (verification?.status === 'indeterminate') {
            scheduleRetry?.();
            return { status: 'indeterminate', verification };
        }
        if (isCurrent(pending) && stable(getState()) === stable(pending.state)) setState(previous);
        scheduleRetry?.();
        return { status: 'confirmed-absent', verification };
    } catch (error) {
        scheduleRetry?.();
        return { status: 'indeterminate', error };
    }
}

import { interpretScene } from './scene-interpretation.js';
import { applyDirectorCastOverrides, validateDirectorCastOverrides } from './cast-policy.js';

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

function sourceText(value) {
    if (typeof value === 'string') return value;
    if (!isRecord(value)) return '';
    return value.mes ?? value.text ?? value.content ?? '';
}

function boundedSourceText(value, max = 12000) {
    const text = String(value ?? '').trim();
    return text ? text.slice(0, max) : '';
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

function avatarSceneCast(state, interpretation) {
    const persistedCast = Array.isArray(state?.sceneFacts?.cast) ? state.sceneFacts.cast : [];
    const confidenceByIdentity = new Map((Array.isArray(interpretation?.cast) ? interpretation.cast : [])
        .filter((entry) => entry?.identityId && ['high', 'medium'].includes(entry.confidence))
        .map((entry) => [entry.identityId, entry.confidence]));
    return persistedCast.map((entry) => ({
        ...clone(entry),
        ...(confidenceByIdentity.has(entry?.identityId) ? { confidence: confidenceByIdentity.get(entry.identityId) } : {}),
    }));
}

function knownSceneLines(state) {
    const scene = isRecord(state?.sceneFacts) ? state.sceneFacts : {};
    const lines = [];
    const cast = Array.isArray(scene.cast) ? scene.cast.map((entry) => boundedText(entry?.label || entry?.identityId, 120)).filter(Boolean) : [];
    if (cast.length) lines.push(`Present cast: ${cast.join(', ')}.`);
    if (typeof scene.location === 'string' && scene.location.trim()) lines.push(`Location: ${boundedText(scene.location, 200)}.`);
    for (const [key, label] of [['objects', 'Objects'], ['injuries', 'Injuries']]) {
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
export function buildScenePrompt({ sourcePassage = '', state = {}, settings = {}, castCorrection = null } = {}) {
    const visual = normalizedSettings(settings);
    const lines = [boundedSourceText(sourcePassage) || 'Scene moment unavailable.'];
    lines.push(...knownSceneLines(state));
    lines.push(`Framing: ${visual.framing}.`);
    lines.push(`Continuity strength: ${visual.continuity}.`);
    if (visual.custom) lines.push(`Additional visual instruction: ${visual.custom}`);
    if (castCorrection?.promptLine) lines.push(castCorrection.promptLine);
    return lines.join('\n');
}

/** Captures the interpretation and effective prompt synchronously; no network work occurs. */
export function buildSceneGenerationSnapshot({ selectedPassage, focusText, clickedMessage, sourceMessage, recentContext, identities = [], priorStoryState, settings = {}, castOverrides = [] } = {}) {
    // A captured highlight/selected passage is the player's explicit focus. When
    // there is no selection, preserve the exact clicked message as the source;
    // interpretation is supporting context and must never erase it.
    const primarySource = boundedSourceText(focusText) || boundedSourceText(sourceText(selectedPassage)) || boundedSourceText(sourceText(clickedMessage) || sourceMessage);
    const interpretation = interpretScene({
        selectedPassage: selectedPassage ?? focusText,
        clickedMessage: clickedMessage ?? sourceMessage,
        recentContext,
        identities,
        priorStoryState,
    });
    const interpretedState = clone(interpretation.storyStateDelta?.nextState || { schema: SCENE_STATE_SCHEMA, durableIdentityFacts: {}, sceneFacts: {} });
    const existingCast = isRecord(interpretedState.sceneFacts) && Array.isArray(interpretedState.sceneFacts.cast) ? interpretedState.sceneFacts.cast : interpretation.cast;
    const validation = validateDirectorCastOverrides(castOverrides, { identities, cast: existingCast });
    if (!validation.valid) throw new TypeError(`Director cast override identity is not valid for this scene: ${validation.invalidIdentityIds.join(', ')}`);
    const applied = applyDirectorCastOverrides({ cast: existingCast, identities, overrides: validation.overrides });
    const state = {
        ...interpretedState,
        sceneFacts: {
            ...(isRecord(interpretedState.sceneFacts) ? interpretedState.sceneFacts : {}),
            cast: applied.cast,
        },
    };
    const sourcePassage = primarySource || boundedSourceText(interpretation.focusPassage?.text || '');
    const inspection = clone(interpretation.inspection);
    if (validation.overrides.length) {
        inspection.castOverrides = clone(validation.overrides);
        inspection.lines = [...(Array.isArray(inspection.lines) ? inspection.lines : []), `Cast correction: ${applied.promptLine || 'none'}`].slice(0, 8);
    }
    return Object.freeze({
        interpretation: clone(interpretation),
        state,
        // State persistence intentionally strips evidence/confidence. Keep this
        // captured, transient projection for scene-relevant avatar selection.
        avatarSceneCast: avatarSceneCast(state, interpretation),
        sourcePassage,
        inspection,
        prompt: buildScenePrompt({ sourcePassage, state, settings, castCorrection: applied }),
        castOverrides: clone(validation.overrides),
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
        inspection: clone(snapshot.inspection || {
            title: 'Scene interpretation',
            confidence: 'low',
            lines: ['Scene interpretation unavailable.'],
            statuses: {},
            warnings: ['Scene interpretation was unavailable when this image was generated.'],
        }),
        ...(Array.isArray(snapshot.castOverrides) && snapshot.castOverrides.length ? { castOverrides: clone(snapshot.castOverrides) } : {}),
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

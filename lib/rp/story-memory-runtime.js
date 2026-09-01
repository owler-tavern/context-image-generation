import { createStoryMemory } from './story-memory.js';
import { compactReferenceReceipt } from './reference-receipt.js';

export const STORY_MEMORY_SETTINGS_KEY = 'story_memory';

export const STORY_MEMORY_PERSISTENCE_LIMITS = Object.freeze({
    maxArtifacts: 500,
    maxArtifactsPerChat: 200,
    maxFactsPerArtifact: 32,
    maxText: 2000,
    maxFactText: 320,
    maxMetadataKeys: 16,
    maxBytes: 240000,
});

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function text(value) { return String(value ?? '').trim(); }

function bounded(value, limit = STORY_MEMORY_PERSISTENCE_LIMITS.maxText) {
    const result = text(value).replace(/\s+/gu, ' ');
    return result.length > limit ? result.slice(0, limit) : result;
}

function byteLength(value) {
    const serialized = JSON.stringify(value);
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).length : serialized.length;
}

function nullableNumber(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function safeFact(value) {
    if (!isRecord(value)) return null;
    const result = {};
    for (const key of ['id', 'kind', 'identityId', 'value', 'text', 'confidence', 'validFrom', 'validUntil', 'status']) {
        const raw = value[key];
        if (raw === undefined || raw === null) continue;
        if (key === 'validFrom' || key === 'validUntil') {
            if (Number.isFinite(Number(raw)) || /^\d{4}-\d{2}-\d{2}/u.test(String(raw))) result[key] = raw;
        } else {
            const limit = key === 'text' || key === 'value' ? STORY_MEMORY_PERSISTENCE_LIMITS.maxFactText : 120;
            const safe = bounded(raw, limit);
            if (safe) result[key] = safe;
        }
    }
    return result.text ? result : null;
}

function factText(kind, value, entry) {
    const label = bounded(entry?.label || entry?.identityId || entry?.holderIdentityId, 120);
    if (kind === 'location') return `Location: ${bounded(value, STORY_MEMORY_PERSISTENCE_LIMITS.maxFactText)}.`;
    return `${label ? `${label} ` : ''}${kind}: ${bounded(value, STORY_MEMORY_PERSISTENCE_LIMITS.maxFactText)}.`;
}

/** Converts the real P2 scene state into a small, provider-free fact snapshot. */
export function buildStoryMemoryFactSnapshot(state = {}) {
    const scene = isRecord(state?.sceneFacts) ? state.sceneFacts : (isRecord(state?.scene) ? state.scene : state);
    const facts = [];
    const add = (kind, entry, index) => {
        const source = isRecord(entry) ? entry : { value: entry };
        const value = bounded(source.value || source.label || source.name, STORY_MEMORY_PERSISTENCE_LIMITS.maxFactText);
        if (!value || ['unknown', 'ambiguous'].includes(bounded(source.status, 30).toLocaleLowerCase())) return;
        const fact = safeFact({
            id: `scene:${kind}:${index}:${value}`,
            kind,
            identityId: source.identityId || source.holderIdentityId,
            value,
            text: factText(kind, value, source),
            confidence: source.confidence,
        });
        if (fact) facts.push(fact);
    };
    if (Array.isArray(scene.cast)) scene.cast.forEach((entry, index) => add('cast present', entry?.label || entry?.identityId, index));
    if (typeof scene.location === 'string') add('location', scene.location, 0);
    else if (isRecord(scene.location)) add('location', scene.location, 0);
    for (const kind of ['outfits', 'objects', 'injuries']) if (Array.isArray(scene[kind])) scene[kind].forEach((entry, index) => add(kind.slice(0, -1), entry, index));
    return facts.slice(0, STORY_MEMORY_PERSISTENCE_LIMITS.maxFactsPerArtifact);
}

function safeFacts(value, fallbackState) {
    const direct = Array.isArray(value) ? value.map(safeFact).filter(Boolean) : [];
    return (direct.length ? direct : buildStoryMemoryFactSnapshot(fallbackState)).slice(0, STORY_MEMORY_PERSISTENCE_LIMITS.maxFactsPerArtifact);
}

function currentMedia(message, messageId, extensionName) {
    const media = Array.isArray(message?.extra?.media) ? message.extra.media : [];
    return media.filter((item) => item?.cig_owner === extensionName || (typeof item?.url === 'string' && item.url.includes(extensionName)))
        .filter((item) => typeof item?.url === 'string' && item.url.trim())
        .map((item, mediaIndex) => {
            const iteration = isRecord(item.cig_iteration_artifact) ? item.cig_iteration_artifact : {};
            const continuity = isRecord(item.cig_continuity_snapshot) ? item.cig_continuity_snapshot : {};
            const referenceReceipt = (Array.isArray(continuity.referenceReceipt?.used) || Array.isArray(continuity.referenceReceipt?.omitted))
                ? compactReferenceReceipt(continuity.referenceReceipt)
                : null;
            const facts = safeFacts(item.cig_story_memory_facts, item.cig_scene_state || item.cig_scene_inspection?.state || iteration.scene?.state);
            const sourcePassage = iteration.sourcePassage?.text || message?.mes || item.title || '';
            const effectivePrompt = iteration.effectivePrompt || item.title || sourcePassage;
            const model = iteration.model?.modelId || iteration.model?.id || iteration.model || null;
            const settings = isRecord(iteration.options) ? clone(iteration.options) : {};
            const references = Array.isArray(iteration.references) ? clone(iteration.references) : [];
            const characterIds = [...new Set([
                ...(Array.isArray(item.characterIds) ? item.characterIds : []),
                ...(Array.isArray(iteration.characterIds) ? iteration.characterIds : []),
                ...references.map((reference) => reference?.identityId || reference?.characterId).filter(Boolean),
            ].map(text).filter(Boolean))];
            const sourceId = text(item.id || item.artifactId) || `media:${messageId}:${mediaIndex}:${item.url}`;
            const version = Number.isFinite(Number(item.version || iteration.version)) ? Number(item.version || iteration.version) : 1;
            return {
                ...clone(item),
                id: sourceId,
                version,
                url: item.url,
                chatId: text(item.chatId) || null,
                messageId,
                createdAt: iteration.createdAt ?? message?.send_date ?? message?.createdAt ?? null,
                prompt: effectivePrompt,
                taskId: text(item.taskId || iteration.taskId || iteration.generationPlan?.planId) || null,
                characterIds,
                sourceMoment: {
                    passage: sourcePassage,
                    sender: message?.name || message?.name2 || (message?.is_user ? 'User' : 'Character'),
                    messageId,
                },
                generation: {
                    sourcePassage,
                    effectivePrompt,
                    references,
                    model,
                    settings,
                    ...(referenceReceipt ? { referenceReceipt } : {}),
                },
                facts,
                provenance: {
                    schema: 1,
                    source: 'chat-media',
                    chatId: text(item.chatId) || null,
                    messageId,
                    mediaId: sourceId,
                    version,
                    ...(iteration.artifactId ? { iterationArtifactId: iteration.artifactId } : {}),
                },
            };
        });
}

function compactSettings(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(0, STORY_MEMORY_PERSISTENCE_LIMITS.maxMetadataKeys)
        .map(([key, item]) => [bounded(key, 80), typeof item === 'boolean' || typeof item === 'number' ? item : bounded(item, 160)])
        .filter(([key]) => key));
}

function compactArtifact(value) {
    const source = isRecord(value) ? value : {};
    const generation = isRecord(source.generation) ? source.generation : {};
    const sourceMoment = isRecord(source.sourceMoment) ? source.sourceMoment : null;
    const provenance = isRecord(source.provenance) ? source.provenance : {};
    const referenceReceipt = (Array.isArray(generation.referenceReceipt?.used) || Array.isArray(generation.referenceReceipt?.omitted))
        ? compactReferenceReceipt(generation.referenceReceipt)
        : null;
    const references = Array.isArray(generation.references) ? generation.references.slice(0, 32).map((reference) => {
        if (!isRecord(reference)) return null;
        return Object.fromEntries(['id', 'role', 'identityId', 'characterId', 'assetId'].map((key) => [key, bounded(reference[key], 160)]).filter(([, item]) => item));
    }).filter((reference) => Object.keys(reference).length) : [];
    const facts = safeFacts(source.facts).slice(0, STORY_MEMORY_PERSISTENCE_LIMITS.maxFactsPerArtifact);
    return {
        id: bounded(source.id, 180),
        url: bounded(source.url, 2048) || null,
        ...(source.mimeType ? { mimeType: bounded(source.mimeType, 80) } : {}),
        chatId: bounded(source.chatId, 160) || null,
        messageId: nullableNumber(source.messageId),
        createdAt: typeof source.createdAt === 'number' || typeof source.createdAt === 'string' ? source.createdAt : null,
        taskId: bounded(source.taskId, 180) || null,
        characterIds: [...new Set((Array.isArray(source.characterIds) ? source.characterIds : []).map((item) => bounded(item, 120)).filter(Boolean))].slice(0, 32),
        prompt: bounded(source.prompt),
        model: bounded(source.model || generation.model, 180) || null,
        ...(nullableNumber(source.sequence) !== undefined ? { sequence: nullableNumber(source.sequence) } : {}),
        ...(nullableNumber(source.order) !== undefined ? { order: nullableNumber(source.order) } : {}),
        ...(nullableNumber(source.version) !== undefined ? { version: nullableNumber(source.version) } : {}),
        ...(Array.isArray(source.aliases) ? { aliases: [...new Set(source.aliases.map((alias) => bounded(alias, 180)).filter(Boolean))].slice(0, 16) } : {}),
        sourceMoment: sourceMoment === null ? null : {
            passage: bounded(sourceMoment.passage, STORY_MEMORY_PERSISTENCE_LIMITS.maxText),
            sender: bounded(sourceMoment.sender, 120),
            messageId: nullableNumber(sourceMoment.messageId) ?? null,
        },
        generation: {
            sourcePassage: bounded(generation.sourcePassage, STORY_MEMORY_PERSISTENCE_LIMITS.maxText) || null,
            effectivePrompt: bounded(generation.effectivePrompt, STORY_MEMORY_PERSISTENCE_LIMITS.maxText) || null,
            references,
            model: bounded(generation.model, 180) || null,
            settings: compactSettings(generation.settings),
            ...(referenceReceipt ? { referenceReceipt } : {}),
        },
        facts,
        favorite: source.favorite === true,
        provenance: {
            schema: Number.isFinite(Number(provenance.schema)) ? Number(provenance.schema) : 1,
            source: bounded(provenance.source, 80) || 'story-memory',
            ...(provenance.chatId ? { chatId: bounded(provenance.chatId, 160) } : {}),
            ...(nullableNumber(provenance.messageId) !== undefined ? { messageId: nullableNumber(provenance.messageId) } : {}),
            ...(provenance.mediaId ? { mediaId: bounded(provenance.mediaId, 180) } : {}),
            ...(nullableNumber(provenance.version) !== undefined ? { version: nullableNumber(provenance.version) } : {}),
            ...(provenance.iterationArtifactId ? { iterationArtifactId: bounded(provenance.iterationArtifactId, 180) } : {}),
        },
    };
}

function sortArtifacts(left, right) {
    const leftDate = Number.isFinite(Number(left.createdAt)) ? Number(left.createdAt) : Number.POSITIVE_INFINITY;
    const rightDate = Number.isFinite(Number(right.createdAt)) ? Number(right.createdAt) : Number.POSITIVE_INFINITY;
    if (leftDate !== rightDate) return rightDate - leftDate;
    return Number(right.messageId || -1) - Number(left.messageId || -1) || String(right.id).localeCompare(String(left.id));
}

function compactCollections(value, artifactIds) {
    const collections = {};
    for (const [id, item] of Object.entries(isRecord(value) ? value : {}).slice(0, 100)) {
        const collectionId = bounded(item?.id || id, 120);
        if (!collectionId) continue;
        collections[collectionId] = {
            id: collectionId,
            kind: bounded(item?.kind, 40) || 'moment',
            label: bounded(item?.label || collectionId, 120),
            memberIds: [...new Set((Array.isArray(item?.memberIds) ? item.memberIds : []).map((member) => bounded(member, 180)).filter((member) => artifactIds.has(member)))].slice(0, 200),
        };
    }
    return collections;
}

/** Applies the persistence contract before story memory reaches extension settings. */
export function compactStoryMemory(value = {}, { chatId } = {}) {
    const normalized = createStoryMemory(value || {}, { chatId });
    const candidates = Object.values(normalized.artifacts || {}).map(compactArtifact).filter((artifact) => artifact.id && artifact.url);
    const perChat = new Map();
    const artifacts = {};
    for (const artifact of candidates.sort(sortArtifacts)) {
        const key = text(artifact.chatId) || 'unknown-chat';
        const count = perChat.get(key) || 0;
        if (count >= STORY_MEMORY_PERSISTENCE_LIMITS.maxArtifactsPerChat || Object.keys(artifacts).length >= STORY_MEMORY_PERSISTENCE_LIMITS.maxArtifacts) continue;
        perChat.set(key, count + 1);
        artifacts[artifact.id] = artifact;
    }
    const keepIds = new Set(Object.keys(artifacts));
    let compacted = { schema: 2, artifacts, collections: compactCollections(normalized.collections, keepIds) };
    while (byteLength(compacted) > STORY_MEMORY_PERSISTENCE_LIMITS.maxBytes && Object.keys(compacted.artifacts).length) {
        const removable = Object.values(compacted.artifacts).filter((artifact) => !artifact.favorite).sort((left, right) => sortArtifacts(right, left))[0]
            || Object.values(compacted.artifacts).sort((left, right) => sortArtifacts(right, left))[0];
        delete compacted.artifacts[removable.id];
        const ids = new Set(Object.keys(compacted.artifacts));
        compacted.collections = compactCollections(compacted.collections, ids);
    }
    return compacted;
}

export function collectStoryMemoryMedia({ chatId, chat = [], extensionName = 'context-image-generation' } = {}) {
    const targetChatId = text(chatId);
    if (!targetChatId || !Array.isArray(chat)) return [];
    return chat.flatMap((message, messageId) => currentMedia(message, messageId, extensionName)
        .map((item) => ({ ...item, chatId: targetChatId, provenance: { ...item.provenance, chatId: targetChatId } })));
}

function retainedGallery({ gallery = [], chatId, chat = [], extensionName = 'context-image-generation' } = {}) {
    const target = text(chatId);
    if (!Array.isArray(gallery) || !target) return [];
    const urlsByMessage = new Map();
    for (const [messageId, message] of (Array.isArray(chat) ? chat : []).entries()) {
        for (const item of currentMedia(message, messageId, extensionName)) urlsByMessage.set(`${messageId}:${item.url}`, true);
    }
    return gallery.filter((item) => {
        if (text(item?.chatId) === target) return true;
        if (item?.chatId) return false;
        return urlsByMessage.has(`${item?.messageId}:${item?.url}`);
    }).map((item) => ({
        ...clone(item),
        ...(Array.isArray(item?.sourceMetadata?.storyMemoryFacts) ? { facts: safeFacts(item.sourceMetadata.storyMemoryFacts) } : {}),
    }));
}

function dedupeMedia(entries) {
    const seen = new Map();
    for (const entry of entries) {
        const key = `${text(entry?.chatId)}::${text(entry?.url)}`;
        if (!key.endsWith('::')) seen.set(key, entry);
    }
    return [...seen.values()];
}

function persistedSettings(payload) {
    if (typeof payload?.settings === 'string') {
        try { return JSON.parse(payload.settings); } catch { return null; }
    }
    return payload?.settings || payload;
}

function persistedMemory(payload, extensionName) {
    const raw = persistedSettings(payload);
    return raw?.extension_settings?.[extensionName]?.[STORY_MEMORY_SETTINGS_KEY]
        ?? raw?.settings?.extension_settings?.[extensionName]?.[STORY_MEMORY_SETTINGS_KEY]
        ?? raw?.[STORY_MEMORY_SETTINGS_KEY]
        ?? null;
}

export function createStoryMemoryRuntime({
    extensionName = 'context-image-generation',
    settings,
    getChat = () => [],
    getChatId = () => null,
    isCurrent = () => true,
    saveSettings,
    fetchImpl = globalThis.fetch,
    getHeaders,
} = {}) {
    if (!isRecord(settings)) throw new TypeError('Story memory runtime settings are required.');
    const empty = () => createStoryMemory({ schema: 2, artifacts: {}, collections: {} });
    const readLocal = () => compactStoryMemory(settings[STORY_MEMORY_SETTINGS_KEY] || empty());
    const currentGallery = (chatId) => retainedGallery({ gallery: settings.gallery || [], chatId, chat: getChat(), extensionName });
    const assertCurrent = (chatId, epoch) => {
        if (!isCurrent({ chatId, epoch }) || text(getChatId()) !== text(chatId)) throw new Error('Story memory action blocked because the chat changed.');
    };
    return {
        async readMemory({ chatId } = {}) {
            return { status: 'ready', memory: readLocal(), gallery: currentGallery(chatId) };
        },
        async hydrateGallery({ memory, gallery = [], chatId } = {}) {
            const inline = collectStoryMemoryMedia({ chatId, chat: getChat(), extensionName });
            const combined = dedupeMedia([...gallery, ...inline]);
            const existingUrls = new Set(Object.values(memory?.artifacts || {}).map((artifact) => `${text(artifact?.chatId)}::${text(artifact?.url)}`));
            const missing = combined.filter((entry) => !existingUrls.has(`${text(chatId)}::${text(entry?.url)}`));
            const hydratedMemory = compactStoryMemory(createStoryMemory(memory || empty(), { gallery: missing, chatId }), { chatId });
            // The controller merges the returned gallery through the canonical
            // Gallery migration seam. Return only raw physical entries that
            // were newly hydrated; returning normalized story artifacts here
            // would make the controller migrate an already-canonical ID a
            // second time on reload.
            return { status: 'ready', memory: hydratedMemory, gallery: missing };
        },
        persistMemory: (() => {
            let queue = Promise.resolve();
            const persist = async ({ memory, chatId, epoch } = {}) => {
                assertCurrent(chatId, epoch);
                const hadPrevious = Object.prototype.hasOwnProperty.call(settings, STORY_MEMORY_SETTINGS_KEY);
                const previous = clone(settings[STORY_MEMORY_SETTINGS_KEY]);
                settings[STORY_MEMORY_SETTINGS_KEY] = clone(compactStoryMemory(memory || empty(), { chatId }));
                let saveStarted = false;
                try {
                    if (typeof saveSettings !== 'function') throw new Error('Story memory saveSettings dependency is unavailable.');
                    saveStarted = true;
                    await saveSettings();
                    assertCurrent(chatId, epoch);
                    return { status: 'saved', memory: settings[STORY_MEMORY_SETTINGS_KEY] };
                } catch (error) {
                    if (hadPrevious) settings[STORY_MEMORY_SETTINGS_KEY] = previous;
                    else delete settings[STORY_MEMORY_SETTINGS_KEY];
                    if (saveStarted) {
                        try { await saveSettings(); } catch { /* preserve the original failure */ }
                    }
                    throw error;
                }
            };
            return (request) => {
                const result = queue.catch(() => {}).then(() => persist(request));
                queue = result.catch(() => {});
                return result;
            };
        })(),
        async readbackMemory({ chatId, epoch } = {}) {
            assertCurrent(chatId, epoch);
            if (typeof fetchImpl !== 'function') throw new Error('Story memory readback fetch is unavailable.');
            const response = await fetchImpl('/api/settings/get', { method: 'POST', headers: getHeaders?.(), body: JSON.stringify({}) });
            if (!response?.ok) throw new Error('Story memory persistence could not be read back.');
            const persisted = persistedMemory(await response.json(), extensionName);
            return persisted ? { status: 'confirmed', memory: compactStoryMemory(persisted, { chatId }) } : { status: 'confirmed-absent', memory: empty() };
        },
        getCurrentGallery: currentGallery,
    };
}

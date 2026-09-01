import { createStoryMemory } from './story-memory.js';

export const STORY_MEMORY_SETTINGS_KEY = 'story_memory';

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function text(value) { return String(value ?? '').trim(); }

function currentMedia(message, messageId, extensionName) {
    const media = Array.isArray(message?.extra?.media) ? message.extra.media : [];
    return media.filter((item) => item?.cig_owner === extensionName || (typeof item?.url === 'string' && item.url.includes(extensionName)))
        .filter((item) => typeof item?.url === 'string' && item.url.trim())
        .map((item, mediaIndex) => {
            const iteration = isRecord(item.cig_iteration_artifact) ? item.cig_iteration_artifact : {};
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
                },
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
    }).map(clone);
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
    const readLocal = () => createStoryMemory(settings[STORY_MEMORY_SETTINGS_KEY] || empty());
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
            return { status: 'ready', memory: createStoryMemory(memory || empty(), { gallery: combined, chatId }), gallery: combined };
        },
        async persistMemory({ memory, chatId, epoch } = {}) {
            assertCurrent(chatId, epoch);
            const previous = settings[STORY_MEMORY_SETTINGS_KEY];
            settings[STORY_MEMORY_SETTINGS_KEY] = clone(createStoryMemory(memory || empty()));
            try {
                if (typeof saveSettings !== 'function') throw new Error('Story memory saveSettings dependency is unavailable.');
                await saveSettings();
                assertCurrent(chatId, epoch);
                return { status: 'saved', memory: settings[STORY_MEMORY_SETTINGS_KEY] };
            } catch (error) {
                settings[STORY_MEMORY_SETTINGS_KEY] = previous;
                throw error;
            }
        },
        async readbackMemory({ chatId, epoch } = {}) {
            assertCurrent(chatId, epoch);
            if (typeof fetchImpl !== 'function') throw new Error('Story memory readback fetch is unavailable.');
            const response = await fetchImpl('/api/settings/get', { method: 'POST', headers: getHeaders?.(), body: JSON.stringify({}) });
            if (!response?.ok) throw new Error('Story memory persistence could not be read back.');
            const persisted = persistedMemory(await response.json(), extensionName);
            return persisted ? { status: 'confirmed', memory: createStoryMemory(persisted) } : { status: 'confirmed-absent', memory: empty() };
        },
        getCurrentGallery: currentGallery,
    };
}

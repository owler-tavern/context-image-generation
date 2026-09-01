/**
 * Pure domain model for Priority 4 visual story memory.
 *
 * This module stores metadata and references to media. It deliberately has no
 * Gallery or Appearance lifecycle and never performs provider/network work.
 */

export const STORY_MEMORY_SCHEMA = 1;
export const STORY_PROVENANCE_SCHEMA = 1;
export const STORY_COLLECTION_KINDS = Object.freeze(['canon-look', 'location', 'outfit', 'moment']);

const BINARY_KEYS = new Set(['data', 'imageData', 'mediaData', 'base64']);
const ARTIFACT_KEYS = new Set([
    'id', 'artifactId', 'assetId', 'url', 'mediaUrl', 'mimeType', 'chatId', 'messageId', 'createdAt',
    'taskId', 'characterId', 'characterIds', 'character', 'characters', 'prompt', 'model', 'settings',
    'sourceMoment', 'sourcePassage', 'generation', 'references', 'facts', 'storyFacts', 'favorite',
    'provenance', 'legacyMetadata', 'metadata', 'title', 'sequence', 'order', 'isFavorite',
]);

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function cleanBinary(value, path = [], omitted = []) {
    if (Array.isArray(value)) return value.map((item, index) => cleanBinary(item, [...path, String(index)], omitted));
    if (!isRecord(value)) return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (BINARY_KEYS.has(key)) {
            omitted.push([...path, key].join('.'));
            continue;
        }
        output[key] = cleanBinary(item, [...path, key], omitted);
    }
    return output;
}

function text(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function stableString(value) {
    if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function hash(value) {
    let result = 2166136261;
    for (const character of value) {
        result ^= character.charCodeAt(0);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
}

function dateValue(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function sourceIdForGallery(item, chatId) {
    const source = isRecord(item) ? item : {};
    const explicit = source.id ?? source.artifactId ?? source.assetId;
    if (explicit !== undefined && text(explicit)) return text(explicit);
    if (source.url && source.messageId !== undefined) return `message:${source.messageId}:url:${source.url}`;
    if (source.url) return `url:${source.url}`;
    return `hash:${hash(stableString({ chatId: text(chatId), source }))}`;
}

export function buildStoryArtifactId({ item, chatId } = {}) {
    const scope = text(chatId || item?.chatId) || 'unknown-chat';
    const sourceId = sourceIdForGallery(item, scope);
    return `story:${scope}:${sourceId}`;
}

function metadataForGallery(item) {
    const source = isRecord(item) ? item : {};
    const omittedFields = [];
    const sourceMetadata = cleanBinary(source.sourceMetadata, ['sourceMetadata'], omittedFields);
    const unknown = {};
    for (const [key, value] of Object.entries(source)) {
        if (!ARTIFACT_KEYS.has(key) && key !== 'sourceMetadata' && !BINARY_KEYS.has(key)) unknown[key] = cleanBinary(value, [key], omittedFields);
        if (BINARY_KEYS.has(key)) omittedFields.push(key);
    }
    const legacyMetadata = {
        ...(sourceMetadata && Object.keys(sourceMetadata).length ? { sourceMetadata } : {}),
        ...(Object.keys(unknown).length ? { unknown } : {}),
        ...(omittedFields.length ? { omittedFields: [...new Set(omittedFields)] } : {}),
    };
    return Object.keys(legacyMetadata).length ? legacyMetadata : undefined;
}

function normalizeCharacterIds(source) {
    const values = [
        ...(Array.isArray(source.characterIds) ? source.characterIds : []),
        ...(source.characterId ? [source.characterId] : []),
        ...(Array.isArray(source.characters) ? source.characters : []),
        ...(Array.isArray(source.sourceMetadata?.characterIds) ? source.sourceMetadata.characterIds : []),
    ];
    return [...new Set(values.map((value) => (isRecord(value) ? value.id || value.characterId || value.name : value)).map(text).filter(Boolean))];
}

function normalizeGeneration(source) {
    const generation = isRecord(source.generation) ? source.generation : {};
    const legacy = isRecord(source.sourceMetadata) ? source.sourceMetadata : {};
    const references = generation.references ?? source.references ?? legacy.references ?? [];
    const settings = generation.settings ?? source.settings ?? legacy.settings ?? {};
    return {
        sourcePassage: generation.sourcePassage ?? source.sourcePassage ?? source.sourceMoment?.passage
            ?? legacy.sourcePassage ?? legacy.sourceMoment?.passage ?? null,
        effectivePrompt: generation.effectivePrompt ?? source.effectivePrompt ?? source.prompt ?? legacy.effectivePrompt ?? null,
        references: clone(Array.isArray(references) ? references : []),
        model: generation.model ?? source.model ?? legacy.model ?? null,
        settings: clone(isRecord(settings) ? settings : {}),
    };
}

function normalizeArtifact(value, fallbackId, { migrated = false } = {}) {
    const source = isRecord(value) ? value : {};
    const id = text(source.id || source.artifactId || fallbackId);
    const generation = normalizeGeneration(source);
    const sourceMomentValue = source.sourceMoment ?? source.sourceMetadata?.sourceMoment;
    const sourceMoment = sourceMomentValue === undefined
        ? (source.sourcePassage || source.sourceMetadata?.sourcePassage ? { passage: source.sourcePassage || source.sourceMetadata.sourcePassage } : null)
        : clone(sourceMomentValue);
    const rawFacts = source.facts ?? source.storyFacts ?? [];
    const artifact = {
        ...clone(source),
        id,
        url: text(source.url || source.mediaUrl) || null,
        ...(source.mimeType ? { mimeType: text(source.mimeType) } : {}),
        chatId: text(source.chatId) || null,
        messageId: Number.isFinite(source.messageId) ? source.messageId : (source.messageId == null ? null : Number(source.messageId)),
        createdAt: source.createdAt ?? source.timestamp ?? null,
        taskId: text(source.taskId) || null,
        characterIds: normalizeCharacterIds(source),
        prompt: source.prompt == null ? null : String(source.prompt),
        model: text(source.model || generation.model || source.sourceMetadata?.model) || null,
        sourceMoment,
        generation,
        facts: clone(Array.isArray(rawFacts) ? rawFacts : []),
        favorite: source.favorite === true || source.isFavorite === true,
        provenance: clone(source.provenance || {
            schema: STORY_PROVENANCE_SCHEMA,
            source: migrated ? 'gallery-migration' : 'story-memory',
            ...(source.chatId ? { chatId: text(source.chatId) } : {}),
            ...(source.messageId !== undefined ? { messageId: source.messageId } : {}),
        }),
    };
    delete artifact.artifactId;
    delete artifact.assetId;
    delete artifact.mediaUrl;
    delete artifact.data;
    delete artifact.imageData;
    delete artifact.mediaData;
    delete artifact.base64;
    if (!artifact.legacyMetadata && migrated) artifact.legacyMetadata = metadataForGallery(source);
    if (!artifact.legacyMetadata) delete artifact.legacyMetadata;
    return artifact;
}

export function migrateGalleryEntries(gallery = [], { chatId } = {}) {
    const entries = Array.isArray(gallery) ? gallery : [];
    const seen = new Set();
    return entries.map((item) => {
        const itemChatId = text(item?.chatId || chatId) || null;
        const id = buildStoryArtifactId({ item, chatId: itemChatId });
        if (seen.has(id)) return null;
        seen.add(id);
        const sourceId = sourceIdForGallery(item, itemChatId);
        const source = isRecord(item) ? item : {};
        return normalizeArtifact({
            ...source,
            id,
            chatId: itemChatId,
            provenance: {
                schema: STORY_PROVENANCE_SCHEMA,
                source: 'gallery-migration',
                galleryArtifactId: sourceId,
                ...(itemChatId ? { chatId: itemChatId } : {}),
                ...(source.messageId !== undefined ? { messageId: source.messageId } : {}),
            },
        }, id, { migrated: true });
    }).filter(Boolean);
}

function normalizeCollection(value, fallbackId) {
    const source = isRecord(value) ? value : {};
    const id = text(source.id || fallbackId);
    const kind = STORY_COLLECTION_KINDS.includes(source.kind) ? source.kind : 'moment';
    const memberIds = [...new Set((Array.isArray(source.memberIds) ? source.memberIds : Array.isArray(source.artifactIds) ? source.artifactIds : [])
        .map(text).filter(Boolean))];
    const collection = { ...clone(source), id, kind, label: text(source.label || id), memberIds };
    delete collection.artifactIds;
    return collection;
}

export function migrateStoryMemory(value = {}, { gallery = [], chatId } = {}) {
    const source = isRecord(value) ? value : {};
    const rawArtifacts = isRecord(source.artifacts) ? Object.entries(source.artifacts) : [];
    const artifacts = Object.fromEntries(rawArtifacts.map(([id, artifact]) => [text(artifact?.id || id), normalizeArtifact({ ...artifact, id: artifact?.id || id }, id)]));
    for (const artifact of migrateGalleryEntries(gallery, { chatId })) {
        if (!artifacts[artifact.id]) artifacts[artifact.id] = artifact;
    }
    const rawCollections = isRecord(source.collections) ? Object.entries(source.collections) : [];
    const collections = Object.fromEntries(rawCollections.map(([id, collection]) => [text(collection?.id || id), normalizeCollection({ ...collection, id: collection?.id || id }, id)]));
    return { schema: STORY_MEMORY_SCHEMA, artifacts, collections };
}

export function createStoryMemory(value = {}, options = {}) {
    return migrateStoryMemory(value, options);
}

export function addStoryArtifact(memoryValue, artifactValue) {
    const memory = migrateStoryMemory(memoryValue);
    const source = isRecord(artifactValue) ? artifactValue : {};
    let id = text(source.id || source.artifactId) || buildStoryArtifactId({ item: source, chatId: source.chatId });
    if (memory.artifacts[id] && text(memory.artifacts[id].chatId) !== text(source.chatId) && source.chatId) {
        id = buildStoryArtifactId({ item: source, chatId: source.chatId });
    }
    memory.artifacts[id] = normalizeArtifact({ ...source, id }, id);
    return memory;
}

export function getStoryTimeline(memoryValue, { chatId, favorite } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    return Object.values(memory.artifacts)
        .filter((artifact) => chatId === undefined || text(artifact.chatId) === text(chatId))
        .filter((artifact) => favorite === undefined || artifact.favorite === favorite)
        .sort((left, right) => {
            const leftMessage = Number.isFinite(left.messageId) ? left.messageId : Number.POSITIVE_INFINITY;
            const rightMessage = Number.isFinite(right.messageId) ? right.messageId : Number.POSITIVE_INFINITY;
            if (leftMessage !== rightMessage) return leftMessage - rightMessage;
            const leftDate = dateValue(left.createdAt) ?? Number.POSITIVE_INFINITY;
            const rightDate = dateValue(right.createdAt) ?? Number.POSITIVE_INFINITY;
            if (leftDate !== rightDate) return leftDate - rightDate;
            return left.id.localeCompare(right.id);
        })
        .map(clone);
}

export function toggleStoryFavorite(memoryValue, artifactId, favorite) {
    const memory = migrateStoryMemory(memoryValue);
    const id = text(artifactId);
    if (memory.artifacts[id]) memory.artifacts[id].favorite = favorite === undefined ? !memory.artifacts[id].favorite : favorite === true;
    return memory;
}

function artifactSearchText(artifact) {
    const generation = artifact.generation || {};
    return [artifact.prompt, generation.effectivePrompt, generation.sourcePassage, artifact.sourceMoment?.passage].filter(Boolean).join(' ').toLocaleLowerCase();
}

function matchesCharacter(artifact, filter) {
    const requested = Array.isArray(filter) ? filter.map(text).filter(Boolean) : [text(filter)].filter(Boolean);
    if (!requested.length) return true;
    const available = new Set([...artifact.characterIds, text(artifact.character), text(artifact.characterId)].filter(Boolean));
    return requested.some((id) => available.has(id));
}

export function searchStoryArtifacts(memoryValue, filters = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const prompt = text(filters.prompt || filters.promptText).toLocaleLowerCase();
    const from = dateValue(filters.from ?? filters.startDate);
    const to = dateValue(filters.to ?? filters.endDate);
    return Object.values(memory.artifacts).filter((artifact) => {
        if (filters.chatId !== undefined && text(artifact.chatId) !== text(filters.chatId)) return false;
        if (filters.taskId !== undefined && text(artifact.taskId) !== text(filters.taskId)) return false;
        if (filters.model !== undefined && text(artifact.model || artifact.generation?.model) !== text(filters.model)) return false;
        if (filters.characterId !== undefined && !matchesCharacter(artifact, filters.characterId)) return false;
        if (filters.character !== undefined && !matchesCharacter(artifact, filters.character)) return false;
        if (filters.favorite !== undefined && artifact.favorite !== filters.favorite) return false;
        if (prompt && !artifactSearchText(artifact).includes(prompt)) return false;
        const created = dateValue(artifact.createdAt);
        if (from !== null && (created === null || created < from)) return false;
        if (to !== null && (created === null || created > to + (typeof filters.to === 'string' && filters.to.length <= 10 ? 86400000 - 1 : 0))) return false;
        return true;
    }).sort((left, right) => (dateValue(left.createdAt) ?? 0) - (dateValue(right.createdAt) ?? 0)).map(clone);
}

export function addStoryCollectionMember(memoryValue, { collectionId, kind = 'moment', label, artifactId } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const id = text(collectionId);
    const artifact = text(artifactId);
    if (!id || !artifact || !memory.artifacts[artifact]) return memory;
    const existing = memory.collections[id] || normalizeCollection({ id, kind, label: label || id, memberIds: [] }, id);
    if (!existing.memberIds.includes(artifact)) existing.memberIds.push(artifact);
    memory.collections[id] = existing;
    return memory;
}

export function createStoryCollection(memoryValue, { collectionId, kind = 'moment', label } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const id = text(collectionId);
    if (!id) return memory;
    if (!memory.collections[id]) memory.collections[id] = normalizeCollection({ id, kind, label: label || id, memberIds: [] }, id);
    return memory;
}

export function listStoryCollections(memoryValue, { kind } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    return Object.values(memory.collections)
        .filter((collection) => kind === undefined || collection.kind === kind)
        .map(clone);
}

export function getStoryCollection(memoryValue, collectionId) {
    const memory = migrateStoryMemory(memoryValue);
    const collection = memory.collections[text(collectionId)];
    return collection ? clone(collection) : null;
}

export function removeStoryCollectionMember(memoryValue, collectionId, artifactId) {
    const memory = migrateStoryMemory(memoryValue);
    const collection = memory.collections[text(collectionId)];
    if (collection) collection.memberIds = collection.memberIds.filter((id) => id !== text(artifactId));
    return memory;
}

export function listStoryCollectionMembers(memoryValue, collectionId) {
    const memory = migrateStoryMemory(memoryValue);
    const collection = memory.collections[text(collectionId)];
    if (!collection) return [];
    return collection.memberIds.map((id) => memory.artifacts[id]).filter(Boolean).map(clone);
}

export function getGenerationDetails(memoryValue, artifactId) {
    const memory = migrateStoryMemory(memoryValue);
    const artifact = memory.artifacts[text(artifactId)];
    return artifact ? clone(artifact.generation) : null;
}

export function getStoryArtifactProvenance(memoryValue, artifactId) {
    const memory = migrateStoryMemory(memoryValue);
    const artifact = memory.artifacts[text(artifactId)];
    return artifact ? clone(artifact.provenance) : null;
}

export function buildReproductionInput(memoryValue, artifactId, { overrides = {} } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const artifact = memory.artifacts[text(artifactId)];
    if (!artifact) return null;
    const generation = clone(artifact.generation);
    return {
        artifactId: artifact.id,
        image: { artifactId: artifact.id, url: artifact.url, mimeType: artifact.mimeType || null },
        sourcePassage: generation.sourcePassage,
        effectivePrompt: generation.effectivePrompt,
        references: generation.references,
        model: overrides.model ?? generation.model,
        settings: { ...generation.settings, ...clone(overrides.settings || {}) },
        provenance: clone(artifact.provenance),
    };
}

function factStillValid(fact, at) {
    if (!isRecord(fact)) return false;
    if (fact.obsolete === true || fact.valid === false || fact.isValid === false) return false;
    if (['obsolete', 'expired', 'superseded', 'invalid'].includes(text(fact.status).toLocaleLowerCase())) return false;
    const expires = dateValue(fact.validUntil || fact.expiresAt);
    return expires === null || at === null || expires >= at;
}

export function planContinueFromScene(memoryValue, artifactId, { at = Date.now(), facts } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const artifact = memory.artifacts[text(artifactId)];
    if (!artifact) return null;
    const currentTime = dateValue(at);
    const availableFacts = Array.isArray(facts) ? facts : artifact.facts;
    return {
        action: 'continue-from-scene',
        sourceArtifactId: artifact.id,
        selectedImage: { artifactId: artifact.id, url: artifact.url, mimeType: artifact.mimeType || null },
        sourceMoment: clone(artifact.sourceMoment),
        facts: clone(availableFacts.filter((fact) => factStillValid(fact, currentTime))),
        generation: clone(artifact.generation),
    };
}

// Small compatibility aliases keep the domain vocabulary easy to discover for
// callers without introducing a second lifecycle or a second representation.
export const migrateGalleryToStoryMemory = migrateGalleryEntries;
export const listStoryTimeline = getStoryTimeline;
export const searchStoryMemory = searchStoryArtifacts;
export const continueFromScene = planContinueFromScene;

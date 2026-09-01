/**
 * Pure domain model for Priority 4 visual story memory.
 *
 * This module stores metadata and references to media. It deliberately has no
 * Gallery or Appearance lifecycle and never performs provider/network work.
 */

export const STORY_MEMORY_SCHEMA = 2;
export const STORY_PROVENANCE_SCHEMA = 1;
export const STORY_COLLECTION_KINDS = Object.freeze(['canon-look', 'location', 'outfit', 'moment']);

const BINARY_KEYS = new Set(['data', 'imagedata', 'mediadata', 'base64', 'blob']);
const ARTIFACT_KEYS = new Set([
    'id', 'artifactId', 'assetId', 'url', 'mediaUrl', 'mimeType', 'chatId', 'messageId', 'createdAt',
    'taskId', 'characterId', 'characterIds', 'character', 'characters', 'prompt', 'model', 'settings',
    'sourceMoment', 'sourcePassage', 'generation', 'references', 'facts', 'storyFacts', 'favorite',
    'provenance', 'legacyMetadata', 'metadata', 'aliases', 'title', 'sequence', 'order', 'isFavorite',
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
        if (BINARY_KEYS.has(key.toLocaleLowerCase())) {
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
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function dateBound(value, label, { inclusiveEnd = false } = {}) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = dateValue(value);
    if (parsed === null) throw new RangeError(`Invalid ${label} date bound.`);
    if (inclusiveEnd && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value.trim())) return parsed + 86400000 - 1;
    return parsed;
}

function sourceIdForGallery(item, chatId) {
    const source = isRecord(item) ? item : {};
    const explicit = source.id ?? source.artifactId ?? source.assetId;
    if (explicit !== undefined && text(explicit)) return text(explicit);
    if (source.url && source.messageId !== undefined) return `message:${source.messageId}:url:${source.url}`;
    if (source.url) return `url:${source.url}`;
    return `hash:${hash(stableString({ chatId: text(chatId), source }))}`;
}

function canonicalArtifactId(id, source) {
    const legacyId = text(id);
    if (!legacyId || !legacyId.startsWith('story:') || legacyId.startsWith('story:v1:')) return legacyId;
    const chatId = text(source?.chatId || source?.provenance?.chatId);
    const galleryId = text(source?.provenance?.galleryArtifactId);
    if (chatId && galleryId) return buildStoryArtifactId({ item: { id: galleryId, url: source?.url }, chatId });
    const prefix = chatId ? `story:${chatId}:` : '';
    if (prefix && legacyId.startsWith(prefix)) return buildStoryArtifactId({ item: { id: legacyId.slice(prefix.length), url: source?.url }, chatId });
    return legacyId;
}

function artifactAliases(artifact) {
    return Array.isArray(artifact?.aliases) ? artifact.aliases.map(text).filter(Boolean) : [];
}

/**
 * Resolve a caller-provided artifact ID to the canonical key in memory.
 *
 * Alias metadata is deliberately retained on the canonical artifact for
 * auditability. Ambiguous, missing, or cyclic alias graphs resolve to null so
 * callers cannot accidentally read or mutate the wrong artifact.
 */
export function resolveArtifactIdAlias(memoryValue, artifactId) {
    const memory = isRecord(memoryValue) ? memoryValue : {};
    const artifacts = isRecord(memory.artifacts) ? memory.artifacts : {};
    const requested = text(artifactId);
    if (!requested) return null;

    const aliasTargets = new Map();
    for (const [key, artifact] of Object.entries(artifacts)) {
        const canonical = text(key);
        if (!canonical) continue;
        for (const alias of artifactAliases(artifact)) {
            if (!alias || alias === canonical) continue;
            const targets = aliasTargets.get(alias) || new Set();
            targets.add(canonical);
            aliasTargets.set(alias, targets);
        }
    }

    const visited = new Set();
    let current = requested;
    while (current) {
        if (visited.has(current)) return null;
        visited.add(current);
        if (Object.prototype.hasOwnProperty.call(artifacts, current)) {
            const competingTargets = aliasTargets.get(current);
            if (competingTargets && (!competingTargets.has(current) || competingTargets.size !== 1)) return null;
            return current;
        }
        const targets = aliasTargets.get(current);
        if (!targets || targets.size !== 1) return null;
        current = [...targets][0];
    }
    return null;
}

export function buildStoryArtifactId({ item, chatId } = {}) {
    const scope = text(chatId || item?.chatId) || 'unknown-chat';
    const sourceId = sourceIdForGallery(item, scope);
    // Length prefixes keep chat and source fields unambiguous when either
    // contains separators (for example `a:b` + `c` vs `a` + `b:c`).
    return `story:v1:${scope.length}:${scope}:${sourceId.length}:${sourceId}`;
}

function metadataForGallery(item) {
    const source = isRecord(item) ? item : {};
    const omittedFields = [];
    const sourceMetadata = cleanBinary(source.sourceMetadata, ['sourceMetadata'], omittedFields);
    const unknown = {};
    for (const [key, value] of Object.entries(source)) {
        if (!ARTIFACT_KEYS.has(key) && key !== 'sourceMetadata' && !BINARY_KEYS.has(key.toLocaleLowerCase())) unknown[key] = cleanBinary(value, [key], omittedFields);
        if (BINARY_KEYS.has(key.toLocaleLowerCase())) omittedFields.push(key);
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

function normalizeGeneration(source, omittedFields = []) {
    const generation = isRecord(source.generation) ? source.generation : {};
    const legacy = isRecord(source.sourceMetadata) ? source.sourceMetadata : {};
    const references = generation.references ?? source.references ?? legacy.references ?? [];
    const settings = generation.settings ?? source.settings ?? legacy.settings ?? {};
    return {
        sourcePassage: generation.sourcePassage ?? source.sourcePassage ?? source.sourceMoment?.passage
            ?? legacy.sourcePassage ?? legacy.sourceMoment?.passage ?? null,
        effectivePrompt: generation.effectivePrompt ?? source.effectivePrompt ?? source.prompt ?? legacy.effectivePrompt ?? null,
        references: cleanBinary(Array.isArray(references) ? references : [], ['generation', 'references'], omittedFields),
        model: generation.model ?? source.model ?? legacy.model ?? null,
        settings: cleanBinary(isRecord(settings) ? settings : {}, ['generation', 'settings'], omittedFields),
    };
}

function normalizeArtifact(value, fallbackId, { migrated = false } = {}) {
    const source = isRecord(value) ? value : {};
    const omittedFields = [];
    const id = text(source.id || source.artifactId || fallbackId);
    const generation = normalizeGeneration(source, omittedFields);
    const sourceMomentValue = source.sourceMoment ?? source.sourceMetadata?.sourceMoment;
    const sourceMoment = sourceMomentValue === undefined
        ? (source.sourcePassage || source.sourceMetadata?.sourcePassage ? { passage: source.sourcePassage || source.sourceMetadata.sourcePassage } : null)
        : clone(sourceMomentValue);
    const rawFacts = source.facts ?? source.storyFacts ?? [];
    const aliases = [...new Set(artifactAliases(source).filter((alias) => alias !== id))];
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
        ...(aliases.length ? { aliases } : {}),
        provenance: cleanBinary(source.provenance || {
            schema: STORY_PROVENANCE_SCHEMA,
            source: migrated ? 'gallery-migration' : 'story-memory',
            ...(source.chatId ? { chatId: text(source.chatId) } : {}),
            ...(source.messageId !== undefined ? { messageId: source.messageId } : {}),
        }, ['provenance'], omittedFields),
    };
    delete artifact.artifactId;
    delete artifact.assetId;
    delete artifact.mediaUrl;
    delete artifact.data;
    delete artifact.imageData;
    delete artifact.mediaData;
    delete artifact.base64;
    delete artifact.blob;
    if (!artifact.legacyMetadata && migrated) artifact.legacyMetadata = metadataForGallery(source);
    if (artifact.legacyMetadata) artifact.legacyMetadata = cleanBinary(artifact.legacyMetadata, ['legacyMetadata'], omittedFields);
    if (artifact.metadata) artifact.metadata = cleanBinary(artifact.metadata, ['metadata'], omittedFields);
    if (omittedFields.length) {
        artifact.legacyMetadata = {
            ...(artifact.legacyMetadata || {}),
            omittedFields: [...new Set([...(artifact.legacyMetadata?.omittedFields || []), ...omittedFields])],
        };
    }
    if (!artifact.legacyMetadata) delete artifact.legacyMetadata;
    return cleanBinary(artifact, [], omittedFields);
}

export function migrateGalleryEntries(gallery = [], { chatId } = {}) {
    const entries = Array.isArray(gallery) ? gallery : [];
    const seen = new Map();
    return entries.map((item) => {
        const itemChatId = text(item?.chatId || chatId) || null;
        const id = buildStoryArtifactId({ item, chatId: itemChatId });
        const sourceId = sourceIdForGallery(item, itemChatId);
        const source = isRecord(item) ? item : {};
        const candidate = normalizeArtifact({
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
        const previous = seen.get(id);
        if (previous) {
            if (previous.url !== candidate.url || stableString(previous.provenance) !== stableString(candidate.provenance)) {
                throw new TypeError(`Conflicting duplicate story artifact ID: ${id}`);
            }
            return null;
        }
        seen.set(id, candidate);
        return candidate;
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

function mergeArtifactRecords(existing, incoming, id) {
    const oldGeneration = existing.generation || {};
    const newGeneration = incoming.generation || {};
    return normalizeArtifact({
        ...incoming,
        ...existing,
        id,
        url: existing.url || incoming.url || null,
        prompt: existing.prompt || incoming.prompt || null,
        sourceMoment: existing.sourceMoment || incoming.sourceMoment || null,
        generation: {
            ...newGeneration,
            ...oldGeneration,
            sourcePassage: oldGeneration.sourcePassage || newGeneration.sourcePassage || null,
            effectivePrompt: oldGeneration.effectivePrompt || newGeneration.effectivePrompt || null,
            references: oldGeneration.references?.length ? oldGeneration.references : (newGeneration.references || []),
            model: oldGeneration.model || newGeneration.model || null,
            settings: Object.keys(oldGeneration.settings || {}).length ? oldGeneration.settings : (newGeneration.settings || {}),
        },
        favorite: existing.favorite === true || incoming.favorite === true,
        aliases: [...new Set([...artifactAliases(existing), ...artifactAliases(incoming)].map(text).filter(Boolean))],
        collections: [...new Set([...(existing.collections || []), ...(incoming.collections || [])].map(text).filter(Boolean))],
        provenance: existing.provenance || incoming.provenance,
    }, id);
}

function samePhysicalArtifact(left, right) {
    if (left.url && right.url) return left.url === right.url;
    return Boolean(left.provenance?.galleryArtifactId && right.provenance?.galleryArtifactId
        && left.provenance.galleryArtifactId === right.provenance.galleryArtifactId);
}

export function migrateStoryMemory(value = {}, { gallery = [], chatId } = {}) {
    const source = isRecord(value) ? value : {};
    const rawArtifacts = isRecord(source.artifacts) ? Object.entries(source.artifacts) : [];
    const artifacts = {};
    for (const [id, artifact] of rawArtifacts) {
        const legacyId = text(artifact?.id || id);
        const normalizedId = canonicalArtifactId(legacyId, artifact);
        const normalized = normalizeArtifact({
            ...artifact,
            id: normalizedId,
            aliases: [...new Set([
                ...artifactAliases(artifact),
                ...(legacyId !== normalizedId ? [legacyId] : []),
            ].map(text).filter(Boolean))],
        }, id);
        const previous = artifacts[normalizedId];
        if (previous) {
            if (!samePhysicalArtifact(previous, normalized)) {
                throw new TypeError(`Conflicting duplicate story artifact ID: ${normalizedId}`);
            }
            artifacts[normalizedId] = mergeArtifactRecords(previous, normalized, normalizedId);
            continue;
        }
        artifacts[normalizedId] = normalized;
    }
    for (const artifact of migrateGalleryEntries(gallery, { chatId })) {
        const previous = artifacts[artifact.id];
        if (previous) {
            if (!samePhysicalArtifact(previous, artifact)) {
                throw new TypeError(`Conflicting duplicate story artifact ID: ${artifact.id}`);
            }
            artifacts[artifact.id] = mergeArtifactRecords(previous, artifact, artifact.id);
        } else artifacts[artifact.id] = artifact;
    }
    const rawCollections = isRecord(source.collections) ? Object.entries(source.collections) : [];
    const danglingCollectionMembers = [];
    const artifactMemory = { artifacts };
    const collections = Object.fromEntries(rawCollections.map(([id, collection]) => {
        const normalized = normalizeCollection({ ...collection, id: collection?.id || id }, id);
        normalized.memberIds = normalized.memberIds.map((memberId) => resolveArtifactIdAlias(artifactMemory, memberId) || memberId);
        normalized.memberIds = [...new Set(normalized.memberIds)];
        normalized.memberIds = normalized.memberIds.filter((memberId) => {
            if (artifacts[memberId]) return true;
            danglingCollectionMembers.push({ collectionId: normalized.id, artifactId: memberId });
            return false;
        });
        return [normalized.id, normalized];
    }));
    return {
        schema: STORY_MEMORY_SCHEMA,
        artifacts,
        collections,
        migrationReport: { danglingCollectionMembers },
    };
}

export function createStoryMemory(value = {}, options = {}) {
    return migrateStoryMemory(value, options);
}

export function addStoryArtifact(memoryValue, artifactValue) {
    const memory = migrateStoryMemory(memoryValue);
    const source = isRecord(artifactValue) ? artifactValue : {};
    const requestedId = text(source.id || source.artifactId);
    let id = requestedId ? (resolveArtifactIdAlias(memory, requestedId) || requestedId)
        : buildStoryArtifactId({ item: source, chatId: source.chatId });
    if (memory.artifacts[id] && text(memory.artifacts[id].chatId) !== text(source.chatId) && source.chatId) {
        id = buildStoryArtifactId({ item: source, chatId: source.chatId });
    }
    const existing = memory.artifacts[id];
    const incomingUrl = text(source.url || source.mediaUrl);
    if (existing && incomingUrl && existing.url && incomingUrl !== existing.url) {
        throw new TypeError(`Conflicting duplicate story artifact ID: ${id}`);
    }
    if (existing && source.provenance && stableString(existing.provenance) !== stableString(source.provenance)) {
        throw new TypeError(`Conflicting duplicate story artifact provenance: ${id}`);
    }
    const merged = existing ? {
        ...existing,
        ...clone(source),
        id,
        aliases: [...new Set([
            ...artifactAliases(existing),
            ...artifactAliases(source),
            ...(requestedId && requestedId !== id ? [requestedId] : []),
        ].map(text).filter(Boolean))],
        favorite: source.favorite === undefined && source.isFavorite === undefined ? existing.favorite : source.favorite,
        provenance: source.provenance === undefined ? existing.provenance : source.provenance,
        ...(Array.isArray(existing.collections) || Array.isArray(source.collections) ? {
            collections: [...new Set([...(existing.collections || []), ...(source.collections || [])].map(text).filter(Boolean))],
        } : {}),
    } : { ...source, id };
    memory.artifacts[id] = normalizeArtifact(merged, id);
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
            const leftOrder = Number.isFinite(Number(left.sequence)) ? Number(left.sequence)
                : (Number.isFinite(Number(left.order)) ? Number(left.order) : Number.POSITIVE_INFINITY);
            const rightOrder = Number.isFinite(Number(right.sequence)) ? Number(right.sequence)
                : (Number.isFinite(Number(right.order)) ? Number(right.order) : Number.POSITIVE_INFINITY);
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            const leftDate = dateValue(left.createdAt) ?? Number.POSITIVE_INFINITY;
            const rightDate = dateValue(right.createdAt) ?? Number.POSITIVE_INFINITY;
            if (leftDate !== rightDate) return leftDate - rightDate;
            return left.id.localeCompare(right.id);
        })
        .map(clone);
}

export function toggleStoryFavorite(memoryValue, artifactId, favorite) {
    const memory = migrateStoryMemory(memoryValue);
    const id = resolveArtifactIdAlias(memory, artifactId);
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
    const fromInput = filters.from ?? filters.startDate ?? filters.dateFrom ?? filters.fromDate ?? filters.start;
    const toInput = filters.to ?? filters.endDate ?? filters.dateTo ?? filters.toDate ?? filters.end;
    const from = dateBound(fromInput, 'from');
    const to = dateBound(toInput, 'to', { inclusiveEnd: true });
    if (from !== null && to !== null && from > to) throw new RangeError('The from date must be before the to date.');
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
        if (to !== null && (created === null || created > to)) return false;
        return true;
    }).sort((left, right) => (dateValue(left.createdAt) ?? 0) - (dateValue(right.createdAt) ?? 0)).map(clone);
}

export function addStoryCollectionMember(memoryValue, { collectionId, kind = 'moment', label, artifactId } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const id = text(collectionId);
    const artifact = resolveArtifactIdAlias(memory, artifactId);
    if (!id || !artifact) return memory;
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
    const artifact = resolveArtifactIdAlias(memory, artifactId);
    if (collection && artifact) collection.memberIds = collection.memberIds.filter((id) => id !== artifact);
    return memory;
}

export function listStoryCollectionMembers(memoryValue, collectionId) {
    const memory = migrateStoryMemory(memoryValue);
    const collection = memory.collections[text(collectionId)];
    if (!collection) return [];
    return collection.memberIds.map((id) => resolveArtifactIdAlias(memory, id))
        .filter(Boolean).map((id) => memory.artifacts[id]).filter(Boolean).map(clone);
}

export function getGenerationDetails(memoryValue, artifactId) {
    const memory = migrateStoryMemory(memoryValue);
    const id = resolveArtifactIdAlias(memory, artifactId);
    const artifact = id ? memory.artifacts[id] : null;
    return artifact ? clone(artifact.generation) : null;
}

export function getStoryArtifactProvenance(memoryValue, artifactId) {
    const memory = migrateStoryMemory(memoryValue);
    const id = resolveArtifactIdAlias(memory, artifactId);
    const artifact = id ? memory.artifacts[id] : null;
    return artifact ? clone(artifact.provenance) : null;
}

export function buildReproductionInput(memoryValue, artifactId, { overrides = {}, at } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const id = resolveArtifactIdAlias(memory, artifactId);
    const artifact = id ? memory.artifacts[id] : null;
    if (!artifact) return null;
    const generation = clone(artifact.generation);
    const acceptedFacts = artifact.facts.filter((fact) => factStillValid(fact, dateValue(at ?? artifact.createdAt), sceneScopeFor(artifact), undefined, artifact.id));
    return {
        artifactId: artifact.id,
        image: { artifactId: artifact.id, url: artifact.url, mimeType: artifact.mimeType || null },
        sourceMoment: clone(artifact.sourceMoment),
        chatId: artifact.chatId,
        messageId: artifact.messageId,
        taskId: artifact.taskId,
        sourcePassage: generation.sourcePassage,
        effectivePrompt: generation.effectivePrompt,
        references: generation.references,
        facts: clone(acceptedFacts),
        model: overrides.model ?? generation.model,
        settings: { ...generation.settings, ...clone(overrides.settings || {}) },
        provenance: clone(artifact.provenance),
    };
}

function sceneScopeFor(artifact, requestedScope) {
    return requestedScope ?? artifact.sourceMoment?.scope ?? artifact.sourceMoment?.sceneScope
        ?? artifact.provenance?.sceneScope ?? null;
}

function factStillValid(fact, at, sceneScope, reconciliationAuthority, selectedArtifactId) {
    if (!isRecord(fact)) return false;
    if (fact.obsolete === true || fact.valid === false || fact.isValid === false) return false;
    if (['obsolete', 'expired', 'superseded', 'invalid'].includes(text(fact.status).toLocaleLowerCase())) return false;
    if (fact.supersededBy) return false;
    const reconciliation = isRecord(fact.reconciliation) ? fact.reconciliation : {};
    const version = Number(fact.version);
    const currentVersion = Number(fact.currentVersion ?? fact.latestVersion ?? reconciliation.currentVersion ?? reconciliation.latestVersion);
    if (Number.isFinite(version) && Number.isFinite(currentVersion) && version < currentVersion) return false;
    if (reconciliation.isAuthoritative === false || reconciliation.accepted === false) return false;
    if (['obsolete', 'expired', 'superseded', 'invalid', 'rejected', 'untrusted'].includes(text(reconciliation.status).toLocaleLowerCase())) return false;
    const factAuthority = fact.reconciliationAuthority ?? fact.authority ?? reconciliation.authority;
    if (factAuthority === false || ['obsolete', 'expired', 'superseded', 'invalid', 'untrusted'].includes(text(factAuthority).toLocaleLowerCase())) return false;
    if (reconciliationAuthority !== undefined && factAuthority !== undefined && text(factAuthority) !== text(reconciliationAuthority)) return false;
    const factScope = fact.sceneScope ?? fact.scope ?? fact.sceneId;
    if (factScope !== undefined && factScope !== null && text(factScope) !== text(sceneScope)) return false;
    if (fact.sourceArtifactId !== undefined && text(fact.sourceArtifactId) !== text(selectedArtifactId || '')) return false;
    const validFrom = dateValue(fact.validFrom);
    if (validFrom !== null && at !== null && at < validFrom) return false;
    const expires = dateValue(fact.validUntil || fact.expiresAt);
    return expires === null || at === null || expires >= at;
}

export function planContinueFromScene(memoryValue, artifactId, { at = Date.now(), facts, sceneScope, reconciliationAuthority } = {}) {
    const memory = migrateStoryMemory(memoryValue);
    const id = resolveArtifactIdAlias(memory, artifactId);
    const artifact = id ? memory.artifacts[id] : null;
    if (!artifact) return null;
    const currentTime = dateValue(at);
    const availableFacts = Array.isArray(facts) ? facts : artifact.facts;
    const selectedScope = sceneScopeFor(artifact, sceneScope);
    return {
        action: 'continue-from-scene',
        sourceArtifactId: artifact.id,
        selectedImage: { artifactId: artifact.id, url: artifact.url, mimeType: artifact.mimeType || null },
        chatId: artifact.chatId,
        messageId: artifact.messageId,
        taskId: artifact.taskId,
        sourceMoment: clone(artifact.sourceMoment),
        facts: clone(availableFacts.filter((fact) => factStillValid(fact, currentTime, selectedScope, reconciliationAuthority, artifact.id))),
        generation: clone(artifact.generation),
    };
}

// Small compatibility aliases keep the domain vocabulary easy to discover for
// callers without introducing a second lifecycle or a second representation.
export const migrateGalleryToStoryMemory = migrateGalleryEntries;
export const listStoryTimeline = getStoryTimeline;
export const searchStoryMemory = searchStoryArtifacts;
export const continueFromScene = planContinueFromScene;

import { isSafeCustomCredentialRef } from './contracts.js';

export const CUSTOM_CONNECTION_SCHEMA = 1;
export const CUSTOM_CONNECTION_PROTOCOL = 'openai-images';
export const CUSTOM_CONNECTION_PROTOCOLS = Object.freeze(['openai-images', 'gemini-compatible']);
export const CUSTOM_CONNECTION_LABEL_MAX = 80;
export const CUSTOM_CONNECTION_DEFAULTS = Object.freeze({
    modelsPath: '/v1/models',
    generationPath: '/v1/images/generations',
});

const CONNECTION_ID = /^connection:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const ALLOWED_FIELDS = new Set([
    'schema', 'id', 'label', 'protocol', 'baseUrl', 'modelsPath',
    'generationPath', 'credentialRef', 'enabled',
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const MAX_CUSTOM_PATH_LENGTH = 2048;
const MAX_PERCENT_DECODE_PASSES = 32;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function validObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOrigin(raw) {
    if (typeof raw !== 'string' || !raw || CONTROL_CHARACTERS.test(raw) || raw.trim() !== raw || raw.startsWith('//')) return null;
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' || !url.hostname) return null;
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    return { value: url.origin, localInsecure: url.protocol === 'http:' };
}

function repeatedlyDecode(value) {
    let decoded = value;
    for (let index = 0; index < MAX_PERCENT_DECODE_PASSES; index += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) return decoded;
        decoded = next;
    }
    return null;
}

function normalizePath(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > MAX_CUSTOM_PATH_LENGTH || raw.trim() !== raw || CONTROL_CHARACTERS.test(raw)) return null;
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('?') || raw.includes('#') || raw.includes('@')) return null;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(raw)) return null;
    let decoded;
    try { decoded = repeatedlyDecode(raw); } catch { return null; }
    if (decoded === null || CONTROL_CHARACTERS.test(decoded) || decoded.includes('\\') || decoded.includes('?') || decoded.includes('#') || decoded.includes('@') || decoded.startsWith('//')) return null;
    const segments = decoded.split('/');
    if (segments.some((segment) => segment === '.' || segment === '..')) return null;
    return raw;
}

function error(field, code, message) {
    return { field, code, message };
}

export function validateCustomConnection(input = {}) {
    const source = validObject(input);
    const errors = [];
    const unknown = Object.keys(source).filter((key) => !ALLOWED_FIELDS.has(key));
    if (unknown.length) errors.push(error(unknown[0], 'unknown-field', 'Custom connections do not accept arbitrary fields.'));
    if (source.schema !== CUSTOM_CONNECTION_SCHEMA) errors.push(error('schema', 'invalid-schema', 'Connection schema must be 1.'));
    const id = typeof source.id === 'string' ? source.id.trim().toLowerCase() : '';
    if (!CONNECTION_ID.test(id)) errors.push(error('id', 'invalid-id', 'Connection id must contain a UUID.'));
    const label = typeof source.label === 'string' ? source.label.trim() : '';
    if (!label || label.length > CUSTOM_CONNECTION_LABEL_MAX || CONTROL_CHARACTERS.test(label)) errors.push(error('label', 'invalid-label', `Connection label must be 1-${CUSTOM_CONNECTION_LABEL_MAX} characters.`));
    const protocol = CUSTOM_CONNECTION_PROTOCOLS.includes(source.protocol) ? source.protocol : '';
    if (!protocol) errors.push(error('protocol', 'invalid-protocol', 'Choose OpenAI Images or Gemini-compatible protocol.'));
    const origin = normalizeOrigin(source.baseUrl);
    if (!origin) errors.push(error('baseUrl', 'invalid-origin', 'Use an HTTPS origin, or HTTP on loopback only.'));
    const modelsPath = normalizePath(source.modelsPath);
    if (!modelsPath) errors.push(error('modelsPath', 'invalid-path', 'Models path must be a safe relative-absolute path.'));
    const generationPath = protocol === 'openai-images' ? normalizePath(source.generationPath) : undefined;
    if (protocol === 'openai-images' && !generationPath) errors.push(error('generationPath', 'invalid-path', 'Generation path must be a safe relative-absolute path.'));
    if (protocol === 'gemini-compatible' && Object.hasOwn(source, 'generationPath')) errors.push(error('generationPath', 'unknown-field', 'Gemini-compatible routes do not accept a generation path.'));
    const credentialRef = source.credentialRef ?? null;
    if (!isSafeCustomCredentialRef(credentialRef, id)) errors.push(error('credentialRef', 'invalid-credential-ref', 'Credential reference must match the connection UUID.'));
    if (typeof source.enabled !== 'boolean') errors.push(error('enabled', 'invalid-enabled', 'Enabled must be a boolean.'));
    if (errors.length) return deepFreeze({ valid: false, errors });
    return deepFreeze({
        valid: true,
        localInsecure: origin.localInsecure,
        errors: [],
        connection: {
            schema: CUSTOM_CONNECTION_SCHEMA,
            id,
            label,
            protocol,
            baseUrl: origin.value,
            modelsPath,
            ...(protocol === 'openai-images' ? { generationPath } : {}),
            credentialRef,
            enabled: source.enabled,
        },
    });
}

function fnv1a64(value) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(value)) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
}

export function connectionRevision(connection) {
    const source = validObject(connection);
    const route = JSON.stringify([
        source.id || '',
        source.protocol || '',
        source.baseUrl || '',
        source.modelsPath || '',
        source.generationPath || '',
        source.credentialRef === null ? 'none' : source.credentialRef || '',
    ]);
    return `connection-revision:${fnv1a64(route)}`;
}

/** Accept a custom catalog completion only for the exact route revision that started it. */
export function isCurrentCustomDiscoveryCompletion({
    providerId,
    capturedRevision,
    result,
    currentProviderId,
    currentConnection,
} = {}) {
    const validation = validateCustomConnection(currentConnection);
    if (!validation.valid || validation.connection.id !== providerId) return false;
    if (typeof currentProviderId === 'string' && currentProviderId !== providerId) return false;
    if (!capturedRevision || connectionRevision(validation.connection) !== capturedRevision) return false;
    return result?.evidence?.connectionId === providerId
        && result.evidence.revision === capturedRevision;
}

function joinRoute(baseUrl, path) {
    return `${String(baseUrl).replace(/\/$/u, '')}${path}`;
}

export function safeConnectionProjection(connection) {
    const source = validObject(connection);
    const validation = validateCustomConnection(Object.fromEntries(
        [...ALLOWED_FIELDS].filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]),
    ));
    if (!validation.valid) return deepFreeze({ valid: false, errors: validation.errors });
    const record = validation.connection;
    return deepFreeze({
        schema: record.schema,
        id: record.id,
        label: record.label,
        protocol: record.protocol,
        baseUrl: record.baseUrl,
        modelsPath: record.modelsPath,
        ...(record.protocol === 'openai-images' ? { generationPath: record.generationPath } : {}),
        enabled: record.enabled,
        localInsecure: validation.localInsecure,
        revision: connectionRevision(record),
        credential: { preset: record.credentialRef ? (record.protocol === 'gemini-compatible' ? 'gemini-api-key' : 'bearer') : 'none', masked: Boolean(record.credentialRef) },
        routePreview: {
            catalog: { method: 'GET', url: joinRoute(record.baseUrl, record.modelsPath) },
            generation: record.protocol === 'gemini-compatible'
                ? { method: 'POST', url: '/api/backends/chat-completions/generate', transport: 'SillyTavern Gemini proxy', upstreamProxyRoot: record.baseUrl }
                : { method: 'POST', url: joinRoute(record.baseUrl, record.generationPath) },
        },
    });
}

function safeModelRecords(value, connection) {
    const gemini = connection.protocol === 'gemini-compatible';
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map((entry) => {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        if (!id || id.length > 240 || seen.has(id) || CONTROL_CHARACTERS.test(id)) return null;
        seen.add(id);
        return {
            id,
            label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 240) : id,
            providerId: connection.id,
            connectionId: connection.id,
            transportId: gemini ? 'sillytavern-gemini-proxy' : 'openai-images',
            endpointClass: gemini ? 'custom-gemini-proxy' : 'custom-openai-images',
            source: { kind: entry?.source?.kind === 'manual' || entry?.source === 'manual' ? 'manual' : 'fetched' },
            capabilities: {
                imageGeneration: { state: 'unknown', source: 'heuristic', confidence: 'low' },
            },
            routeEvidence: { state: 'unverified' },
        };
    }).filter(Boolean);
}

function safeTimestamp(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : '';
}

export function nextCustomDiscoveryEvidence({ connection, currentEvidence, observedAt } = {}) {
    const validation = validateCustomConnection(connection);
    if (!validation.valid) return undefined;
    const revision = connectionRevision(validation.connection);
    const currentObservedAt = safeTimestamp(currentEvidence?.observedAt);
    if (currentEvidence?.state === 'verified' && currentEvidence?.revision === revision && currentObservedAt) {
        return deepFreeze({ state: 'verified', revision, observedAt: currentObservedAt });
    }
    const catalogObservedAt = safeTimestamp(observedAt);
    if (!catalogObservedAt) return undefined;
    return deepFreeze({ state: 'configured', revision, observedAt: catalogObservedAt });
}

export function projectCurrentCustomDiscoveryState(connection, storedState) {
    const validation = validateCustomConnection(connection);
    const state = validObject(storedState);
    const evidence = validObject(state.evidence);
    if (!validation.valid || evidence.connectionId !== validation.connection.id
        || evidence.revision !== connectionRevision(validation.connection)) return {};
    const count = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
    return {
        evidence: {
            ...(typeof evidence.kind === 'string' ? { kind: evidence.kind } : {}),
            ...(typeof evidence.source === 'string' ? { source: evidence.source } : {}),
            ...(safeTimestamp(evidence.observedAt) ? { observedAt: safeTimestamp(evidence.observedAt) } : {}),
            retryCount: count(evidence.retryCount),
            returnedCount: count(evidence.returnedCount),
            acceptedCount: count(evidence.acceptedCount),
            unresolvedCount: count(evidence.unresolvedCount),
            rejectedCount: count(evidence.rejectedCount),
            connectionId: validation.connection.id,
            revision: evidence.revision,
        },
        ...(typeof state.warning?.code === 'string' ? { warning: { code: state.warning.code } } : {}),
    };
}

export function migrateCustomConnections(value = {}) {
    const source = validObject(value);
    const result = { schema: CUSTOM_CONNECTION_SCHEMA, connections: {}, models: {}, evidence: {}, modelEvidence: {}, confirmations: {} };
    const connections = validObject(source.connections);
    for (const [key, candidate] of Object.entries(connections)) {
        const validation = validateCustomConnection({ ...validObject(candidate), id: key });
        if (!validation.valid) continue;
        const connection = validation.connection;
        const revision = connectionRevision(connection);
        result.connections[connection.id] = connection;
        result.models[connection.id] = safeModelRecords(validObject(source.models)[connection.id], connection);
        const savedModelEvidence = validObject(validObject(source.modelEvidence)[connection.id]);
        const acceptedModelEvidence = result.models[connection.id].flatMap((model) => {
            if (!Object.hasOwn(savedModelEvidence, model.id)) return [];
            const candidate = validObject(savedModelEvidence[model.id]);
            const modelObservedAt = safeTimestamp(candidate.observedAt);
            if (candidate.state !== 'supported' || candidate.revision !== revision || !modelObservedAt) return [];
            return [[model.id, { state: 'supported', revision, observedAt: modelObservedAt }]];
        });
        if (acceptedModelEvidence.length) result.modelEvidence[connection.id] = Object.fromEntries(acceptedModelEvidence);
        const evidence = validObject(source.evidence)[connection.id];
        const observedAt = safeTimestamp(evidence?.observedAt);
        if (['configured', 'verified'].includes(evidence?.state) && evidence?.revision === revision && observedAt) {
            result.evidence[connection.id] = { state: evidence.state, revision, observedAt };
            const routeEvidence = {
                state: evidence.state,
                source: evidence.state === 'verified' ? 'sanitized-probe' : 'user-configured-protocol',
                observedAt,
                protocol: connection.protocol,
                requestShapeRevision: connection.protocol === 'gemini-compatible' ? 'st-gemini-proxy-v1' : 'openai-images-v1',
                revision,
            };
            result.models[connection.id] = result.models[connection.id].map((model) => {
                const modelEvidence = result.modelEvidence[connection.id];
                const hasModelEvidence = modelEvidence && Object.hasOwn(modelEvidence, model.id);
                return {
                    ...model,
                    endpoint: connection.protocol === 'gemini-compatible' ? connection.baseUrl : joinRoute(connection.baseUrl, connection.generationPath),
                    routeEvidence,
                    ...(hasModelEvidence ? { capabilities: {
                        imageGeneration: {
                            state: 'supported', source: 'live-sanitized', confidence: 'high',
                            observedAt: modelEvidence[model.id].observedAt,
                        },
                    } } : {}),
                };
            });
        }
        const confirmation = validObject(source.confirmations)[connection.id];
        const confirmedAt = safeTimestamp(confirmation?.confirmedAt);
        if (confirmation?.revision === revision && confirmedAt) result.confirmations[connection.id] = { revision, confirmedAt };
    }
    return deepFreeze(result);
}

export function upsertCustomConnection(store, input) {
    const validation = validateCustomConnection(input);
    if (!validation.valid) {
        const failure = new TypeError(validation.errors[0]?.message || 'Invalid custom connection.');
        failure.validationErrors = validation.errors;
        throw failure;
    }
    const migrated = migrateCustomConnections(store);
    const connection = validation.connection;
    const next = migrateCustomConnections({
        ...migrated,
        connections: { ...migrated.connections, [connection.id]: connection },
    });
    return next;
}

export function removeCustomConnection(store, connectionId) {
    const migrated = migrateCustomConnections(store);
    const connection = migrated.connections[connectionId];
    if (!connection) return deepFreeze({ store: migrated, removed: undefined });
    const connections = { ...migrated.connections };
    const models = { ...migrated.models };
    const evidence = { ...migrated.evidence };
    const modelEvidence = { ...migrated.modelEvidence };
    const confirmations = { ...migrated.confirmations };
    delete connections[connectionId];
    delete models[connectionId];
    delete evidence[connectionId];
    delete modelEvidence[connectionId];
    delete confirmations[connectionId];
    return deepFreeze({
        store: migrateCustomConnections({ ...migrated, connections, models, evidence, modelEvidence, confirmations }),
        removed: { id: connection.id, label: connection.label, protocol: connection.protocol },
    });
}

export function removeCustomConnectionFromSettings(settings, connectionId, { fallbackProvider = 'makersuite' } = {}) {
    const source = validObject(settings);
    const store = migrateCustomConnections(source.custom_connections);
    const connection = store.connections[connectionId];
    if (!connection) return { settings: { ...source, custom_connections: store }, removed: undefined };
    const removal = removeCustomConnection(store, connectionId);
    const customKeys = { ...validObject(source.custom_connection_keys) };
    if (connection.credentialRef) delete customKeys[connection.credentialRef];
    const discovery = { ...validObject(source.model_discovery) };
    delete discovery[connectionId];
    const preflight = Object.fromEntries(Object.entries(validObject(source.experimental_model_preflight)).filter(([key]) => {
        try {
            const parsed = JSON.parse(key);
            return !(Array.isArray(parsed) && parsed[0] === connectionId);
        } catch { return true; }
    }));
    const wasActive = source.provider === connectionId;
    return {
        settings: {
            ...source,
            custom_connections: removal.store,
            custom_connection_keys: customKeys,
            model_discovery: discovery,
            experimental_model_preflight: preflight,
            custom_connection_editor_id: source.custom_connection_editor_id === connectionId ? '' : source.custom_connection_editor_id,
            provider: wasActive ? fallbackProvider : source.provider,
            model: wasActive ? '' : source.model,
        },
        removed: removal.removed,
    };
}

export function selectCustomConnection(store, requestedId = '') {
    const migrated = migrateCustomConnections(store);
    if (requestedId) return migrated.connections[requestedId];
    return Object.values(migrated.connections)[0];
}

export function createCustomConnectionId(randomUuid = () => crypto.randomUUID()) {
    const uuid = String(randomUuid()).toLowerCase();
    const id = `connection:${uuid}`;
    if (!CONNECTION_ID.test(id)) throw new TypeError('A valid UUID is required.');
    return id;
}

export function customCredentialRef(connectionId) {
    const uuid = CONNECTION_ID.exec(String(connectionId).toLowerCase())?.[1];
    if (!uuid) throw new TypeError('A valid connection id is required.');
    return `custom:${uuid}`;
}

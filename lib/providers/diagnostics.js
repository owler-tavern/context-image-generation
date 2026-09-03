import { inspectGenerationPlan } from './preflight.js';

const MAX_RUNS = 32;
const MAX_PROVIDERS = 64;
const TELEMETRY_STAGES = new Set(['coordinate', 'reference', 'avatar', 'host-post', 'decode', 'save', 'attach', 'chat-save', 'gallery-save']);
const TELEMETRY_STATUSES = new Set(['started', 'completed', 'failed', 'cancelled', 'response']);

function string(value, max = 160) {
    return typeof value === 'string' && value ? value.slice(0, max) : undefined;
}

function safeTelemetry(events) {
    if (!Array.isArray(events)) return [];
    return events.slice(-128).flatMap((event) => {
        if (!event || !TELEMETRY_STAGES.has(event.stage) || !TELEMETRY_STATUSES.has(event.status)) return [];
        const runId = string(event.runId);
        const timestamp = string(event.timestamp, 40);
        const durationMs = Number.isFinite(event.durationMs) && event.durationMs >= 0 ? Math.min(event.durationMs, 15 * 60 * 1000) : 0;
        if (!runId || !timestamp) return [];
        return [{ runId, stage: event.stage, timestamp, durationMs, status: event.status }];
    });
}

function safeRun(run) {
    if (!run || typeof run !== 'object') return undefined;
    const plan = run.plan && typeof run.plan === 'object' ? inspectGenerationPlan(run.plan) : undefined;
    const result = {
        ...(string(run.runId) ? { runId: string(run.runId) } : {}),
        ...(string(run.state, 32) ? { state: string(run.state, 32) } : {}),
        ...(string(run.createdAt, 40) ? { createdAt: string(run.createdAt, 40) } : {}),
        ...(string(run.completedAt, 40) ? { completedAt: string(run.completedAt, 40) } : {}),
        ...(safeTelemetry(run.telemetry).length ? { telemetry: safeTelemetry(run.telemetry) } : {}),
        ...(plan ? { plan } : {}),
    };
    if (plan?.route?.providerId) result.providerId = plan.route.providerId;
    if (plan?.route?.modelId) result.modelId = plan.route.modelId;
    if (run.terminal?.error && typeof run.terminal.error === 'object') {
        const error = run.terminal.error;
        result.error = Object.fromEntries(['category', 'code', 'status', 'providerId', 'modelId', 'requestId']
            .filter((field) => typeof error[field] === 'string' || Number.isFinite(error[field]))
            .map((field) => [field, typeof error[field] === 'string' ? error[field].slice(0, 160) : error[field]]));
    }
    return result;
}

function safeDiscovery(states) {
    if (!states || typeof states !== 'object' || Array.isArray(states)) return {};
    return Object.fromEntries(Object.entries(states).slice(0, MAX_PROVIDERS).map(([providerId, state]) => {
        const evidence = state?.evidence;
        return [providerId.slice(0, 80), {
            ...(evidence && typeof evidence === 'object' ? {
                evidence: Object.fromEntries(['kind', 'source', 'observedAt', 'retryCount']
                    .filter((field) => typeof evidence[field] === 'string' || Number.isFinite(evidence[field]))
                    .map((field) => [field, typeof evidence[field] === 'string' ? evidence[field].slice(0, 160) : evidence[field]])),
            } : {}),
            ...(typeof state?.warning?.code === 'string' ? { warning: { code: state.warning.code.slice(0, 80) } } : {}),
        }];
    }));
}

export function createDiagnosticsExport({ runs = [], discovery = {}, generatedAt = new Date().toISOString() } = {}) {
    return {
        schema: 1,
        generatedAt: string(generatedAt, 40) || new Date().toISOString(),
        runs: (Array.isArray(runs) ? runs : []).map(safeRun).filter(Boolean).slice(-MAX_RUNS),
        discovery: safeDiscovery(discovery),
    };
}

export function serializeDiagnosticsExport(diagnostics) {
    return JSON.stringify(createDiagnosticsExport(diagnostics || {}), null, 2);
}

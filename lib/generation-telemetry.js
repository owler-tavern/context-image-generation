const STAGES = new Set(['coordinate', 'reference', 'avatar', 'host-post', 'decode', 'save', 'attach', 'chat-save', 'gallery-save']);
const STATUSES = new Set(['started', 'completed', 'failed', 'cancelled', 'timed_out', 'response']);

function safeRunId(value) {
    return String(value || '').slice(0, 160);
}

/**
 * A deliberately tiny, allowlisted lifecycle trail. It accepts no payload so
 * prompts, credentials, URLs, responses, and image data cannot enter it.
 */
export function createGenerationTelemetry(runId, { now = () => new Date() } = {}) {
    const events = [];
    const startedAt = new Map();

    function record(stage, status) {
        if (!STAGES.has(stage) || !STATUSES.has(status)) return;
        const at = now();
        const timestamp = at instanceof Date ? at.toISOString() : new Date(at).toISOString();
        const epoch = at instanceof Date ? at.getTime() : new Date(at).getTime();
        const key = `${stage}`;
        if (status === 'started') startedAt.set(key, epoch);
        const durationMs = Number.isFinite(startedAt.get(key)) ? Math.max(0, epoch - startedAt.get(key)) : 0;
        events.push(Object.freeze({ runId: safeRunId(runId), stage, timestamp, durationMs, status }));
    }

    return Object.freeze({
        record,
        list: () => events.map((event) => ({ ...event })),
    });
}

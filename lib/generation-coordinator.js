const TERMINAL_STATES = new Set(['failed', 'completed', 'stale', 'cancelled']);

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function targetKey(plan) {
    const target = plan?.target;
    if (!target) return null;
    return [target.chatId || '', target.messageId ?? '', target.messageFingerprint || ''].join('|');
}

function projectPlan(plan) {
    if (!plan || typeof plan !== 'object') return undefined;
    const projected = {
        schema: plan.schema,
        id: plan.id,
        idempotencyKey: plan.idempotencyKey,
        invocation: plan.invocation,
    };
    if (plan.target && typeof plan.target === 'object') {
        projected.target = {
            ...(typeof plan.target.chatId === 'string' ? { chatId: plan.target.chatId } : {}),
            ...(plan.target.messageId != null ? { messageId: String(plan.target.messageId) } : {}),
            ...(typeof plan.target.messageFingerprint === 'string' ? { messageFingerprint: plan.target.messageFingerprint } : {}),
        };
    } else projected.target = null;
    if (plan.resolved && typeof plan.resolved === 'object') {
        projected.resolved = {
            ...(typeof plan.resolved.connectionId === 'string' ? { connectionId: plan.resolved.connectionId } : {}),
            ...(typeof plan.resolved.providerId === 'string' ? { providerId: plan.resolved.providerId } : {}),
            ...(typeof plan.resolved.modelId === 'string' ? { modelId: plan.resolved.modelId } : {}),
            ...(typeof plan.resolved.transportId === 'string' ? { transportId: plan.resolved.transportId } : {}),
            ...(typeof plan.resolved.endpointClass === 'string' ? { endpointClass: plan.resolved.endpointClass } : {}),
        };
    }
    if (plan.policy && typeof plan.policy === 'object') {
        projected.policy = {
            ...(typeof plan.policy.source === 'string' ? { source: plan.policy.source } : {}),
            ...(plan.policy.preflightAccepted === true ? { preflightAccepted: true } : {}),
        };
    }
    return projected;
}

function snapshot(record) {
    if (!record) return undefined;
    const { controller, resolve, reject, promise, execute, settled, cancelRequested, result, ...publicRecord } = record;
    return { ...publicRecord, plan: projectPlan(record.plan) };
}

function normalizedTerminalError(error) {
    if (!error) return undefined;
    const normalized = {
        category: typeof error.category === 'string' ? error.category : error.name === 'AbortError' ? 'cancelled' : 'unknown',
        code: typeof error.code === 'string' ? error.code : error.name === 'AbortError' ? 'ABORTED' : 'PROVIDER_ERROR',
    };
    if (Number.isFinite(error.status)) normalized.status = error.status;
    for (const field of ['providerId', 'modelId', 'requestId']) {
        if (typeof error[field] === 'string' && error[field]) normalized[field] = error[field].slice(0, 160);
    }
    return normalized;
}

export function createRunCoordinator({ maxConcurrent = 2, maxTerminalRecords = 64 } = {}) {
    maxConcurrent = Math.max(1, Math.min(8, Number(maxConcurrent) || 2));
    maxTerminalRecords = Math.max(1, Math.min(256, Number(maxTerminalRecords) || 64));
    const records = new Map();
    const queue = [];
    const listeners = new Set();
    const targets = new Set();
    let activeCount = 0;
    let sequence = 0;

    function emit(record, from, to) {
        record.state = to;
        for (const listener of listeners) {
            try { listener({ runId: record.runId, from, to }); } catch { /* observer isolation */ }
        }
    }

    function trimTerminals() {
        const terminal = [...records.values()].filter((record) => TERMINAL_STATES.has(record.state));
        if (terminal.length <= maxTerminalRecords) return;
        terminal.sort((left, right) => left.completedAt.localeCompare(right.completedAt));
        for (const record of terminal.slice(0, terminal.length - maxTerminalRecords)) records.delete(record.runId);
    }

    function settle(record, outcome, error) {
        if (record.settled) return;
        record.settled = true;
        if (error) record.reject(error);
        else record.resolve(outcome);
    }

    function terminal(record, state, result, error) {
        const from = record.state;
        if (record.target) targets.delete(record.target);
        if (from === 'running' || from === 'cancelling') activeCount = Math.max(0, activeCount - 1);
        if (record.state !== state) emit(record, from, state);
        record.completedAt = new Date().toISOString();
        if (error) record.terminal = { error: normalizedTerminalError(error) };
        // Once settled, discard the authoritative plan and retain only a safe projection.
        // Public snapshots are redacted even while active; this also bounds in-memory
        // retention of prompts, reference bytes, and provider configuration.
        record.plan = projectPlan(record.plan);
        settle(record, result, error);
        trimTerminals();
        pump();
    }

    async function start(record) {
        if (record.target) targets.add(record.target);
        activeCount += 1;
        emit(record, 'queued', 'running');
        try {
            const result = await record.execute(record.controller.signal);
            if (record.cancelRequested || record.controller.signal.aborted) {
                terminal(record, 'cancelled', undefined, abortError());
            } else if (result?.stale === true) {
                terminal(record, 'stale', result);
            } else {
                terminal(record, 'completed', result);
            }
        } catch (error) {
            if (record.cancelRequested || record.controller.signal.aborted || error?.name === 'AbortError') terminal(record, 'cancelled', undefined, abortError());
            else terminal(record, 'failed', undefined, error);
        }
    }

    function pump() {
        while (activeCount < maxConcurrent) {
            const index = queue.findIndex((record) => !record.target || !targets.has(record.target));
            if (index < 0) return;
            const [record] = queue.splice(index, 1);
            if (record.state !== 'queued') continue;
            void start(record);
        }
    }

    function enqueue(plan, execute) {
        if (!plan || typeof plan !== 'object') throw new TypeError('RunCoordinator requires a GenerationPlan.');
        if (typeof execute !== 'function') throw new TypeError('RunCoordinator requires an execute function.');
        const idempotencyKey = String(plan.idempotencyKey || plan.id || '');
        if (!idempotencyKey) throw new TypeError('GenerationPlan requires an idempotencyKey.');
        const existing = [...records.values()].find((record) => record.idempotencyKey === idempotencyKey && (record.state === 'queued' || record.state === 'running' || record.state === 'cancelling'));
        if (existing) return existing.promise;
        const runId = `run:${++sequence}`;
        const record = {
            runId,
            idempotencyKey,
            state: 'queued',
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            controller: new AbortController(),
            plan,
            execute,
            target: targetKey(plan),
            cancelRequested: false,
            settled: false,
        };
        record.promise = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
        record.promise.runId = runId;
        records.set(runId, record);
        queue.push(record);
        emit(record, undefined, 'queued');
        pump();
        return record.promise;
    }

    function cancel(runId) {
        const record = records.get(runId);
        if (!record || TERMINAL_STATES.has(record.state)) return false;
        record.cancelRequested = true;
        if (record.state === 'queued') {
            const index = queue.indexOf(record);
            if (index >= 0) queue.splice(index, 1);
            terminal(record, 'cancelled', undefined, abortError());
        } else if (record.state === 'running') {
            emit(record, 'running', 'cancelling');
            record.controller.abort();
            // Reject the caller immediately. The execution slot remains
            // cancelling until the underlying operation observes the signal,
            // so an uncooperative provider cannot create an over-capacity run.
            settle(record, undefined, abortError());
        }
        return true;
    }

    return {
        enqueue,
        cancel,
        get: (runId) => snapshot(records.get(runId)),
        list: () => [...records.values()].map(snapshot),
        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export function createGenerationCoordinator(options) {
    const coordinator = createRunCoordinator(options);
    const active = new Set();
    return {
        ...coordinator,
        async run(key, operation) {
            if (active.has(key)) throw new Error('Image generation is already in progress for this target.');
            active.add(key);
            const plan = { schema: 2, id: `legacy:${key}`, idempotencyKey: `legacy:${key}:${Date.now()}:${Math.random()}`, target: { chatId: String(key) } };
            try { return await coordinator.enqueue(plan, operation); }
            finally { active.delete(key); }
        },
    };
}

const CANCELLABLE_STATES = new Set(['queued', 'running', 'cancelling']);

export function listCancellableRunIds(runs) {
    if (!Array.isArray(runs)) return [];
    return runs.flatMap((run) => (
        typeof run?.runId === 'string'
            && CANCELLABLE_STATES.has(run.state)
            && run.commitStarted !== true
            ? [run.runId]
            : []
    ));
}

export function cancelCancellableRuns(coordinator) {
    if (!coordinator || typeof coordinator.list !== 'function' || typeof coordinator.cancel !== 'function') return [];
    return listCancellableRunIds(coordinator.list()).filter((runId) => coordinator.cancel(runId));
}

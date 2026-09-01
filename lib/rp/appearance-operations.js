import { enqueueLibraryMutation } from './persistence-verifier.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function runRebasedLibraryOperation({ readLatest, operation } = {}) {
    return enqueueLibraryMutation(async () => operation(clone(await readLatest())));
}

export function runRebasedLibraryMutation({ readLatest, mutate, saveLibrary, verifySaved, alreadyQueued = false } = {}) {
    const operation = async (latest) => {
        const candidate = await mutate(clone(latest));
        let verification;
        try { await saveLibrary(candidate); verification = await verifySaved(candidate); } catch (error) { verification = { status: 'indeterminate', error }; }
        return verification?.status === 'confirmed' ? { status: 'confirmed', library: candidate, candidate } : { status: verification?.status || 'indeterminate', library: latest, candidate };
    };
    return alreadyQueued ? readLatest().then(operation) : runRebasedLibraryOperation({ readLatest, operation });
}

export async function reconcileAppearanceOperations({ library, verifyRevision, saveLibrary, verifySaved, deleteFile = async () => {}, uuid = () => crypto.randomUUID() } = {}) {
    const original = clone(library || {});
    const operations = original.operations || {};
    if (!Object.keys(operations).length) return { status: 'nothing-to-do', library: original };
    const authority = await verifyRevision(original.revision);
    if (authority?.status !== 'confirmed') return { status: authority?.status || 'indeterminate', library: original };
    const candidate = clone(original);
    for (const [operationId, operation] of Object.entries(candidate.operations || {})) {
        if (operation?.status === 'orphan-cleanup') {
            try { await deleteFile(operation.url); delete candidate.operations[operationId]; } catch { /* retained for reload retry */ }
        } else if (operation?.status === 'pending') {
            delete candidate.operations[operationId];
        }
    }
    candidate.revision = `appearance-reconciled:${uuid()}`;
    await saveLibrary(candidate);
    const accepted = await verifySaved(candidate.revision);
    return accepted?.status === 'confirmed'
        ? { status: 'reconciled', library: candidate }
        : { status: accepted?.status || 'indeterminate', library: original };
}

export async function persistOrphanCleanupRecovery({ library, readLatest = async () => library, url, saveLibrary, verifySaved, scheduleRetry, operationId, alreadyQueued = false, uuid = () => crypto.randomUUID() } = {}) {
    const stableOperationId = operationId || `orphan-cleanup:${uuid()}`;
    const result = await runRebasedLibraryMutation({
        readLatest,
        alreadyQueued,
        mutate: async (latest) => {
            const candidate = clone(latest || {});
            candidate.operations = { ...(candidate.operations || {}), [stableOperationId]: { status: 'orphan-cleanup', url } };
            candidate.revision = `appearance-orphan:${uuid()}`;
            return candidate;
        },
        saveLibrary,
        verifySaved: (candidate) => verifySaved(candidate.revision),
    });
    if (result.status === 'confirmed') return { status: 'tracked', library: result.library, operationId: stableOperationId };
    scheduleRetry?.({ operationId: stableOperationId, library: result.candidate });
    return { status: 'recovery-pending', library: result.candidate, verification: { status: result.status }, operationId: stableOperationId };
}

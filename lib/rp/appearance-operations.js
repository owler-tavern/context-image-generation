import { enqueueLibraryMutation } from './persistence-verifier.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function runRebasedLibraryMutation({ readLatest, mutate, saveLibrary, verifySaved } = {}) {
    return enqueueLibraryMutation(async () => {
        const latest = await readLatest();
        const candidate = await mutate(clone(latest));
        await saveLibrary(candidate);
        const verification = await verifySaved(candidate);
        return verification?.status === 'confirmed' ? { status: 'confirmed', library: candidate } : { status: verification?.status || 'indeterminate', library: latest };
    });
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

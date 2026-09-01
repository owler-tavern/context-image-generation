import { clearChatBinding } from './chat-canon.js';
import { finalizeGlobalLookDeletion, migrateAppearanceLibrary, stageGlobalLookDeletion } from './appearance-library.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export async function runStopUsingInChat({ captured, identityId, canon, io } = {}) {
    if (!io?.isCurrent?.(captured)) return { status: 'stale', message: 'The chat changed before this look could be stopped.' };
    const candidate = { ...clearChatBinding(canon, identityId), revision: `chat-canon:${io.uuid()}` };
    const persisted = await io.persistChat({ captured, identityId, candidate });
    if (!io.isCurrent(captured)) return { status: 'stale', message: 'The chat changed before this look could be stopped.' };
    if (persisted?.status === 'confirmed') return { ...persisted, candidate, status: 'confirmed', message: 'Stopped using this look in this chat.' };
    return { ...persisted, candidate, status: persisted?.status || 'indeterminate', message: 'Stop verification pending.' };
}

async function saveAndVerify(io, library, revision) {
    await io.saveLibrary(library);
    return io.verifyLibrary(revision);
}

async function executeDeletion({ operationId, library, io }) {
    const operation = library.operations?.[operationId];
    if (!operation || operation.status !== 'deleting') return { status: 'not-found', library };
    io.setLocalLibrary?.(library);
    try {
        if (operation.url) await io.deleteFile(operation.url);
    } catch (error) {
        return { status: 'retryable', library, operationId, error, message: 'Saved look deletion will retry.' };
    }
    const final = finalizeGlobalLookDeletion(library, operationId);
    final.revision = `appearance-deleted:${io.uuid()}`;
    let verification;
    try { verification = await saveAndVerify(io, final, final.revision); } catch (error) { return { status: 'retryable', library, operationId, error, message: 'Saved look deletion will retry.' }; }
    if (verification?.status !== 'confirmed') return { status: 'retryable', library, operationId, verification, message: 'Saved look deletion will retry.' };
    io.setLocalLibrary?.(final);
    return { status: 'confirmed', library: final, operationId, message: 'Saved look deleted everywhere.' };
}

export async function runGlobalLookDeletion({ lookId, operationId, io, withinExclusive = false } = {}) {
    if (!withinExclusive && io?.runExclusive) return io.runExclusive(() => runGlobalLookDeletion({ lookId, operationId, io, withinExclusive: true }));
    const authoritative = await io.readLibrary();
    if (authoritative?.status !== 'confirmed') return { status: authoritative?.status || 'indeterminate', message: 'Saved look deletion verification pending.' };
    const staged = stageGlobalLookDeletion(authoritative.library, lookId, operationId);
    if (staged.decision === 'not-found') return { status: 'not-found', message: 'Saved look not found.' };
    const candidate = clone(staged.libraryWithTombstone);
    candidate.revision = `appearance-deleting:${io.uuid()}`;
    let verification;
    try { verification = await saveAndVerify(io, candidate, candidate.revision); } catch (error) { return { status: 'indeterminate', candidate, error, message: 'Saved look deletion verification pending.' }; }
    if (verification?.status !== 'confirmed') return { status: verification?.status || 'indeterminate', candidate, verification, message: 'Saved look deletion verification pending.' };
    return executeDeletion({ operationId, library: candidate, io });
}

export async function resumeGlobalLookDeletion({ operationId, io, withinExclusive = false } = {}) {
    if (!withinExclusive && io?.runExclusive) return io.runExclusive(() => resumeGlobalLookDeletion({ operationId, io, withinExclusive: true }));
    const authoritative = await io.readLibrary();
    if (authoritative?.status !== 'confirmed') return { status: authoritative?.status || 'indeterminate' };
    const library = migrateAppearanceLibrary(authoritative.library);
    return executeDeletion({ operationId, library, io });
}

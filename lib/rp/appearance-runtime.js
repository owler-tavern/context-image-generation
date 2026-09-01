export const CANON_OUTCOMES = Object.freeze({
    remember: Object.freeze({ confirmed: 'Saved and active in this chat.', 'confirmed-absent': 'Saved to the appearance library, but it was not activated in this chat.', indeterminate: 'Activation verification pending.', stale: 'Saved to the appearance library, but the chat changed before it could be activated.' }),
    use: Object.freeze({ confirmed: 'Active in this chat.', 'confirmed-absent': 'The look selection was not saved.', indeterminate: 'Activation verification pending.', stale: 'The look selection is stale because the chat changed.' }),
    lock: Object.freeze({ confirmed: 'Locked for this chat.', 'confirmed-absent': 'The lock change was not saved.', indeterminate: 'Activation verification pending.', stale: 'The lock change is stale because the chat changed.' }),
    unlock: Object.freeze({ confirmed: 'Unlocked for this chat.', 'confirmed-absent': 'The lock change was not saved.', indeterminate: 'Activation verification pending.', stale: 'The lock change is stale because the chat changed.' }),
});

const REMEMBER_MESSAGES = Object.freeze({
    confirmed: CANON_OUTCOMES.remember.confirmed,
    'confirmed-absent': CANON_OUTCOMES.remember['confirmed-absent'],
    indeterminate: 'Saved look verification pending. It will be reconciled before use.',
    stale: CANON_OUTCOMES.remember.stale,
    alternate: 'Saved as an alternate; your locked look was not changed.',
});

function rememberResult(status, extra = {}) {
    return { ...extra, status, message: REMEMBER_MESSAGES[status] };
}

/**
 * Owns the complete Remember transaction while host-specific I/O stays injected.
 * The injected boundary deliberately contains only Gallery, appearance upload,
 * settings, cleanup, and captured-chat operations; provider generation is not a
 * dependency of this feature.
 */
export async function runRememberAppearance({ captured, identity, label, item, io, withinExclusive = false } = {}) {
    if (!identity?.id || !item || !io || typeof io.isCurrent !== 'function') throw new TypeError('Remember requires a captured target, identity, Gallery item, and host I/O.');
    if (!withinExclusive && typeof io.runExclusive === 'function') {
        return io.runExclusive(() => runRememberAppearance({ captured, identity, label, item, io, withinExclusive: true }));
    }
    if (!io.isCurrent(captured)) return rememberResult('stale');

    const authoritative = await io.readLibrary();
    if (!io.isCurrent(captured)) return rememberResult('stale');
    if (authoritative?.status !== 'confirmed') return rememberResult('indeterminate', { verification: authoritative });

    let promoted;
    try {
        promoted = await promoteGalleryArtifact({
            item,
            identityId: identity.id,
            library: authoritative.library,
            readDataUrl: io.readDataUrl,
            saveBase64: io.saveBase64,
            isTargetCurrent: () => io.isCurrent(captured),
            uuid: io.uuid,
        });
    } catch (error) {
        if (!io.isCurrent(captured)) return rememberResult('stale', { error });
        throw error;
    }
    if (!promoted?.look || !promoted?.asset) throw new Error('This Gallery image could not be remembered.');
    let activationStale = !io.isCurrent(captured);
    promoted.look.label = label;

    const inserted = addPromotedAppearanceLook(authoritative.library, { identity, asset: promoted.asset, look: promoted.look });
    const operationId = `promotion:${io.uuid()}`;
    inserted.library.operations = { ...(inserted.library.operations || {}), [operationId]: { status: 'pending', assetId: promoted.asset.id, lookId: promoted.look.id, identityId: identity.id, galleryArtifactId: galleryArtifactKey(item) } };
    inserted.library.revision = `appearance:${io.uuid()}`;
    const pending = { library: inserted.library, revision: inserted.library.revision, operationId };
    let pendingVerification;
    try {
        await io.saveLibrary(pending.library);
        activationStale ||= !io.isCurrent(captured);
        pendingVerification = await io.verifyLibrary(pending.revision);
        activationStale ||= !io.isCurrent(captured);
    } catch (error) {
        io.scheduleLibraryReconciliation?.({ ...pending, promoted, error });
        return rememberResult('indeterminate', { promoted, operationId: pending.operationId, error });
    }

    if (pendingVerification?.status === 'confirmed-absent') {
        if (!promoted.deduplicated) {
            try {
                await io.deleteAppearanceFile(promoted.asset.url);
                io.setLocalLibrary?.(migrateAppearanceLibrary(authoritative.library));
            } catch (error) {
                try { await io.persistOrphanCleanup({ library: authoritative.library, url: promoted.asset.url }); }
                catch { io.scheduleLibraryReconciliation?.({ ...pending, promoted, error }); }
            }
        }
        return { ...rememberResult('confirmed-absent', { promoted, operationId: pending.operationId }), message: 'The look was not saved.' };
    }
    if (pendingVerification?.status !== 'confirmed') {
        io.scheduleLibraryReconciliation?.({ ...pending, promoted, verification: pendingVerification });
        return rememberResult('indeterminate', { promoted, operationId: pending.operationId, verification: pendingVerification });
    }

    const acceptedLibrary = migrateAppearanceLibrary(pending.library);
    delete acceptedLibrary.operations[pending.operationId];
    acceptedLibrary.revision = `appearance:${io.uuid()}`;
    const accepted = { library: acceptedLibrary, revision: acceptedLibrary.revision };
    let acceptedVerification;
    try {
        await io.saveLibrary(accepted.library);
        activationStale ||= !io.isCurrent(captured);
        acceptedVerification = await io.verifyLibrary(accepted.revision);
        activationStale ||= !io.isCurrent(captured);
    } catch (error) {
        acceptedVerification = { status: 'indeterminate', error };
    }
    if (acceptedVerification?.status !== 'confirmed') {
        try {
            const restored = migrateAppearanceLibrary(pending.library);
            restored.revision = `appearance-pending:${io.uuid()}`;
            await io.saveLibrary(restored);
            await io.verifyLibrary(restored.revision);
        } catch { /* reconciliation remains authoritative */ }
        io.scheduleLibraryReconciliation?.({ ...pending, promoted, verification: acceptedVerification });
        return rememberResult('indeterminate', { promoted, operationId: pending.operationId, verification: acceptedVerification });
    }

    if (activationStale || !io.isCurrent(captured)) return rememberResult('stale', { promoted, operationId: pending.operationId });
    const canon = migrateChatCanon(io.getChatCanon());
    const binding = getChatBinding(canon, identity.id);
    if (binding?.isLocked) return rememberResult('alternate', { promoted, operationId: pending.operationId });

    const candidate = { ...setChatBinding(canon, identity.id, { activeLookId: promoted.look.id, expectedAssetId: promoted.asset.id, isLocked: false, selectedAt: io.now() }), revision: `chat-canon:${io.uuid()}` };
    const chatPersistence = await io.persistChat({ captured, identityId: identity.id, activeLookId: promoted.look.id, candidate });
    if (!io.isCurrent(captured)) return rememberResult('stale', { promoted, operationId: pending.operationId, candidate, chatPersistence });
    const chatStatus = ['confirmed', 'confirmed-absent', 'indeterminate'].includes(chatPersistence?.status) ? chatPersistence.status : 'indeterminate';
    const result = rememberResult(chatStatus, { ...chatPersistence, promoted, operationId: pending.operationId, candidate });
    return chatStatus === 'indeterminate' ? { ...result, message: CANON_OUTCOMES.remember.indeterminate } : result;
}

export async function executeCanonAction({ action, captured, baselineFingerprint, isCurrent, getFingerprint, buildCandidate, persist } = {}) {
    const outcomes = CANON_OUTCOMES[action];
    if (!outcomes) throw new TypeError('Unknown canon action.');
    if (!isCurrent(captured) || getFingerprint() !== baselineFingerprint) return { status: 'stale', message: outcomes.stale };
    const candidate = buildCandidate();
    if (!candidate) return { status: 'stale', message: outcomes.stale };
    const persistence = await persist(candidate);
    const status = outcomes[persistence?.status] ? persistence.status : 'indeterminate';
    return { ...persistence, status, candidate, message: outcomes[status] };
}

export function createAppearanceFeatureController({ isCurrent, getFingerprint, persistChat, promoteLook, persistLibrary } = {}) {
    const canonAction = (action, input) => executeCanonAction({
        action,
        captured: input.captured,
        baselineFingerprint: input.baselineFingerprint,
        isCurrent,
        getFingerprint: () => getFingerprint(input.identityId),
        buildCandidate: input.buildCandidate,
        persist: (candidate) => persistChat({ ...input, candidate }),
    });
    return Object.freeze({
        use: (input) => canonAction('use', input),
        lock: (input) => canonAction('lock', input),
        unlock: (input) => canonAction('unlock', input),
        async remember(input) {
            if (!isCurrent(input.captured)) return { status: 'stale', message: CANON_OUTCOMES.remember.stale };
            const promoted = await promoteLook(input);
            if (!isCurrent(input.captured)) return { status: 'stale', promoted, message: CANON_OUTCOMES.remember.stale };
            const saved = await persistLibrary({ ...input, promoted });
            if (saved?.status !== 'confirmed') return { ...saved, promoted, message: saved?.message || 'Saved look verification pending. It will be reconciled before use.' };
            if (!isCurrent(input.captured)) return { status: 'stale', promoted, message: CANON_OUTCOMES.remember.stale };
            return canonAction('remember', { ...input, promoted });
        },
    });
}
import { promoteGalleryArtifact } from './appearance-assets.js';
import { addPromotedAppearanceLook, galleryArtifactKey, migrateAppearanceLibrary } from './appearance-library.js';
import { getChatBinding, migrateChatCanon, setChatBinding } from './chat-canon.js';

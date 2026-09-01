export const CANON_OUTCOMES = Object.freeze({
    remember: Object.freeze({ confirmed: 'Saved and active in this chat.', 'confirmed-absent': 'Saved to the appearance library, but it was not activated in this chat.', indeterminate: 'Activation verification pending.', stale: 'Saved to the appearance library, but the chat changed before it could be activated.' }),
    use: Object.freeze({ confirmed: 'Active in this chat.', 'confirmed-absent': 'The look selection was not saved.', indeterminate: 'Activation verification pending.', stale: 'The look selection is stale because the chat changed.' }),
    lock: Object.freeze({ confirmed: 'Locked for this chat.', 'confirmed-absent': 'The lock change was not saved.', indeterminate: 'Activation verification pending.', stale: 'The lock change is stale because the chat changed.' }),
    unlock: Object.freeze({ confirmed: 'Unlocked for this chat.', 'confirmed-absent': 'The lock change was not saved.', indeterminate: 'Activation verification pending.', stale: 'The lock change is stale because the chat changed.' }),
});

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

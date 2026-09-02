import {
    ACTIONS,
    chooseTwoUpArtifact,
    createIterationInvocationId,
    normalizeIterationAction,
    planIterationAction,
    repairPromptDraft,
} from './iteration-domain.js';

export const ACTION_LABELS = Object.freeze({
    [ACTIONS.VARY_SHOT]: 'Vary shot',
    [ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE]: 'Keep characters/change scene',
    [ACTIONS.EDIT_REGENERATE]: 'Edit & regenerate',
    [ACTIONS.REUSE_RECIPE]: 'Reuse recipe',
    [ACTIONS.MAKE_CANONICAL_ROLES]: 'Make canonical',
    [ACTIONS.RETRY_REPAIRED_PROMPT]: 'Retry repaired prompt',
});

const BUSY_STATES = new Set(['dispatching', 'persisting']);
const GENERATION_ACTIONS = new Set([
    ACTIONS.VARY_SHOT,
    ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE,
    ACTIONS.EDIT_REGENERATE,
    ACTIONS.REUSE_RECIPE,
]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}
function clean(value) { return String(value ?? '').trim(); }
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function formatCost(amount, currency = 'USD') { return `${currency} ${Number(amount).toFixed(2)}`; }
function outputCount(twoUp) { return twoUp ? 2 : 1; }
function dependencyError(name) { return `Required ${name} dependency is unavailable; generation is blocked.`; }
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}
function stableJson(value) { return JSON.stringify(canonical(value)); }
function normalizeQuote(value, count) {
    if (!isRecord(value) || !clean(value.quoteId) || !clean(value.currency)) return null;
    const amount = value.amount;
    const expiresAt = value.expiresAt;
    const expiresMs = typeof expiresAt === 'number' ? expiresAt : Date.parse(String(expiresAt || ''));
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(expiresMs) || expiresMs <= Date.now()) return null;
    return freeze({ quoteId: clean(value.quoteId), amount, currency: clean(value.currency), expiresAt: typeof expiresAt === 'number' ? expiresAt : String(expiresAt), outputCount: count, finite: true });
}
function stateSnapshot(state) { return freeze(clone(state)); }

function initialState(sourceArtifact, { allowUnquotedSingle = false } = {}) {
    const original = clone(sourceArtifact);
    return {
        status: 'idle',
        message: 'Choose an iteration action.',
        error: null,
        action: null,
        prompt: clean(sourceArtifact?.effectivePrompt),
        sourcePassage: clean(sourceArtifact?.sourcePassage?.text),
        scene: {},
        canonicalRoles: {},
        composition: {},
        twoUp: false,
        twoUpAvailable: sourceArtifact?.generationPlan?.twoUpAvailable !== false,
        singleOutputUnquoted: allowUnquotedSingle,
        supportedCanonicalRoles: null,
        quote: null,
        quoteKey: null,
        consent: { approved: false, outputCount: null },
        repairedPrompt: null,
        repairedPromptConfirmed: false,
        originalArtifact: original,
        sourceArtifact: original,
        plan: null,
        artifacts: [],
        chosenArtifactId: null,
        discardArtifactIds: [],
        verification: null,
        originalRetention: null,
    };
}

function dispatchWithCoordinator(coordinator, plan, dispatchExecutor) {
    if (typeof coordinator === 'function') return coordinator(plan);
    if (coordinator && typeof coordinator.dispatch === 'function') return coordinator.dispatch(plan);
    if (coordinator && typeof coordinator.enqueue === 'function') {
        const execute = typeof dispatchExecutor === 'function'
            ? (signal) => dispatchExecutor(plan, signal)
            : typeof coordinator.execute === 'function' ? (signal) => coordinator.execute(plan, signal) : undefined;
        return execute ? coordinator.enqueue(plan, execute) : coordinator.enqueue(plan);
    }
    throw new TypeError(dependencyError('dispatchCoordinator'));
}

function invokeMutation(mutation, input, dependencyName) {
    if (typeof mutation === 'function') return mutation(input);
    if (mutation && typeof mutation.mutate === 'function') return mutation.mutate(input);
    throw new TypeError(dependencyError(dependencyName));
}

function mergeOutputArtifact(planned, output) {
    if (!isRecord(output)) return clone(planned);
    return {
        ...clone(planned),
        ...clone(output),
        artifactId: String(output.artifactId || planned.artifactId),
        parentArtifactId: planned.parentArtifactId,
    };
}

function artifactsFromDispatch(plan, dispatched) {
    if (!Array.isArray(dispatched?.artifacts) || dispatched.artifacts.length !== plan.artifacts.length) throw new TypeError('Generation receipt has an incomplete artifact list.');
    return plan.artifacts.map((planned, index) => mergeOutputArtifact(planned, dispatched.artifacts[index]));
}

function validateDispatchReceipt(receipt, plan) {
    if (!isRecord(receipt) || receipt.status !== 'completed' || receipt.planId !== plan.planId || receipt.invocationId !== plan.invocationId || receipt.outputCount !== plan.artifacts.length || !Array.isArray(receipt.artifacts) || receipt.artifacts.length !== plan.artifacts.length) throw new TypeError('Generation receipt is incomplete or does not match the plan and invocation.');
    receipt.artifacts.forEach((artifact, index) => {
        if (!isRecord(artifact) || artifact.artifactId !== plan.artifacts[index].artifactId) throw new TypeError('Generation receipt artifact identity does not match the planned output.');
    });
}

function actionChanges(state, input, action) {
    const changes = isRecord(input.changes) ? clone(input.changes) : {};
    if (action === ACTIONS.VARY_SHOT && !isRecord(changes.composition)) changes.composition = clone(state.composition);
    if (action === ACTIONS.EDIT_REGENERATE || action === ACTIONS.RETRY_REPAIRED_PROMPT) {
        changes.prompt = input.prompt === undefined ? state.prompt : input.prompt;
    }
    return changes;
}

export function createIterationSurfaceController(options = {}) {
    const sourceArtifact = options.sourceArtifact;
    if (!isRecord(sourceArtifact) || !clean(sourceArtifact.artifactId)) throw new TypeError('sourceArtifact with artifactId is required.');
    const state = initialState(sourceArtifact, options);
    state.supportedCanonicalRoles = Array.isArray(options.supportedCanonicalRoles) ? [...options.supportedCanonicalRoles] : null;
    if (options.twoUpAvailable === false) state.twoUpAvailable = false;
    const listeners = new Set();

    function update(patch) {
        Object.assign(state, clone(patch));
        const snapshot = stateSnapshot(state);
        for (const listener of listeners) {
            try { listener(snapshot); } catch { /* observer isolation */ }
        }
        return snapshot;
    }

    function missingDependencies(action, { twoUp = false } = {}) {
        const missing = [];
        if (typeof options.verifyGenerationPlan !== 'function') missing.push('verifyGenerationPlan');
        if (!isRecord(options.generationPlan)) missing.push('generationPlan');
        if (typeof options.reserveInvocation !== 'function') missing.push('reserveInvocation');
        if (GENERATION_ACTIONS.has(action)) {
            if (typeof options.estimateCost !== 'function' && !(options.allowUnquotedSingle === true && !twoUp)) missing.push('estimateCost');
            if (!options.dispatchCoordinator || (typeof options.dispatchCoordinator !== 'function' && typeof options.dispatchCoordinator.dispatch !== 'function' && typeof options.dispatchCoordinator.enqueue !== 'function')) missing.push('dispatchCoordinator');
            if (typeof options.persistArtifact !== 'function') missing.push('persistArtifact');
            if (typeof options.readbackArtifact !== 'function') missing.push('readbackArtifact');
            if (typeof options.readbackOriginalArtifact !== 'function') missing.push('readbackOriginalArtifact');
            if (twoUp && typeof options.discardArtifact !== 'function') missing.push('discardArtifact');
        }
        if (action === ACTIONS.MAKE_CANONICAL_ROLES) {
            if (typeof options.verifyCanonicalEligibility !== 'function') missing.push('verifyCanonicalEligibility');
            if (typeof options.mutateCanonical !== 'function' && typeof options.mutateCanonical?.mutate !== 'function') missing.push('mutateCanonical');
            if (typeof options.readbackCanonical !== 'function') missing.push('readbackCanonical');
        }
        return missing;
    }

    async function quoteAction({ action, twoUp = state.twoUp, changes = {} } = {}) {
        const normalizedAction = normalizeIterationAction(action || state.action);
        if (!GENERATION_ACTIONS.has(normalizedAction)) return freeze({ outputCount: 0, amount: null, finite: true });
        if (twoUp && state.twoUpAvailable === false) return freeze({ outputCount: 2, amount: null, finite: false, error: 'Two-up is unavailable until two distinct provider outputs and a real chooser are implemented.' });
        if (typeof options.estimateCost !== 'function') return freeze({ outputCount: outputCount(twoUp), amount: null, finite: false, error: dependencyError('estimateCost') });
        try {
            const count = outputCount(twoUp);
            const effectiveChanges = actionChanges(state, { changes }, normalizedAction);
            const estimate = await options.estimateCost({ action: normalizedAction, sourceArtifact: clone(state.sourceArtifact), changes: clone(effectiveChanges), outputCount: count });
            const quote = normalizeQuote(estimate, count);
            const quoteKey = stableJson({ action: normalizedAction, twoUp: Boolean(twoUp), changes: clone(effectiveChanges) });
            const result = quote ? { ...quote, quoteKey } : { outputCount: count, amount: null, finite: false, error: 'Estimator did not return a finite quote with quoteId, currency, and expiry.' };
            update({ action: normalizedAction, twoUp: Boolean(twoUp), quote, quoteKey: quote ? quoteKey : null, message: quote ? `Estimated cost: ${formatCost(quote.amount, quote.currency)} for ${count} image${count === 1 ? '' : 's'}.` : 'Cost unavailable; generation is blocked.' });
            return freeze(result);
        } catch (error) {
            update({ quote: null, quoteKey: null, status: 'error', error: error?.message || 'Cost estimate failed.' });
            return freeze({ outputCount: outputCount(twoUp), amount: null, finite: false, error: error?.message || 'Cost estimate failed.' });
        }
    }

    function preparePrompt(value) {
        const repaired = repairPromptDraft(value);
        const stateAfterUpdate = update({ prompt: repaired.repairedPrompt, repairedPrompt: repaired, repairedPromptConfirmed: repaired.status !== 'repaired', status: repaired.status === 'repaired' ? 'draft-review' : 'editing', message: repaired.status === 'repaired' ? 'Review the repaired prompt before generating.' : 'Prompt ready.', error: null });
        return freeze({ ...clone(repaired), state: stateAfterUpdate });
    }

    function confirmRepairedPrompt() {
        if (state.repairedPrompt?.status !== 'repaired') return stateSnapshot(state);
        return update({ repairedPromptConfirmed: true, status: 'editing', message: 'Repaired prompt confirmed. Choose an action to continue.', error: null });
    }

    function selectAction(action) {
        const normalizedAction = normalizeIterationAction(action);
        if (!Object.values(ACTIONS).includes(normalizedAction)) return update({ status: 'error', error: 'Choose a supported iteration action.' });
        return update({ action: normalizedAction, status: 'editing', quote: null, quoteKey: null, originalRetention: null, message: `${ACTION_LABELS[normalizedAction]} selected. Complete the editor, then submit.`, error: null });
    }

    function exactArtifactReadback(verification, artifact, plan) {
        return verification?.status === 'confirmed'
            && verification.artifactId === artifact.artifactId
            && verification.planId === plan.planId
            && verification.invocationId === plan.invocationId;
    }

    function exactCanonicalReadback(verification, plan) {
        return verification?.status === 'confirmed'
            && verification.planId === plan.planId
            && verification.invocationId === plan.invocationId
            && stableJson(verification.mutation) === stableJson(plan.mutation);
    }

    async function persistAndReadback(plan, artifact, canonical = false) {
        update({ status: 'persisting', message: canonical ? 'Saving canonical roles…' : 'Saving selected image…', error: null });
        const persist = canonical
            ? await invokeMutation(options.mutateCanonical, { plan, mutation: plan.mutation, sourceArtifact: clone(state.originalArtifact) }, 'mutateCanonical')
            : await options.persistArtifact({ artifact: clone(artifact), originalArtifact: clone(state.originalArtifact), sourceArtifact: clone(state.sourceArtifact), plan: clone(plan) });
        const verification = canonical
            ? await options.readbackCanonical({ plan: clone(plan), mutation: clone(plan.mutation), sourceArtifact: clone(state.originalArtifact), persisted: clone(persist) })
            : await options.readbackArtifact({ artifact: clone(artifact), originalArtifact: clone(state.originalArtifact), plan: clone(plan), persisted: clone(persist) });
        const exact = canonical ? exactCanonicalReadback(verification, plan) : exactArtifactReadback(verification, artifact, plan);
        if (!exact) {
            return update({ status: 'error', verification: clone(verification), error: canonical ? 'Canonical read-back was not confirmed.' : 'Image read-back was not confirmed.', message: 'The change was not confirmed; the original remains retained.' });
        }
        return update({ status: 'persisted', verification: clone(verification), message: canonical ? 'Canonical update saved; verifying original retention…' : 'Image saved; verifying original retention…', error: null });
    }

    async function verifyOriginalRetention(plan) {
        const retention = await options.readbackOriginalArtifact({ originalArtifact: clone(state.originalArtifact), plan: clone(plan) });
        const exact = retention?.status === 'confirmed'
            && retention.artifactId === state.originalArtifact.artifactId
            && retention.planId === plan.planId
            && retention.invocationId === plan.invocationId;
        if (!exact) return update({ status: 'error', originalRetention: clone(retention), error: 'Original artifact retention was not confirmed.', message: 'The original remains available locally, but persistence could not confirm retention.' });
        return update({ originalRetention: clone(retention), error: null });
    }

    async function submit(input = {}) {
        const requestedAction = normalizeIterationAction(input.action || state.action);
        if (!Object.values(ACTIONS).includes(requestedAction)) return update({ status: 'error', error: 'Choose a supported iteration action.' });
        if ([ACTIONS.RETRY_REPAIRED_PROMPT, ACTIONS.EDIT_REGENERATE].includes(requestedAction) && state.repairedPrompt?.status === 'repaired' && !state.repairedPromptConfirmed) {
            return update({ action: requestedAction, status: 'draft-review', message: 'Confirm the repaired prompt before generating.' });
        }
        const action = requestedAction === ACTIONS.RETRY_REPAIRED_PROMPT ? ACTIONS.EDIT_REGENERATE : requestedAction;
        const twoUp = input.twoUp === undefined ? state.twoUp : Boolean(input.twoUp);
        if (twoUp && state.twoUpAvailable === false) return update({ status: 'error', error: 'Two-up is unavailable until two distinct provider outputs and a real chooser are implemented.', message: 'Two-up is unavailable; single-output actions remain available.' });
        const missing = missingDependencies(action, { twoUp });
        if (missing.length) return update({ action: requestedAction, status: 'error', error: missing.map(dependencyError).join(' '), message: 'Generation is blocked until its authoritative dependencies are available.' });
        const changes = actionChanges(state, input, requestedAction);
        update({ action: requestedAction, twoUp, consent: clone(input.consent || state.consent), originalRetention: null, error: null });

        let quote = null;
        if (GENERATION_ACTIONS.has(action) && !(options.allowUnquotedSingle === true && !twoUp)) {
            const quoteKey = stableJson({ action, twoUp, changes: clone(changes) });
            quote = state.quote && state.quoteKey === quoteKey ? state.quote : null;
            if (!quote) {
                const estimated = await quoteAction({ action, twoUp, changes });
                if (!estimated.finite) return update({ status: 'error', error: estimated.error || 'Finite cost estimate is required.' });
                return update({ status: 'consent-required', message: 'Review the newly displayed quote and approve it before dispatch.' });
            }
            if ((typeof quote.expiresAt === 'number' ? quote.expiresAt : Date.parse(quote.expiresAt)) <= Date.now()) return update({ status: 'consent-required', error: 'This quote has expired; request a new quote before dispatch.', message: 'Quote expired.' });
            const consent = isRecord(input.consent) ? input.consent : state.consent;
            const count = outputCount(twoUp);
            const exactConsent = consent.approved === true && Number(consent.outputCount) === count && consent.quoteId === quote.quoteId && consent.amount === quote.amount && consent.currency === quote.currency && consent.expiresAt === quote.expiresAt;
            if (!exactConsent) return update({ status: 'consent-required', quote, consent: { approved: consent.approved === true, outputCount: Number.isInteger(consent.outputCount) ? consent.outputCount : null }, message: `Confirm the exact quote ${formatCost(quote.amount, quote.currency)} for ${count} image${count === 1 ? '' : 's'}.` });
        }

        const invocationId = clean(input.invocationId || options.invocationId) || (typeof options.createInvocationId === 'function' ? clean(options.createInvocationId()) : createIterationInvocationId({ randomUUID: options.randomUUID || globalThis.crypto?.randomUUID?.bind(globalThis.crypto) }));
        const paidConsent = GENERATION_ACTIONS.has(action) && quote ? { approved: true, outputCount: outputCount(twoUp), cost: quote.amount } : undefined;
        update({ status: 'dispatching', message: requestedAction === ACTIONS.MAKE_CANONICAL_ROLES ? 'Preparing canonical update…' : 'Preparing generation…' });
        let executionPlan = null;
        let retainReservation = false;
        try {
            const plan = planIterationAction({
                action,
                sourceArtifact: state.sourceArtifact,
                changes,
                twoUp,
                allowUnquotedSingle: options.allowUnquotedSingle === true,
                paidConsent,
                invocationId,
                reserveInvocation: options.reserveInvocation,
                releaseInvocation: options.releaseInvocation,
                generationPlan: options.generationPlan,
                verifyGenerationPlan: options.verifyGenerationPlan,
            verifyCanonicalEligibility: options.verifyCanonicalEligibility,
            });
            executionPlan = freeze({ ...clone(plan), invocationId });
            if (requestedAction === ACTIONS.MAKE_CANONICAL_ROLES) {
                if (!executionPlan.mutation || executionPlan.dispatch.network || executionPlan.dispatch.allowed) throw new TypeError('Canonical action produced an unsafe dispatch shape.');
                const saved = await persistAndReadback(executionPlan, state.originalArtifact, true);
                if (saved.status !== 'persisted') return saved;
                const retained = await verifyOriginalRetention(executionPlan);
                if (retained.status !== 'persisted') return retained;
                return update({ plan: executionPlan, artifacts: [clone(state.originalArtifact)], chosenArtifactId: state.originalArtifact.artifactId, originalArtifact: clone(state.originalArtifact), consent: { approved: false, outputCount: null }, status: 'completed', message: 'Canonical roles updated, original retained, and confirmed.' });
            }
            if (executionPlan.dispatch.allowed !== true || executionPlan.dispatch.network === true) throw new TypeError(executionPlan.dispatch.reason || 'Verified generation plan is required before dispatch.');
            const dispatched = await dispatchWithCoordinator(options.dispatchCoordinator, executionPlan, options.dispatchExecutor);
            validateDispatchReceipt(dispatched, executionPlan);
            const artifacts = artifactsFromDispatch(executionPlan, dispatched);
            update({ plan: executionPlan, artifacts, originalArtifact: clone(state.originalArtifact), status: artifacts.length === 2 ? 'awaiting-selection' : 'persisting', message: artifacts.length === 2 ? 'Choose one image to keep; the original remains retained.' : 'Saving generated image…' });
            if (artifacts.length === 2) {
                retainReservation = true;
                return stateSnapshot(state);
            }
            const saved = await persistAndReadback(executionPlan, artifacts[0], false);
            if (saved.status !== 'persisted') return saved;
            const retained = await verifyOriginalRetention(executionPlan);
            if (retained.status !== 'persisted') return retained;
            return update({ plan: executionPlan, artifacts, chosenArtifactId: artifacts[0].artifactId, originalArtifact: clone(state.originalArtifact), status: 'completed', message: 'Image saved and original retained.' });
        } catch (error) {
            return update({ status: 'error', error: error?.message || 'Iteration action failed.', message: 'No image was dispatched or committed.' });
        } finally {
            if (executionPlan && !retainReservation && typeof options.releaseInvocation === 'function') options.releaseInvocation(executionPlan.invocationId);
        }
    }

    async function chooseArtifact(artifactId) {
        if (state.status !== 'awaiting-selection' || !state.plan) return update({ status: 'error', error: 'A two-up result is required before choosing an image.' });
        try {
            const chosenPlan = chooseTwoUpArtifact(state.plan, artifactId);
            const chosen = state.artifacts.find((artifact) => artifact.artifactId === chosenPlan.retention.chosenArtifactId);
            if (!chosen) throw new TypeError('The chosen artifact is not part of this result.');
            const saved = await persistAndReadback(chosenPlan, chosen, false);
            if (saved.status !== 'persisted') return saved;
            const retained = await verifyOriginalRetention(chosenPlan);
            if (retained.status !== 'persisted') return retained;
            for (const discardId of chosenPlan.retention.discardArtifactIds || []) {
                let discarded;
                try {
                    discarded = await options.discardArtifact({ artifactId: discardId, artifact: clone(state.artifacts.find((item) => item.artifactId === discardId)), originalArtifact: clone(state.originalArtifact), plan: clone(chosenPlan) });
                } catch (error) {
                    return update({ status: 'cleanup-pending', plan: chosenPlan, artifacts: clone(state.artifacts), chosenArtifactId: chosen.artifactId, originalArtifact: clone(state.originalArtifact), error: 'Unchosen image cleanup is pending reconciliation.', reconciliation: { status: 'pending', artifactId: discardId, reason: error?.message || 'Cleanup failed.' }, message: 'The chosen image and original retention are confirmed; cleanup still needs reconciliation.' });
                }
                if (discarded?.status !== 'confirmed' || discarded.artifactId !== discardId || discarded.planId !== chosenPlan.planId || discarded.invocationId !== chosenPlan.invocationId) {
                    return update({ status: 'cleanup-pending', plan: chosenPlan, artifacts: clone(state.artifacts), chosenArtifactId: chosen.artifactId, originalArtifact: clone(state.originalArtifact), error: 'Unchosen image cleanup is pending reconciliation.', reconciliation: { status: 'pending', artifactId: discardId, reason: 'Cleanup confirmation did not match the chosen plan.' }, message: 'The chosen image and original retention are confirmed; cleanup still needs reconciliation.' });
                }
            }
            return update({ plan: chosenPlan, artifacts: clone(state.artifacts), chosenArtifactId: chosen.artifactId, discardArtifactIds: clone(chosenPlan.retention.discardArtifactIds), originalArtifact: clone(state.originalArtifact), status: 'completed', message: 'Chosen image saved, original retained, and unchosen image cleanup confirmed.' });
        } catch (error) {
            return update({ status: 'error', error: error?.message || 'Could not choose an image.' });
        } finally {
            if (typeof options.releaseInvocation === 'function') options.releaseInvocation(state.plan.invocationId);
        }
    }

    return {
        getState: () => stateSnapshot(state),
        quote: quoteAction,
        selectAction,
        preparePrompt,
        confirmRepairedPrompt,
        setEditor: (editor = {}) => update({ ...(editor.prompt !== undefined ? { prompt: String(editor.prompt) } : {}), ...(editor.sourcePassage !== undefined ? { sourcePassage: String(editor.sourcePassage) } : {}), ...(isRecord(editor.scene) ? { scene: clone(editor.scene) } : {}), ...(isRecord(editor.canonicalRoles) ? { canonicalRoles: clone(editor.canonicalRoles) } : {}), ...(isRecord(editor.composition) ? { composition: clone(editor.composition) } : {}), ...(editor.twoUp !== undefined ? { twoUp: state.twoUpAvailable === false ? false : Boolean(editor.twoUp) } : {}), status: 'editing', error: null }),
        submit,
        chooseArtifact,
        subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    };
}

function editorValue(state, name) { return state.composition?.[name] || ''; }

function textControl({ name, label, value = '', multiline = false }) {
    const control = multiline
        ? `<textarea name="${escapeHtml(name)}" aria-label="${escapeHtml(label)}" rows="3" style="min-height:44px">${escapeHtml(value)}</textarea>`
        : `<input name="${escapeHtml(name)}" aria-label="${escapeHtml(label)}" value="${escapeHtml(value)}" style="min-height:44px" />`;
    return `<label>${escapeHtml(label)}${control}</label>`;
}

function renderEditor(safe) {
    const action = normalizeIterationAction(safe.action);
    const prompt = textControl({ name: 'prompt', label: 'Prompt', value: safe.prompt, multiline: true });
    if (action === ACTIONS.VARY_SHOT) return `<fieldset data-editor-kind="composition"><legend>Composition</legend>${textControl({ name: 'framing', label: 'Framing', value: editorValue(safe, 'framing') })}${textControl({ name: 'camera', label: 'Camera', value: editorValue(safe, 'camera') })}${textControl({ name: 'focus', label: 'Focus', value: editorValue(safe, 'focus') })}</fieldset>`;
    if (action === ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE) return `<fieldset data-editor-kind="scene"><legend>New scene</legend>${textControl({ name: 'sourcePassage', label: 'Scene source passage', value: safe.sourcePassage || safe.originalArtifact?.sourcePassage?.text, multiline: true })}${prompt}${textControl({ name: 'scene.location', label: 'Current location', value: safe.scene?.location || '' })}${textControl({ name: 'scene.cast', label: 'Current cast', value: Array.isArray(safe.scene?.cast) ? safe.scene.cast.join(', ') : safe.scene?.cast || '' })}</fieldset>`;
    if (action === ACTIONS.MAKE_CANONICAL_ROLES) {
        const supported = Array.isArray(safe.supportedCanonicalRoles) ? new Set(safe.supportedCanonicalRoles) : new Set(['activeLook', 'priorScene', 'chatBackground']);
        const legacyLookId = !Array.isArray(safe.supportedCanonicalRoles) && supported.has('activeLook') ? textControl({ name: 'activeLook.lookId', label: 'Active look', value: safe.canonicalRoles?.activeLook?.lookId || '' }) : '';
        return `<fieldset data-editor-kind="canonical"><legend>Canonical roles</legend>${supported.has('activeLook') ? `${textControl({ name: 'activeLook.identityId', label: 'Active look identity', value: safe.canonicalRoles?.activeLook?.identityId || '' })}${legacyLookId}<p>The current image will be promoted through the appearance library and activated for this character.</p>` : ''}${supported.has('priorScene') ? textControl({ name: 'priorScene', label: 'Prior scene', value: safe.canonicalRoles?.priorScene || '', multiline: true }) : ''}${supported.has('chatBackground') ? textControl({ name: 'chatBackground', label: 'Chat background', value: safe.canonicalRoles?.chatBackground || '', multiline: true }) : ''}</fieldset>`;
    }
    return `<fieldset data-editor-kind="prompt"><legend>${action === ACTIONS.RETRY_REPAIRED_PROMPT ? 'Repaired prompt' : 'Prompt'}</legend>${prompt}</fieldset>`;
}

function renderRepair(safe) {
    if (safe.repairedPrompt?.status !== 'repaired') return '';
    if (safe.repairedPromptConfirmed) return `<p data-repaired-confirmed>Repaired prompt confirmed. Retry repaired prompt when ready.</p>`;
    return `<section class="cig-rp-repair" aria-labelledby="cig-rp-repair-title"><h3 id="cig-rp-repair-title">Repaired prompt</h3><p data-repaired-preview>${escapeHtml(safe.repairedPrompt.repairedPrompt)}</p><button type="button" data-iteration-action="confirm-repaired-prompt" style="min-height:44px">Confirm repaired prompt</button></section>`;
}

export function renderIterationSurface(state = {}) {
    const safe = { ...initialState(state.originalArtifact || { artifactId: 'artifact:unknown' }), ...clone(state) };
    const busy = BUSY_STATES.has(safe.status);
    const showRetry = safe.repairedPrompt?.status === 'repaired';
    const buttons = Object.entries(ACTION_LABELS).filter(([action]) => action !== ACTIONS.RETRY_REPAIRED_PROMPT || showRetry).map(([action, label]) => `<button type="button" class="cig-rp-iteration-action" data-iteration-action="${escapeHtml(action)}" data-iteration-select="true" aria-pressed="${safe.action === action ? 'true' : 'false'}" style="min-height:44px"${busy ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(label)}</button>`).join('');
    const displayedQuote = safe.quote;
    const cost = !displayedQuote || typeof displayedQuote.amount !== 'number' ? '<span class="cig-rp-cost-unavailable">Cost unavailable; generation blocked.</span>' : `<span>Estimated cost: ${escapeHtml(formatCost(displayedQuote.amount, displayedQuote.currency))} for ${outputCount(safe.twoUp)} image${safe.twoUp ? 's' : ''}${displayedQuote.expiresAt ? ` (expires ${escapeHtml(displayedQuote.expiresAt)})` : ''}.</span>`;
    const chooser = '';
    const repair = renderRepair(safe);
    const retention = safe.originalRetention?.status === 'confirmed' ? 'Original retained and verified' : 'Original retention pending verification';
    const submitLabel = safe.action === ACTIONS.MAKE_CANONICAL_ROLES ? 'Apply canonical roles' : 'Generate';
    const twoUpControl = safe.twoUpAvailable === false
        ? '<p class="cig-rp-two-up-unavailable" data-two-up-unavailable>Two-up is unavailable until two distinct provider outputs and a real chooser are implemented.</p>'
        : `<label><input type="checkbox" name="twoUp" style="min-height:44px"${safe.twoUp ? ' checked' : ''} /> Generate two-up</label>`;
    const consentControl = safe.singleOutputUnquoted ? '<span>Single-output Improve does not require a cost quote before Submit.</span>' : '<label><input type="checkbox" name="paidConsent" style="min-height:44px" /> I approve this estimate</label>';
    return `<section class="cig-rp-iteration-surface" data-cig-rp-iteration-surface aria-busy="${busy ? 'true' : 'false'}"><div class="cig-rp-status" role="status" aria-live="polite">${escapeHtml(safe.message || '')}</div>${safe.error ? `<div role="alert">${escapeHtml(safe.error)}</div>` : ''}<p data-original-retention-status>${escapeHtml(retention)}: <code>${escapeHtml(safe.originalArtifact?.artifactId || 'unknown')}</code></p>${renderEditor(safe)}<fieldset><legend>Generation options</legend>${twoUpControl}${consentControl}<div class="cig-rp-cost" aria-live="polite">${cost}</div></fieldset><div class="cig-rp-actions" aria-label="Iteration actions">${buttons}<button type="button" data-iteration-submit="true" style="min-height:44px"${busy || !safe.action ? ' disabled aria-disabled="true"' : ''}>${submitLabel}</button></div><div data-repair-region>${repair}</div>${chooser}</section>`;
}

function updateDraftProjection(host, state, focusedElement, selection) {
    const region = host.querySelector?.('[data-repair-region]');
    if (region) region.innerHTML = renderRepair(state);
    const status = host.querySelector?.('.cig-rp-status');
    if (status) status.textContent = state.message || '';
    if (focusedElement && selection && typeof focusedElement.setSelectionRange === 'function') {
        try { focusedElement.setSelectionRange(selection.start, selection.end); } catch { /* field may have been detached by host */ }
    }
}

export function mountIterationSurface(host, controller) {
    if (!host || typeof host !== 'object' || typeof host.addEventListener !== 'function' || typeof host.removeEventListener !== 'function') throw new TypeError('A host element is required.');
    if (!controller || typeof controller.getState !== 'function') throw new TypeError('An iteration surface controller is required.');
    const read = (selector, fallback) => host.querySelector?.(selector)?.value ?? fallback;
    const readChecked = (selector, fallback) => host.querySelector?.(selector)?.checked ?? fallback;
    const structuralKey = (state) => JSON.stringify({ action: state.action, quoteId: state.quote?.quoteId || null, artifacts: state.artifacts?.map((artifact) => artifact.artifactId), retention: state.originalRetention?.status || null });
    let lastStructuralKey = structuralKey(controller.getState());
    const render = () => { host.innerHTML = renderIterationSurface(controller.getState()); lastStructuralKey = structuralKey(controller.getState()); return host.innerHTML; };
    const click = (event) => {
        const target = event.target?.closest?.('[data-iteration-submit],[data-iteration-action],[data-iteration-artifact-id]');
        if (!target) return;
        event.preventDefault?.();
        const artifactId = target.getAttribute?.('data-iteration-artifact-id');
        if (artifactId) { void controller.chooseArtifact(artifactId).then(render); return; }
        const action = target.getAttribute?.('data-iteration-action');
        if (action === 'confirm-repaired-prompt') { controller.confirmRepairedPrompt(); render(); return; }
        if (target.getAttribute?.('data-iteration-submit') !== 'true') { controller.selectAction(action); render(); return; }
        const current = controller.getState();
        const selectedAction = action || current.action;
        const twoUp = readChecked('[name="twoUp"]', current.twoUp);
        const quote = current.quote;
        const consent = { approved: readChecked('[name="paidConsent"]', false), outputCount: outputCount(twoUp), ...(quote ? { quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } : {}) };
        const changes = {};
        if (selectedAction === ACTIONS.VARY_SHOT) changes.composition = { framing: read('[name="framing"]', ''), camera: read('[name="camera"]', ''), focus: read('[name="focus"]', '') };
        if (selectedAction === ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE) changes.sourcePassage = read('[name="sourcePassage"]', '');
        if (selectedAction === ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE || selectedAction === ACTIONS.EDIT_REGENERATE || selectedAction === ACTIONS.RETRY_REPAIRED_PROMPT) changes.prompt = read('[name="prompt"]', current.prompt);
        if (selectedAction === ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE) changes.scene = { location: read('[name="scene.location"]', ''), cast: read('[name="scene.cast"]', '') };
        if (selectedAction === ACTIONS.MAKE_CANONICAL_ROLES) {
            const identityId = read('[name="activeLook.identityId"]', '');
            const roles = {};
            const supported = Array.isArray(current.supportedCanonicalRoles) ? new Set(current.supportedCanonicalRoles) : new Set(['activeLook', 'priorScene', 'chatBackground']);
            const lookId = Array.isArray(current.supportedCanonicalRoles) ? '' : read('[name="activeLook.lookId"]', '');
            if (identityId) roles.activeLook = { identityId, ...(lookId ? { lookId } : {}) };
            const priorScene = supported.has('priorScene') ? read('[name="priorScene"]', '') : '';
            const chatBackground = supported.has('chatBackground') ? read('[name="chatBackground"]', '') : '';
            if (priorScene) roles.priorScene = priorScene;
            if (chatBackground) roles.chatBackground = chatBackground;
            changes.roles = roles;
        }
        void controller.submit({ action: selectedAction, prompt: read('[name="prompt"]', current.prompt), twoUp, changes, consent }).then(render);
    };
    const edit = (event) => {
        const target = event.target;
        if (!target?.name) return;
        const selection = target.name === 'prompt' && Number.isInteger(target.selectionStart) ? { start: target.selectionStart, end: target.selectionEnd } : null;
        if (target.name === 'prompt') { controller.preparePrompt(target.value); updateDraftProjection(host, controller.getState(), target, selection); return; }
        const current = controller.getState();
        if (target.name === 'twoUp') { controller.setEditor({ twoUp: target.checked }); return; }
        if (['framing', 'camera', 'focus'].includes(target.name)) controller.setEditor({ composition: { ...current.composition, [target.name]: target.value } });
        if (target.name === 'sourcePassage') controller.setEditor({ sourcePassage: target.value });
        if (target.name === 'scene.location') controller.setEditor({ scene: { ...current.scene, location: target.value } });
        if (target.name === 'scene.cast') controller.setEditor({ scene: { ...current.scene, cast: target.value } });
        if (target.name === 'activeLook.identityId' || target.name === 'activeLook.lookId') controller.setEditor({ canonicalRoles: { ...current.canonicalRoles, activeLook: { ...(current.canonicalRoles?.activeLook || {}), [target.name.endsWith('identityId') ? 'identityId' : 'lookId']: target.value } } });
        if (target.name === 'priorScene' || target.name === 'chatBackground') controller.setEditor({ canonicalRoles: { ...current.canonicalRoles, [target.name]: target.value } });
    };
    host.addEventListener('click', click);
    host.addEventListener('input', edit);
    host.addEventListener('change', edit);
    const unsubscribe = controller.subscribe((nextState) => { const nextKey = structuralKey(nextState); if (nextKey !== lastStructuralKey) render(); });
    render();
    return { render, destroy() { unsubscribe(); host.removeEventListener('click', click); host.removeEventListener('input', edit); host.removeEventListener('change', edit); } };
}

export const ITERATION_SURFACE_STYLE_ID = 'cig-rp-iteration-styles';
export const ITERATION_SURFACE_CSS = '.cig-rp-iteration-action,.cig-rp-two-up button,[data-iteration-action="confirm-repaired-prompt"],.cig-rp-iteration-surface input,.cig-rp-iteration-surface textarea,.cig-rp-iteration-surface select{min-height:44px;touch-action:manipulation}.cig-rp-iteration-action:focus-visible,.cig-rp-two-up button:focus-visible,[data-iteration-action="confirm-repaired-prompt"]:focus-visible,.cig-rp-iteration-surface input:focus-visible,.cig-rp-iteration-surface textarea:focus-visible,.cig-rp-iteration-surface select:focus-visible{outline:2px solid currentColor;outline-offset:2px}';

export function installIterationSurfaceStyles(documentLike = globalThis.document, styleId = ITERATION_SURFACE_STYLE_ID) {
    if (!documentLike?.head || typeof documentLike.createElement !== 'function') return false;
    let style = documentLike.getElementById?.(styleId);
    if (!style) { style = documentLike.createElement('style'); style.id = styleId; documentLike.head.appendChild(style); }
    style.textContent = ITERATION_SURFACE_CSS;
    return true;
}

export function uninstallIterationSurfaceStyles(documentLike = globalThis.document, styleId = ITERATION_SURFACE_STYLE_ID) {
    const style = documentLike?.getElementById?.(styleId);
    if (!style || !style.parentNode && !documentLike?.head?.removeChild) return false;
    if (style.parentNode?.removeChild) style.parentNode.removeChild(style); else documentLike.head.removeChild(style);
    return true;
}

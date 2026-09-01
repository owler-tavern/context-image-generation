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
function formatCost(cost) { return `$${Number(cost).toFixed(2)}`; }
function outputCount(twoUp) { return twoUp ? 2 : 1; }
function dependencyError(name) { return `Required ${name} dependency is unavailable; generation is blocked.`; }
function normalizeCost(value) {
    const cost = typeof value === 'number' ? value : value?.cost ?? value?.estimatedCost;
    return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}
function stateSnapshot(state) { return freeze(clone(state)); }

function initialState(sourceArtifact) {
    const original = clone(sourceArtifact);
    return {
        status: 'idle',
        message: 'Choose an iteration action.',
        error: null,
        action: null,
        prompt: clean(sourceArtifact?.effectivePrompt),
        composition: {},
        twoUp: false,
        cost: null,
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
    const outputs = Array.isArray(dispatched?.artifacts) && dispatched.artifacts.length ? dispatched.artifacts : plan.artifacts;
    return plan.artifacts.map((planned, index) => mergeOutputArtifact(planned, outputs[index]));
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
    const state = initialState(sourceArtifact);
    const listeners = new Set();
    let invocationSequence = 0;

    function update(patch) {
        Object.assign(state, clone(patch));
        const snapshot = stateSnapshot(state);
        for (const listener of listeners) {
            try { listener(snapshot); } catch { /* observer isolation */ }
        }
        return snapshot;
    }

    function missingDependencies(action) {
        const missing = [];
        if (typeof options.verifyGenerationPlan !== 'function') missing.push('verifyGenerationPlan');
        if (!isRecord(options.generationPlan)) missing.push('generationPlan');
        if (typeof options.reserveInvocation !== 'function') missing.push('reserveInvocation');
        if (GENERATION_ACTIONS.has(action)) {
            if (typeof options.estimateCost !== 'function') missing.push('estimateCost');
            if (!options.dispatchCoordinator || (typeof options.dispatchCoordinator !== 'function' && typeof options.dispatchCoordinator.dispatch !== 'function' && typeof options.dispatchCoordinator.enqueue !== 'function')) missing.push('dispatchCoordinator');
            if (typeof options.persistArtifact !== 'function') missing.push('persistArtifact');
            if (typeof options.readbackArtifact !== 'function') missing.push('readbackArtifact');
        }
        if (action === ACTIONS.MAKE_CANONICAL_ROLES) {
            if (typeof options.verifyCanonicalEligibility !== 'function') missing.push('verifyCanonicalEligibility');
            if (typeof options.mutateCanonical !== 'function' && typeof options.mutateCanonical?.mutate !== 'function') missing.push('mutateCanonical');
            if (typeof options.readbackCanonical !== 'function') missing.push('readbackCanonical');
        }
        return missing;
    }

    async function quote({ action, twoUp = state.twoUp, changes = {} } = {}) {
        const normalizedAction = normalizeIterationAction(action || state.action);
        if (!GENERATION_ACTIONS.has(normalizedAction)) return { outputCount: 0, cost: null, finite: true };
        if (typeof options.estimateCost !== 'function') return { outputCount: outputCount(twoUp), cost: null, finite: false, error: dependencyError('estimateCost') };
        try {
            const count = outputCount(twoUp);
            const estimate = await options.estimateCost({ action: normalizedAction, sourceArtifact: clone(state.sourceArtifact), changes: clone(changes), outputCount: count });
            const cost = normalizeCost(estimate);
            const result = { outputCount: count, cost, finite: cost !== null };
            update({ action: normalizedAction, twoUp: Boolean(twoUp), cost, message: cost === null ? 'Cost unavailable; generation is blocked.' : `Estimated cost: ${formatCost(cost)} for ${count} image${count === 1 ? '' : 's'}.` });
            return result;
        } catch (error) {
            update({ cost: null, status: 'error', error: error?.message || 'Cost estimate failed.' });
            return { outputCount: outputCount(twoUp), cost: null, finite: false, error: error?.message || 'Cost estimate failed.' };
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

    async function persistAndReadback(plan, artifact, canonical = false) {
        update({ status: 'persisting', message: canonical ? 'Saving canonical roles…' : 'Saving selected image…', error: null });
        const persist = canonical
            ? await invokeMutation(options.mutateCanonical, { plan, mutation: plan.mutation, sourceArtifact: clone(state.originalArtifact) }, 'mutateCanonical')
            : await options.persistArtifact({ artifact: clone(artifact), originalArtifact: clone(state.originalArtifact), sourceArtifact: clone(state.sourceArtifact), plan: clone(plan) });
        const verification = canonical
            ? await options.readbackCanonical({ plan: clone(plan), mutation: clone(plan.mutation), sourceArtifact: clone(state.originalArtifact), persisted: clone(persist) })
            : await options.readbackArtifact({ artifact: clone(artifact), originalArtifact: clone(state.originalArtifact), plan: clone(plan), persisted: clone(persist) });
        if (verification?.status !== 'confirmed') {
            return update({ status: 'error', verification: clone(verification), error: canonical ? 'Canonical read-back was not confirmed.' : 'Image read-back was not confirmed.', message: 'The change was not confirmed; the original remains retained.' });
        }
        return update({ status: 'completed', verification: clone(verification), message: canonical ? 'Canonical roles updated and confirmed.' : 'Image saved and confirmed.', error: null });
    }

    async function submit(input = {}) {
        const requestedAction = normalizeIterationAction(input.action || state.action);
        if (!Object.values(ACTIONS).includes(requestedAction)) return update({ status: 'error', error: 'Choose a supported iteration action.' });
        if (requestedAction === ACTIONS.RETRY_REPAIRED_PROMPT && state.repairedPrompt?.status === 'repaired' && !state.repairedPromptConfirmed) {
            return update({ action: requestedAction, status: 'draft-review', message: 'Confirm the repaired prompt before generating.' });
        }
        const action = requestedAction === ACTIONS.RETRY_REPAIRED_PROMPT ? ACTIONS.EDIT_REGENERATE : requestedAction;
        const missing = missingDependencies(action);
        if (missing.length) return update({ action: requestedAction, status: 'error', error: missing.map(dependencyError).join(' '), message: 'Generation is blocked until its authoritative dependencies are available.' });
        const twoUp = input.twoUp === undefined ? state.twoUp : Boolean(input.twoUp);
        const changes = actionChanges(state, input, requestedAction);
        update({ action: requestedAction, twoUp, consent: clone(input.consent || state.consent), error: null });

        let cost = null;
        if (GENERATION_ACTIONS.has(action)) {
            const estimate = await quote({ action, twoUp, changes });
            cost = estimate.cost;
            if (!estimate.finite) return update({ status: 'error', error: estimate.error || 'Finite cost estimate is required.' });
            const consent = isRecord(input.consent) ? input.consent : state.consent;
            const count = outputCount(twoUp);
            if (consent.approved !== true || Number(consent.outputCount) !== count) {
                return update({ status: 'consent-required', cost, consent: { approved: consent.approved === true, outputCount: Number.isInteger(consent.outputCount) ? consent.outputCount : null }, message: `Confirm the finite estimate ${formatCost(cost)} for ${count} image${count === 1 ? '' : 's'}.` });
            }
        }

        const invocationId = clean(input.invocationId || options.invocationId) || (typeof options.createInvocationId === 'function' ? clean(options.createInvocationId()) : createIterationInvocationId({ randomUUID: options.randomUUID || globalThis.crypto?.randomUUID?.bind(globalThis.crypto) }));
        const paidConsent = GENERATION_ACTIONS.has(action) ? { approved: true, outputCount: outputCount(twoUp), cost } : undefined;
        update({ status: 'dispatching', message: requestedAction === ACTIONS.MAKE_CANONICAL_ROLES ? 'Preparing canonical update…' : 'Preparing generation…' });
        try {
            const plan = planIterationAction({
                action,
                sourceArtifact: state.sourceArtifact,
                changes,
                twoUp,
                paidConsent,
                invocationId: invocationId || `ui:${++invocationSequence}`,
                reserveInvocation: options.reserveInvocation,
                generationPlan: options.generationPlan,
                verifyGenerationPlan: options.verifyGenerationPlan,
                verifyCanonicalEligibility: options.verifyCanonicalEligibility,
            });
            if (requestedAction === ACTIONS.MAKE_CANONICAL_ROLES) {
                if (!plan.mutation || plan.dispatch.network || plan.dispatch.allowed) throw new TypeError('Canonical action produced an unsafe dispatch shape.');
                const completed = await persistAndReadback(plan, state.originalArtifact, true);
                return update({ plan, artifacts: [clone(state.originalArtifact)], chosenArtifactId: state.originalArtifact.artifactId, originalArtifact: clone(state.originalArtifact), consent: { approved: false, outputCount: null }, ...completed });
            }
            if (plan.dispatch.allowed !== true || plan.dispatch.network === true) throw new TypeError(plan.dispatch.reason || 'Verified generation plan is required before dispatch.');
            const dispatched = await dispatchWithCoordinator(options.dispatchCoordinator, plan, options.dispatchExecutor);
            if (dispatched?.status === 'failed' || dispatched?.status === 'cancelled') throw new Error(dispatched.error || 'Generation dispatch failed.');
            const artifacts = artifactsFromDispatch(plan, dispatched);
            update({ plan, artifacts, originalArtifact: clone(state.originalArtifact), status: artifacts.length === 2 ? 'awaiting-selection' : 'persisting', message: artifacts.length === 2 ? 'Choose one image to keep; the original remains retained.' : 'Saving generated image…' });
            if (artifacts.length === 2) return stateSnapshot(state);
            const completed = await persistAndReadback(plan, artifacts[0], false);
            return update({ ...completed, plan, artifacts, chosenArtifactId: artifacts[0].artifactId, originalArtifact: clone(state.originalArtifact) });
        } catch (error) {
            return update({ status: 'error', error: error?.message || 'Iteration action failed.', message: 'No image was dispatched or committed.' });
        }
    }

    async function chooseArtifact(artifactId) {
        if (state.status !== 'awaiting-selection' || !state.plan) return update({ status: 'error', error: 'A two-up result is required before choosing an image.' });
        try {
            const chosenPlan = chooseTwoUpArtifact(state.plan, artifactId);
            const chosen = state.artifacts.find((artifact) => artifact.artifactId === chosenPlan.retention.chosenArtifactId);
            if (!chosen) throw new TypeError('The chosen artifact is not part of this result.');
            const completed = await persistAndReadback(chosenPlan, chosen, false);
            return update({ ...completed, plan: chosenPlan, artifacts: clone(state.artifacts), chosenArtifactId: chosen.artifactId, discardArtifactIds: clone(chosenPlan.retention.discardArtifactIds), originalArtifact: clone(state.originalArtifact) });
        } catch (error) {
            return update({ status: 'error', error: error?.message || 'Could not choose an image.' });
        }
    }

    return {
        getState: () => stateSnapshot(state),
        quote,
        preparePrompt,
        confirmRepairedPrompt,
        setEditor: (editor = {}) => update({ ...(editor.prompt !== undefined ? { prompt: String(editor.prompt) } : {}), ...(isRecord(editor.composition) ? { composition: clone(editor.composition) } : {}), ...(editor.twoUp !== undefined ? { twoUp: Boolean(editor.twoUp) } : {}), status: 'editing', error: null }),
        submit,
        chooseArtifact,
        subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    };
}

function editorValue(state, name) { return state.composition?.[name] || ''; }

export function renderIterationSurface(state = {}) {
    const safe = { ...initialState(state.originalArtifact || { artifactId: 'artifact:unknown' }), ...clone(state) };
    const busy = BUSY_STATES.has(safe.status);
    const buttons = Object.entries(ACTION_LABELS).map(([action, label]) => `<button type="button" class="cig-rp-iteration-action" data-iteration-action="${escapeHtml(action)}" style="min-height:44px"${busy ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(label)}</button>`).join('');
    const cost = safe.cost === null ? '<span class="cig-rp-cost-unavailable">Cost unavailable; generation blocked.</span>' : `<span>Estimated cost: ${escapeHtml(formatCost(safe.cost))} for ${outputCount(safe.twoUp)} image${safe.twoUp ? 's' : ''}.</span>`;
    const chooser = safe.status === 'awaiting-selection' ? `<section aria-labelledby="cig-rp-chooser-title"><h3 id="cig-rp-chooser-title">Choose one to keep</h3><div class="cig-rp-two-up">${safe.artifacts.map((artifact, index) => `<button type="button" data-iteration-artifact-id="${escapeHtml(artifact.artifactId)}" style="min-height:44px" aria-label="Keep image ${index + 1}">Keep image ${index + 1}</button>`).join('')}</div></section>` : '';
    const repair = safe.repairedPrompt?.status === 'repaired' && !safe.repairedPromptConfirmed ? `<section class="cig-rp-repair" aria-labelledby="cig-rp-repair-title"><h3 id="cig-rp-repair-title">Repaired prompt</h3><p>${escapeHtml(safe.repairedPrompt.repairedPrompt)}</p><button type="button" data-iteration-action="confirm-repaired-prompt" style="min-height:44px">Confirm repaired prompt</button></section>` : '';
    return `<section data-cig-rp-iteration-surface aria-busy="${busy ? 'true' : 'false'}"><div role="status" aria-live="polite">${escapeHtml(safe.message || '')}</div>${safe.error ? `<div role="alert">${escapeHtml(safe.error)}</div>` : ''}<p>Original retained: <code>${escapeHtml(safe.originalArtifact?.artifactId || 'unknown')}</code></p><fieldset><legend>Prompt and composition</legend><label>Prompt<textarea name="prompt" aria-label="Prompt" rows="3">${escapeHtml(safe.prompt)}</textarea></label><label>Framing<input name="framing" value="${escapeHtml(editorValue(safe, 'framing'))}" /></label><label>Camera<input name="camera" value="${escapeHtml(editorValue(safe, 'camera'))}" /></label><label>Focus<input name="focus" value="${escapeHtml(editorValue(safe, 'focus'))}" /></label><label><input type="checkbox" name="twoUp"${safe.twoUp ? ' checked' : ''} /> Generate two-up</label><label><input type="checkbox" name="paidConsent" /> I approve this estimate</label><div class="cig-rp-cost" aria-live="polite">${cost}</div></fieldset><div class="cig-rp-actions" aria-label="Iteration actions">${buttons}</div>${repair}${chooser}</section>`;
}

export function mountIterationSurface(host, controller) {
    if (!host || typeof host !== 'object' || typeof host.addEventListener !== 'function' || typeof host.removeEventListener !== 'function') throw new TypeError('A host element is required.');
    if (!controller || typeof controller.getState !== 'function') throw new TypeError('An iteration surface controller is required.');
    const read = (selector, fallback) => host.querySelector?.(selector)?.value ?? fallback;
    const readChecked = (selector, fallback) => host.querySelector?.(selector)?.checked ?? fallback;
    const render = () => { host.innerHTML = renderIterationSurface(controller.getState()); return host.innerHTML; };
    const click = (event) => {
        const target = event.target?.closest?.('[data-iteration-action],[data-iteration-artifact-id]');
        if (!target) return;
        event.preventDefault?.();
        const artifactId = target.getAttribute?.('data-iteration-artifact-id');
        if (artifactId) { void controller.chooseArtifact(artifactId).then(render); return; }
        const action = target.getAttribute?.('data-iteration-action');
        if (action === 'confirm-repaired-prompt') { controller.confirmRepairedPrompt(); render(); return; }
        const current = controller.getState();
        const twoUp = readChecked('[name="twoUp"]', current.twoUp);
        const consent = { approved: readChecked('[name="paidConsent"]', false), outputCount: outputCount(twoUp) };
        const composition = { framing: read('[name="framing"]', ''), camera: read('[name="camera"]', ''), focus: read('[name="focus"]', '') };
        void controller.submit({ action, prompt: read('[name="prompt"]', current.prompt), twoUp, changes: { composition }, consent }).then(render);
    };
    host.addEventListener('click', click);
    const unsubscribe = controller.subscribe(() => render());
    render();
    return { render, destroy() { unsubscribe(); host.removeEventListener('click', click); } };
}

export const ITERATION_SURFACE_CSS = '.cig-rp-iteration-action,.cig-rp-two-up button,[data-iteration-action="confirm-repaired-prompt"]{min-height:44px;touch-action:manipulation}.cig-rp-iteration-action:focus-visible,.cig-rp-two-up button:focus-visible,[data-iteration-action="confirm-repaired-prompt"]:focus-visible{outline:2px solid currentColor;outline-offset:2px}';

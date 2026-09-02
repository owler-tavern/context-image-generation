export function createOptionalFeatureLifecycle({ load, setup = () => undefined, teardown = () => undefined, onError = () => undefined } = {}) {
    if (typeof load !== 'function') throw new TypeError('Optional feature lifecycle requires a load function.');

    let enabled = false;
    let generation = 0;
    let pending = null;
    let resource = null;
    let resourceGeneration = null;
    let cleanup = null;

    async function release(current = resource, currentGeneration = resourceGeneration) {
        if (!current || cleanup) return cleanup;
        const work = Promise.resolve()
            .then(() => teardown(current.value, current.feature))
            .catch((error) => { onError(error); })
            .finally(() => {
                if (resource === current && resourceGeneration === currentGeneration) {
                    resource = null;
                    resourceGeneration = null;
                }
                if (cleanup === work) cleanup = null;
            });
        cleanup = work;
        return work;
    }

    function enable() {
        if (!enabled) {
            enabled = true;
            generation += 1;
        }
        if (pending) return pending;
        if (resource) return Promise.resolve({ status: 'ready' });

        const capturedGeneration = generation;
        const work = (async () => {
            try {
                const feature = await load();
                if (!enabled || generation !== capturedGeneration) return { status: 'disabled' };
                const value = await setup(feature);
                const capturedResource = { feature, value };
                if (!enabled || generation !== capturedGeneration) {
                    await release(capturedResource, capturedGeneration);
                    return { status: 'disabled' };
                }
                resource = capturedResource;
                resourceGeneration = capturedGeneration;
                return { status: 'ready' };
            } catch (error) {
                if (enabled && generation === capturedGeneration) onError(error);
                return { status: 'failed' };
            }
        })();
        pending = work;
        work.finally(() => { if (pending === work) pending = null; });
        return work;
    }

    async function disable() {
        enabled = false;
        generation += 1;
        const pendingAtDisable = pending;
        if (pendingAtDisable) await pendingAtDisable;
        if (resource && resourceGeneration < generation) await release(resource, resourceGeneration);
        return { status: 'disabled' };
    }

    async function run(action) {
        const state = await enable();
        if (state.status !== 'ready' || !enabled) return state;
        try {
            await action(resource?.feature);
            return { status: 'completed' };
        } catch (error) {
            onError(error);
            return { status: 'failed' };
        }
    }

    return { enable, disable, run, isEnabled: () => enabled };
}

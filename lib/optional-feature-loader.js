const FEATURE_NAMES = new Set(['iteration', 'storyMemory', 'cinematic', 'director']);

export function createOptionalFeatureLoader(loaders = {}) {
    const cached = new Map();

    function assertFeatureName(name) {
        if (!FEATURE_NAMES.has(name)) throw new Error(`Unknown optional feature: ${name}`);
    }

    function load(name) {
        if (!FEATURE_NAMES.has(name)) return Promise.reject(new Error(`Unknown optional feature: ${name}`));
        if (cached.has(name)) return cached.get(name);
        const loader = loaders[name];
        if (typeof loader !== 'function') return Promise.reject(new Error(`No optional feature loader configured for: ${name}`));

        const promise = Promise.resolve().then(loader);
        cached.set(name, promise);
        promise.catch(() => {
            if (cached.get(name) === promise) cached.delete(name);
        });
        return promise;
    }

    function peek(name) {
        assertFeatureName(name);
        return cached.get(name);
    }

    function clear(name) {
        assertFeatureName(name);
        cached.delete(name);
    }

    return { load, peek, clear };
}

/**
 * A small Map-like cache that keeps recently used entries while allowing
 * callers to protect active work from eviction.
 */
export function createBoundedRecencyMap({ maxEntries, isProtected = () => false } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 0) throw new TypeError('maxEntries must be a non-negative integer.');
    if (typeof isProtected !== 'function') throw new TypeError('isProtected must be a function.');

    const entries = new Map();
    const compact = () => {
        while (entries.size > maxEntries) {
            const evictable = [...entries.entries()].find(([key, value]) => isProtected(key, value) !== true);
            if (!evictable) break;
            entries.delete(evictable[0]);
        }
    };
    const refresh = (key, value) => {
        entries.delete(key);
        entries.set(key, value);
    };

    return {
        get size() { compact(); return entries.size; },
        get(key) {
            compact();
            if (!entries.has(key)) return undefined;
            const value = entries.get(key);
            refresh(key, value);
            return value;
        },
        set(key, value) {
            refresh(key, value);
            compact();
            return this;
        },
        delete(key) {
            const deleted = entries.delete(key);
            compact();
            return deleted;
        },
        entries() { compact(); return entries.entries(); },
        clear() { entries.clear(); },
        has(key) { compact(); return entries.has(key); },
    };
}

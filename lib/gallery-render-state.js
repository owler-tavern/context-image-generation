export function createGalleryRenderState({ isVisible, renderAll, prependOne }) {
    let dirty = true;

    function markDirty() {
        dirty = true;
    }

    function refresh({ force = false } = {}) {
        if (!isVisible()) {
            if (force) dirty = true;
            return false;
        }
        if (!dirty && !force) return false;
        dirty = true;
        renderAll();
        dirty = false;
        return true;
    }

    function add(item) {
        if (!isVisible() || dirty) {
            dirty = true;
            return false;
        }
        try {
            prependOne(item);
            return true;
        } catch (error) {
            dirty = true;
            throw error;
        }
    }

    return { markDirty, refresh, add, isDirty: () => dirty };
}

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

export function canIncrementallyPrependGalleryItem({ previouslyRendered, gallery, insertedItem }) {
    if (!Array.isArray(previouslyRendered) || !Array.isArray(gallery)) return false;
    if (gallery[0] !== insertedItem || gallery.length !== previouslyRendered.length + 1) return false;
    return previouslyRendered.every((item, index) => gallery[index + 1] === item);
}

export function reindexGalleryTileActionTargets(tiles, setIndex) {
    for (const [index, { tile, actions = [] }] of tiles.entries()) {
        setIndex(tile, index);
        for (const action of actions) setIndex(action, index);
    }
}

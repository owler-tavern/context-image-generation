const DIRECTIONS = new Set(['previous', 'next']);

function normalizeIndex(value, maximum) {
    const numeric = Number.isFinite(value) ? Math.trunc(value) : 0;
    return Math.max(0, Math.min(numeric, maximum));
}

export function decideImageNavigation({
    direction,
    currentIndex,
    mediaLength,
    generatePastLast = false,
    generationActive = false,
} = {}) {
    if (!DIRECTIONS.has(direction)) return { action: 'ignore', reason: 'invalid-direction' };
    if (!Number.isInteger(mediaLength)) return { action: 'ignore', reason: 'invalid-media-length' };
    if (mediaLength <= 0) return { action: 'ignore', reason: 'no-media' };

    const index = normalizeIndex(currentIndex, mediaLength - 1);
    if (direction === 'previous') {
        return index === 0
            ? { action: 'stay', index, reason: 'at-first-image' }
            : { action: 'navigate', index: index - 1 };
    }

    if (index < mediaLength - 1) return { action: 'navigate', index: index + 1 };
    if (generationActive) return { action: 'stay', index, reason: 'generation-active' };
    if (generatePastLast) return { action: 'generate' };
    return { action: 'stay', index, reason: 'generation-disabled' };
}

export function navigationDirectionForGesture(type) {
    if (type === 'swiped-left') return 'next';
    if (type === 'swiped-right') return 'previous';
    return null;
}

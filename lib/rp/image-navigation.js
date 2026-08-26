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

export function handleImageGesture({ event, gesturesEnabled, resolveArrow } = {}) {
    if (!gesturesEnabled) return false;
    const direction = navigationDirectionForGesture(event?.type);
    if (!direction) return false;
    const arrow = resolveArrow?.(direction);
    if (!arrow?.click) return false;

    event.preventDefault();
    event.stopPropagation();
    arrow.click();
    return true;
}

export function handleImageArrowNavigation({
    owned,
    event,
    direction,
    currentIndex,
    mediaLength,
    generatePastLast,
    generationActive,
    schedule,
    reconfigure,
    generate,
} = {}) {
    if (!owned) return { action: 'ignore', reason: 'not-cig-owned' };

    const decision = decideImageNavigation({
        direction,
        currentIndex,
        mediaLength,
        generatePastLast,
        generationActive,
    });
    if (decision.action === 'navigate') {
        if (typeof schedule === 'function' && typeof reconfigure === 'function') schedule(reconfigure);
        return decision;
    }
    if (decision.action === 'ignore') return decision;

    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (decision.action === 'generate') generate?.();
    return decision;
}

export function scheduleImageArrowConfiguration({ schedule, reconfigure } = {}) {
    if (typeof schedule !== 'function' || typeof reconfigure !== 'function') return false;
    schedule(reconfigure);
    return true;
}

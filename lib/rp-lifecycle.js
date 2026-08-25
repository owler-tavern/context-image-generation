export function createChatLifecycleEpoch() {
    let epoch = 0;

    return {
        advance() {
            epoch += 1;
            return epoch;
        },
        capture() {
            return epoch;
        },
        isCurrent(captured) {
            return captured === epoch;
        },
    };
}

export function bindAppearanceRerenderOnChatLifecycle(eventSource, eventTypes, rerender) {
    if (!eventSource?.on || typeof rerender !== 'function') return;
    for (const type of [eventTypes?.CHAT_CHANGED, eventTypes?.CHAT_CREATED]) {
        if (type) eventSource.on(type, rerender);
    }
}

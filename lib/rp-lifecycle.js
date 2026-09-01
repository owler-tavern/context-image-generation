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

function snapshotJsonSafe(value) {
    if (value === undefined) return undefined;
    try {
        return structuredClone(value);
    } catch {
        return JSON.parse(JSON.stringify(value));
    }
}

/**
 * Owns chat-canon hydration for the supported lifecycle. The controller keeps
 * no chat state: every refresh reads the host's active context again, and an
 * epoch gate prevents a slow A read from rendering after A -> B -> A.
 */
export function createAppearanceLifecycleController({
    eventSource,
    eventTypes,
    lifecycle,
    readActiveContext,
    render,
}) {
    if (!lifecycle?.advance || !lifecycle?.capture || !lifecycle?.isCurrent) {
        throw new TypeError('A chat lifecycle epoch is required.');
    }
    if (typeof readActiveContext !== 'function' || typeof render !== 'function') {
        throw new TypeError('Active-context reader and renderer are required.');
    }

    async function refresh(reason = 'reload', { advance = false } = {}) {
        const epoch = advance ? lifecycle.advance() : lifecycle.capture();
        let active;
        try {
            active = await readActiveContext();
        } catch (error) {
            return { status: 'indeterminate', reason: 'context-read-failed', error };
        }
        const chatId = String(active?.chatId ?? '');
        if (!lifecycle.isCurrent(epoch)) return { status: 'stale', reason: 'epoch-changed' };

        const view = Object.freeze({
            chatId,
            chatState: snapshotJsonSafe(active?.chatMetadata?.contextImageGeneration),
            epoch,
            reason,
        });
        render(view);
        return { status: 'rendered', view };
    }

    function bind() {
        if (!eventSource?.on) return;
        if (eventTypes?.CHAT_CHANGED) {
            eventSource.on(eventTypes.CHAT_CHANGED, () => refresh('changed', { advance: true }));
        }
        if (eventTypes?.CHAT_CREATED) {
            eventSource.on(eventTypes.CHAT_CREATED, () => refresh('created', { advance: true }));
        }
    }

    return Object.freeze({ bind, refresh });
}

export function bindAppearanceLifecycle(dependencies) {
    const controller = createAppearanceLifecycleController(dependencies);
    controller.bind();
    const reload = controller.refresh('reload');
    return Object.freeze({ controller, reload });
}

import { attachGeneratedImageSafely } from '../rp-attachment.js';

function abortError() {
    return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function terminalStatus(error) {
    return error ? 'failed' : 'completed';
}

/**
 * Persist a kernel artifact using the existing message-attachment transaction.
 * Host operations remain injected so this production adapter has no UI or provider
 * coupling; the entry-point composition supplies them from the current host seam.
 */
export function createMessageDeliveryAdapter(dependencies) {
    return Object.freeze({
        async deliver({ artifact, request, telemetry, signal }) {
            const track = (stage, status) => telemetry?.record?.(stage, status);
            return attachGeneratedImageSafely({
                ...dependencies,
                saveImage: async (...args) => {
                    track('save', 'started');
                    try {
                        const result = await dependencies.saveImage(...args);
                        track('save', 'completed');
                        return result;
                    } catch (error) {
                        track('save', terminalStatus(error));
                        throw error;
                    }
                },
                appendMedia: async (...args) => {
                    track('attach', 'started');
                    try {
                        const result = await dependencies.appendMedia(...args);
                        track('attach', 'completed');
                        return result;
                    } catch (error) {
                        track('attach', terminalStatus(error));
                        throw error;
                    }
                },
                saveChat: async (...args) => {
                    track('chat-save', 'started');
                    try {
                        const result = await dependencies.saveChat(...args);
                        track('chat-save', 'completed');
                        return result;
                    } catch (error) {
                        track('chat-save', terminalStatus(error));
                        throw error;
                    }
                },
                addToGallery: async (...args) => {
                    track('gallery-save', 'started');
                    try {
                        const result = await dependencies.addToGallery(...args);
                        track('gallery-save', 'completed');
                        return result;
                    } catch (error) {
                        track('gallery-save', terminalStatus(error));
                        throw error;
                    }
                },
                target: request.target,
                prompt: request.prompt,
                sender: request.sender,
                focusText: request.focusText,
                signal,
                generate: async () => artifact,
            });
        },
    });
}

export function createPreviewGalleryDeliveryAdapter({ addToGallery, showPreview }) {
    return Object.freeze({
        async deliver({ artifact, plan, telemetry, signal }) {
            throwIfAborted(signal);
            telemetry?.record?.('gallery-save', 'started');
            let item;
            try {
                item = await addToGallery(artifact, plan);
                telemetry?.record?.('gallery-save', 'completed');
            } catch (error) {
                telemetry?.record?.('gallery-save', terminalStatus(error));
                throw error;
            }
            showPreview(item.url);
            return item.url;
        },
    });
}

export function createWandGenerationRequest({ prompt, sender, messageId, focusText, target, lifecycleEpoch }) {
    return {
        source: 'wand', destination: 'message', prompt, sender, messageId, focusText, target,
        ...(lifecycleEpoch === undefined ? {} : { lifecycleEpoch }),
    };
}

export function createSlashGenerationRequest(prompt) {
    return { source: 'slash', destination: 'preview-gallery', prompt: String(prompt || '').trim() };
}

export function createWandEntryAdapter({ kernel, delivery }) {
    return Object.freeze({
        async generate(input) {
            const result = await kernel.generate(createWandGenerationRequest(input), { deliver: (value) => delivery.deliver(value) });
            return Object.hasOwn(result || {}, 'deliveryResult') ? result.deliveryResult : delivery.deliver(result);
        },
    });
}

export function createSlashEntryAdapter({ kernel, delivery }) {
    return Object.freeze({
        async generate(prompt) {
            const result = await kernel.generate(createSlashGenerationRequest(prompt), { deliver: (value) => delivery.deliver(value) });
            return Object.hasOwn(result || {}, 'deliveryResult') ? result.deliveryResult : delivery.deliver(result);
        },
    });
}

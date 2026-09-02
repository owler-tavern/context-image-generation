import { attachGeneratedImageSafely } from '../rp-attachment.js';

/**
 * Persist a kernel artifact using the existing message-attachment transaction.
 * Host operations remain injected so this dormant adapter has no UI or provider
 * coupling; Task 4 supplies them from the current production seam.
 */
export function createMessageDeliveryAdapter(dependencies) {
    return Object.freeze({
        async deliver({ artifact, request }) {
            return attachGeneratedImageSafely({
                ...dependencies,
                target: request.target,
                prompt: request.prompt,
                sender: request.sender,
                focusText: request.focusText,
                generate: async () => artifact,
            });
        },
    });
}

export function createPreviewGalleryDeliveryAdapter({ addToGallery, showPreview }) {
    return Object.freeze({
        async deliver({ artifact, plan }) {
            const item = await addToGallery(artifact, plan);
            showPreview(item.url);
            return item.url;
        },
    });
}

export function createWandGenerationRequest({ prompt, sender, messageId, focusText, target }) {
    return { source: 'wand', destination: 'message', prompt, sender, messageId, focusText, target };
}

export function createSlashGenerationRequest(prompt) {
    return { source: 'slash', destination: 'preview-gallery', prompt: String(prompt || '').trim() };
}

export function createWandEntryAdapter({ kernel, delivery }) {
    return Object.freeze({
        async generate(input) {
            return delivery.deliver(await kernel.generate(createWandGenerationRequest(input)));
        },
    });
}

export function createSlashEntryAdapter({ kernel, delivery }) {
    return Object.freeze({
        async generate(prompt) {
            return delivery.deliver(await kernel.generate(createSlashGenerationRequest(prompt)));
        },
    });
}

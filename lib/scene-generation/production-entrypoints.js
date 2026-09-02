import { createSlashEntryAdapter, createWandEntryAdapter } from './delivery.js';

export function createProductionGenerationEntrypoints({
    kernel,
    messageDelivery,
    previewGalleryDelivery,
    onMessageRendered = async () => {},
} = {}) {
    const wand = createWandEntryAdapter({ kernel, delivery: messageDelivery });
    const slash = createSlashEntryAdapter({ kernel, delivery: previewGalleryDelivery });

    return Object.freeze({
        generateFromWand: (input) => wand.generate(input),
        generateFromSlash: (prompt) => slash.generate(prompt),
        onCharacterMessageRendered: (messageId) => onMessageRendered(messageId),
        onUserMessageRendered: (messageId) => onMessageRendered(messageId),
    });
}

export function registerProductionGenerationEntrypoints(entrypoints, host) {
    host.registerWand(entrypoints.generateFromWand);
    host.registerSlash(entrypoints.generateFromSlash);
    host.registerCharacterMessageRendered(entrypoints.onCharacterMessageRendered);
    host.registerUserMessageRendered(entrypoints.onUserMessageRendered);
}

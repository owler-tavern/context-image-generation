import { materializeReferences } from './references.js';

export function buildReferenceMessageParts(plan, assets = {}) {
    const contentParts = [];
    const materialized = materializeReferences(plan?.references || [], { assets });
    for (const reference of materialized.references) {
        contentParts.push({ type: 'text', text: `[Reference image: ${reference.label || reference.role}]` });
        const asset = reference.asset;
        const url = asset.url || `data:${asset.mimeType || 'image/png'};base64,${asset.data}`;
        contentParts.push({ type: 'image_url', image_url: { url } });
    }
    return contentParts;
}

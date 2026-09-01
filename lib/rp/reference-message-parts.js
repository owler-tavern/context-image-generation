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

export async function materializeHostAvatarReferenceAssets({ references = [], getCharacterAvatar = async () => null, getUserAvatar = async () => null } = {}) {
    const assets = {};
    for (const reference of references.filter((candidate) => candidate.role === 'host-avatar' && String(candidate.id).startsWith('host:character'))) {
        const avatar = await getCharacterAvatar(reference.sourceId || reference.identityId);
        if (avatar) assets[reference.assetId] = { data: avatar.data, mimeType: avatar.mimeType };
    }
    if (references.some((reference) => reference.id === 'host:user')) {
        const avatar = await getUserAvatar(references.find((reference) => reference.id === 'host:user')?.sourceId);
        if (avatar) assets['asset:host-user'] = { data: avatar.data, mimeType: avatar.mimeType };
    }
    return assets;
}

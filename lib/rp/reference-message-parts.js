import { materializeReferences } from './references.js';

export const FINAL_SCENE_CONSTRAINT = 'Create exactly one cohesive scene. References define appearance only. Do not create a collage, panels, contact sheet, split screen, multiple frames, or character reference sheet.';

function aspectRatioInstruction(aspectRatio) {
    const ratio = String(aspectRatio || '').trim();
    return /^\d+:\d+$/u.test(ratio)
        ? `Render the final image in ${ratio} aspect ratio. This image shape is required.`
        : '';
}

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

/** Build the single user message accepted by the existing Gemini proxy. */
export function buildGenerationMessages(plan, assets = {}, referenceParts = buildReferenceMessageParts(plan, assets)) {
    const content = [];
    if (plan?.options?.systemInstruction) content.push({ type: 'text', text: plan.options.systemInstruction });
    content.push(...referenceParts);
    const finalPrompt = [plan?.prompt?.descriptionText, plan?.prompt?.messageContent || plan?.prompt?.sourceMessage, aspectRatioInstruction(plan?.options?.aspectRatio), FINAL_SCENE_CONSTRAINT]
        .filter(Boolean).join('\n\n');
    content.push({ type: 'text', text: finalPrompt });
    return [{ role: 'user', content }];
}

export async function materializeHostAvatarReferenceAssets({ references = [], getCharacterAvatar = async () => null, getUserAvatar = async () => null, signal } = {}) {
    const assets = {};
    for (const reference of references.filter((candidate) => candidate.role === 'host-avatar' && String(candidate.id).startsWith('host:character'))) {
        const avatar = await getCharacterAvatar(reference.sourceId || reference.identityId, signal);
        if (avatar) assets[reference.assetId] = { data: avatar.data, mimeType: avatar.mimeType };
    }
    if (references.some((reference) => reference.id === 'host:user')) {
        const avatar = await getUserAvatar(references.find((reference) => reference.id === 'host:user')?.sourceId, signal);
        if (avatar) assets['asset:host-user'] = { data: avatar.data, mimeType: avatar.mimeType };
    }
    return assets;
}

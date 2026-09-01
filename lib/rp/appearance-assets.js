import { decodeGenerationArtifact, ARTIFACT_LIMITS } from '../providers/artifact-decoder.js';

const FOLDER = 'context-image-generation-appearances';
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNED_PATH = new RegExp(`^/user/images/${FOLDER}/cig-appearance-${UUID_PATTERN}\\.(?:png|jpg|jpeg|webp|gif|avif)$`, 'u');
const MAX_ASSETS = 100;
const MAX_RECORDED_BYTES = 512 * 1024 * 1024;

function artifactId(item) { return String(item?.id || item?.assetId || item?.sourceMetadata?.artifactId || item?.url || '').trim(); }
function extensionFor(mimeType) { return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[mimeType]; }
function allLooks(library) { return Object.values(library?.identities || {}).flatMap((identity) => identity?.looks || []); }

export function validateAppearanceAssetUrl(value) {
    return typeof value === 'string' && OWNED_PATH.test(value) && !value.includes('..') && !value.includes('\\');
}

export async function deleteAppearanceAssetFile(url, fetchImpl = fetch, getHeaders) {
    if (!validateAppearanceAssetUrl(url)) throw new TypeError('Refusing to delete an unsafe appearance path.');
    const response = await fetchImpl('/api/images/delete', { method: 'POST', headers: getHeaders?.() || {}, body: JSON.stringify({ path: url }) });
    if (response?.ok || response?.status === 404) return true;
    throw new Error(`Appearance file deletion failed (${response?.status || 'network'}).`);
}

export async function deleteAppearanceFile({ url, fetchImpl = fetch, getHeaders } = {}) {
    if (!validateAppearanceAssetUrl(url)) throw new TypeError('Refusing to delete an unsafe appearance path.');
    const response = await fetchImpl('/api/images/delete', { method: 'POST', headers: getHeaders?.() || {}, body: JSON.stringify({ path: url }) });
    if (response?.ok) return { deleted: true };
    if (response?.status === 404) return { deleted: true, reason: 'already-absent' };
    throw new Error(`Appearance file deletion failed (${response?.status || 'network'}).`);
}

export async function promoteGalleryArtifact({ item, identityId, library = {}, readDataUrl, saveBase64, uuid = () => crypto.randomUUID(), isTargetCurrent = () => true } = {}) {
    const sourceId = artifactId(item);
    const ownerId = String(identityId || '').trim();
    if (!sourceId || !ownerId || typeof readDataUrl !== 'function' || typeof saveBase64 !== 'function') throw new TypeError('A Gallery image, identity, reader, and saver are required.');
    const duplicate = allLooks(library).find((look) => look?.source?.identityId === ownerId && look?.source?.galleryArtifactId === sourceId);
    if (duplicate) return { asset: library.assets?.[duplicate.assetId], look: duplicate, dedupeKey: `${ownerId}:${sourceId}`, deduplicated: true };

    const appearanceAssets = Object.values(library.assets || {}).filter((asset) => asset?.kind === 'appearance');
    if (appearanceAssets.length >= MAX_ASSETS) throw new RangeError('The library limit of 100 appearance assets has been reached.');
    const dataUrl = await readDataUrl(item);
    const decoded = await decodeGenerationArtifact(dataUrl, { maxBytes: ARTIFACT_LIMITS.maxBytes });
    if (!isTargetCurrent()) throw new Error('The chat changed before the appearance upload.');
    const totalBytes = appearanceAssets.reduce((sum, asset) => sum + (Number.isFinite(asset.byteCount) ? asset.byteCount : 0), 0);
    if (totalBytes + decoded.bytes > MAX_RECORDED_BYTES) throw new RangeError('The 512 MiB appearance library limit would be exceeded.');
    const id = String(uuid()).toLowerCase();
    if (!new RegExp(`^${UUID_PATTERN}$`, 'u').test(id)) throw new TypeError('A lowercase RFC 4122 UUID is required.');
    const extension = extensionFor(decoded.mimeType);
    if (!extension) throw new TypeError('Unsupported appearance image type.');
    const filename = `cig-appearance-${id}`;
    const url = await saveBase64(decoded.imageData, FOLDER, filename, extension);
    if (!validateAppearanceAssetUrl(url)) throw new TypeError('The appearance saver returned an unsafe or unexpected path.');
    const createdAt = Date.now();
    const asset = { id: `asset:${id}`, kind: 'appearance', url, mimeType: decoded.mimeType, byteCount: decoded.bytes, createdAt };
    const look = { id: `look:${id}`, assetId: asset.id, label: String(item.prompt || 'Saved appearance').slice(0, 120), createdAt, source: { galleryArtifactId: sourceId, identityId: ownerId } };
    return { asset, look, dedupeKey: `${ownerId}:${sourceId}`, deduplicated: false };
}

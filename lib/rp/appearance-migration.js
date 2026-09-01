import { decodeGenerationArtifact, ARTIFACT_LIMITS } from '../providers/artifact-decoder.js';
import { validateAppearanceAssetUrl } from './appearance-assets.js';
import { finalizeLegacyArtifactMigration, listLegacyGalleryMigrationDependencies, migrateAppearanceLibrary, stageLegacyArtifactMigration } from './appearance-library.js';

const FOLDER = 'context-image-generation-appearances';
const clone = (value) => JSON.parse(JSON.stringify(value));
const artifactId = (item) => String(item?.id || item?.assetId || item?.sourceMetadata?.artifactId || item?.url || '');
const extensionFor = (mime) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[mime];
const MAX_ASSETS = 100;
const MAX_RECORDED_BYTES = 512 * 1024 * 1024;
const CLEAR_OPERATION_ID = 'gallery-clear:pending';

function blocked(reason, extra = {}) {
    return { status: 'blocked', reason, message: 'Gallery was not cleared because saved-look migration could not be verified. Your images and saved looks were left unchanged.', ...extra };
}

async function persistVerified(io, library) {
    try {
        await io.saveLibrary(library);
        return await io.verifyLibrary(library.revision);
    } catch (error) { return { status: 'indeterminate', error }; }
}

async function migrateDependency({ dependency, gallery, io }) {
    const authoritative = await io.readLibrary();
    if (authoritative?.status !== 'confirmed') return blocked('library-unavailable', { verification: authoritative });
    let library = migrateAppearanceLibrary(authoritative.library);
    let operationEntry = Object.entries(library.operations || {}).find(([, operation]) => operation?.status === 'pending-migration' && operation.galleryArtifactId === dependency.galleryArtifactId);
    const item = gallery.find((entry) => artifactId(entry) === dependency.galleryArtifactId);
    if (!item) return blocked('gallery-artifact-missing');
    let decoded;

    if (!operationEntry) {
        try { decoded = await decodeGenerationArtifact(await io.readDataUrl(item), { maxBytes: ARTIFACT_LIMITS.maxBytes }); }
        catch (error) { return blocked('decode-failed', { error }); }
        const id = String(io.uuid()).toLowerCase();
        const extension = extensionFor(decoded.mimeType);
        const targetUrl = `/user/images/${FOLDER}/cig-appearance-${id}.${extension}`;
        if (!extension || !validateAppearanceAssetUrl(targetUrl)) return blocked('invalid-target');
        const appearanceAssets = Object.values(library.assets || {}).filter((asset) => asset?.kind === 'appearance');
        if (appearanceAssets.length >= MAX_ASSETS) return blocked('asset-quota');
        const recordedBytes = appearanceAssets.reduce((sum, asset) => sum + (Number.isFinite(asset.byteCount) ? asset.byteCount : 0), 0);
        if (recordedBytes + decoded.bytes > MAX_RECORDED_BYTES) return blocked('byte-quota');
        const operationId = `migration:${dependency.galleryArtifactId}`;
        const staged = stageLegacyArtifactMigration(library, { operationId, galleryArtifactId: dependency.galleryArtifactId, targetAssetId: `asset:${id}`, targetUrl, mimeType: decoded.mimeType, byteCount: decoded.bytes });
        staged.library.revision = `appearance-migration-pending:${id}`;
        const verification = await persistVerified(io, staged.library);
        if (verification?.status !== 'confirmed') {
            io.setLocalState?.({ library: staged.library, gallery });
            return blocked('pending-unverified', { verification, operationId, targetUrl });
        }
        library = staged.library;
        operationEntry = [operationId, staged.operation];
    }

    const [operationId, operation] = operationEntry;
    let target = await io.targetExists(operation.targetUrl);
    if (target?.status === 'confirmed-absent') {
        if (!decoded) {
            try { decoded = await decodeGenerationArtifact(await io.readDataUrl(item), { maxBytes: ARTIFACT_LIMITS.maxBytes }); }
            catch (error) { return blocked('decode-failed', { error, operationId, targetUrl: operation.targetUrl }); }
        }
        const extension = extensionFor(operation.mimeType || decoded.mimeType);
        const filename = operation.targetUrl.match(/\/([^/.]+)\.[^.]+$/u)?.[1];
        let savedUrl;
        try { savedUrl = await io.saveBase64(decoded.imageData, FOLDER, filename, extension); }
        catch (error) { return blocked('upload-failed', { error, operationId, targetUrl: operation.targetUrl }); }
        if (savedUrl !== operation.targetUrl || !validateAppearanceAssetUrl(savedUrl)) return blocked('upload-path-mismatch', { operationId, targetUrl: operation.targetUrl });
        target = await io.targetExists(operation.targetUrl);
    }
    if (target?.status !== 'confirmed-present') return blocked('target-unverified', { verification: target, operationId, targetUrl: operation.targetUrl });

    const pendingLibrary = clone(library);
    const promoted = finalizeLegacyArtifactMigration(library, operationId, { mimeType: operation.mimeType, byteCount: operation.byteCount });
    promoted.revision = `appearance-migration-promoted:${io.uuid()}`;
    const promotedVerification = await persistVerified(io, promoted);
    if (promotedVerification?.status !== 'confirmed') {
        io.setLocalState?.({ library: pendingLibrary, gallery });
        return blocked('promotion-unverified', { verification: promotedVerification, operationId, targetUrl: operation.targetUrl });
    }
    io.setLocalState?.({ library: promoted, gallery });
    return { status: 'confirmed', library: promoted, operationId, targetUrl: operation.targetUrl };
}

export async function runClearGalleryPreservingLooks({ gallery = [], io, withinExclusive = false } = {}) {
    if (!withinExclusive && io?.runExclusive) return io.runExclusive(() => runClearGalleryPreservingLooks({ gallery, io, withinExclusive: true }));
    const originalGallery = clone(gallery);
    const first = await io.readLibrary();
    if (first?.status !== 'confirmed') return blocked('library-unavailable', { verification: first });
    let library = migrateAppearanceLibrary(first.library);
    let clearOperation = library.operations?.[CLEAR_OPERATION_ID];
    if (!clearOperation) {
        library.operations = { ...(library.operations || {}), [CLEAR_OPERATION_ID]: { status: 'pending-clear', phase: 'pending' } };
        library.revision = `appearance-clear-intent:${io.uuid()}`;
        const intentVerification = await persistVerified(io, library);
        if (intentVerification?.status !== 'confirmed') {
            io.setLocalState?.({ library, gallery: originalGallery });
            return blocked('clear-intent-unverified', { verification: intentVerification });
        }
        io.setLocalState?.({ library, gallery: originalGallery });
        clearOperation = library.operations[CLEAR_OPERATION_ID];
    }

    if (clearOperation.phase === 'clear-written') {
        const writtenVerification = await io.verifyClearedState(library.revision);
        if (writtenVerification?.status !== 'confirmed') return blocked('clear-unverified', { verification: writtenVerification, message: 'Gallery clear verification is pending. The extension will reconcile it before reporting a result.' });
        const cleanup = clone(library);
        delete cleanup.operations[CLEAR_OPERATION_ID];
        cleanup.revision = `appearance-gallery-clear-complete:${io.uuid()}`;
        let cleanupVerification;
        try { await io.saveClearedState({ library: cleanup, gallery: [] }); cleanupVerification = await io.verifyClearedState(cleanup.revision); }
        catch (error) { cleanupVerification = { status: 'indeterminate', error }; }
        if (cleanupVerification?.status !== 'confirmed') {
            io.setLocalState?.({ library, gallery: [] });
            return blocked('clear-cleanup-unverified', { verification: cleanupVerification, message: 'Gallery was cleared, but cleanup verification is pending.' });
        }
        io.setLocalState?.({ library: cleanup, gallery: [] });
        return { status: 'confirmed', library: cleanup, gallery: [], migrations: [], message: 'Gallery cleared. Remembered appearances are still available.' };
    }

    const dependencies = listLegacyGalleryMigrationDependencies(library);
    const migrations = [];
    for (const dependency of dependencies) {
        const result = await migrateDependency({ dependency, gallery: originalGallery, io });
        if (result.status !== 'confirmed') return { ...result, migrations };
        migrations.push(result);
        library = result.library;
    }
    try { await io.beforeClear?.(); } catch (error) {
        io.setLocalState?.({ library, gallery: originalGallery });
        return blocked('clear-deferred', { error, migrations });
    }
    const pendingLibrary = clone(library);
    const cleared = { library: clone(library), gallery: [] };
    cleared.library.operations[CLEAR_OPERATION_ID] = { status: 'pending-clear', phase: 'clear-written' };
    cleared.library.revision = `appearance-gallery-clear-written:${io.uuid()}`;
    let verification;
    try { await io.saveClearedState(cleared); verification = await io.verifyClearedState(cleared.library.revision); }
    catch (error) { verification = { status: 'indeterminate', error }; }
    if (verification?.status !== 'confirmed') {
        io.setLocalState?.({ library: pendingLibrary, gallery: originalGallery });
        return blocked('clear-unverified', { verification, migrations, message: 'Gallery clear verification is pending. The extension will reconcile it before reporting a result.' });
    }
    const cleanup = clone(cleared.library);
    delete cleanup.operations[CLEAR_OPERATION_ID];
    cleanup.revision = `appearance-gallery-clear-complete:${io.uuid()}`;
    let cleanupVerification;
    try { await io.saveClearedState({ library: cleanup, gallery: [] }); cleanupVerification = await io.verifyClearedState(cleanup.revision); }
    catch (error) { cleanupVerification = { status: 'indeterminate', error }; }
    if (cleanupVerification?.status !== 'confirmed') {
        io.setLocalState?.(cleared);
        return blocked('clear-cleanup-unverified', { verification: cleanupVerification, migrations, message: 'Gallery was cleared, but cleanup verification is pending.' });
    }
    io.setLocalState?.({ library: cleanup, gallery: [] });
    return { status: 'confirmed', library: cleanup, gallery: [], migrations, message: 'Gallery cleared. Remembered appearances are still available.' };
}

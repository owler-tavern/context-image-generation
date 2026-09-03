const STALE_TARGET_TOAST = 'Image kept in the gallery because the original message is no longer active.';

async function rollbackAttachment(rollbackMedia, attachment) {
    if (rollbackMedia) await rollbackMedia(attachment);
    else if (typeof attachment === 'function') await attachment();
}

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

export async function attachGeneratedImageSafely({
    target,
    prompt,
    sender,
    focusText = null,
    generate,
    saveImage,
    getCurrentTarget,
    appendMedia,
    saveChat,
    addToGallery,
    notify,
    rollbackMedia,
    rollbackAttachment: rollbackAttachmentOverride,
    sanitizeIterationArtifact,
    signal,
    beginCommit,
}) {
    const persist = async (result, signal) => {
        throwIfAborted(signal);
        if (!result) return { attached: false, stale: false };
        const storedIterationArtifact = result.__cigIterationArtifact
            ? (() => {
                if (typeof sanitizeIterationArtifact !== 'function') throw new Error('Iteration artifact sanitizer is unavailable.');
                return sanitizeIterationArtifact(result.__cigIterationArtifact);
            })()
            : null;
        const galleryMetadata = storedIterationArtifact ? { iterationArtifact: storedIterationArtifact } : undefined;
        beginCommit?.();
        const filePath = await saveImage(result.imageData);
        const validation = getCurrentTarget();
        if (!validation?.safe) {
            await addToGallery(result.imageData, prompt, target.messageId, filePath, {
                source: 'message', chatId: target.chatId, messageId: target.messageId, messageFingerprint: target.messageFingerprint,
                attachmentStatus: 'not-attached', reason: validation?.reason || 'unavailable',
                ...(galleryMetadata ? { iterationArtifact: galleryMetadata.iterationArtifact } : {}),
            });
            notify(STALE_TARGET_TOAST);
            return { attached: false, stale: true };
        }

        const attachment = await appendMedia({ result, storedIterationArtifact, filePath, prompt, message: validation.message });
        const saveValidation = getCurrentTarget();
        if (!saveValidation?.safe) {
            await rollbackAttachment(rollbackMedia || rollbackAttachmentOverride, attachment);
            await addToGallery(result.imageData, prompt, target.messageId, filePath, {
                source: 'message', chatId: target.chatId, messageId: target.messageId, messageFingerprint: target.messageFingerprint,
                attachmentStatus: 'not-attached', reason: saveValidation?.reason || 'unavailable',
                ...(galleryMetadata ? { iterationArtifact: galleryMetadata.iterationArtifact } : {}),
            });
            notify(STALE_TARGET_TOAST);
            return { attached: false, stale: true };
        }

        let saveResult;
        try {
            saveResult = await saveChat(result);
        } catch (error) {
            await rollbackAttachment(rollbackMedia || rollbackAttachmentOverride, attachment);
            throw error;
        }
        if (saveResult?.saved === false || saveResult?.safe === false) {
            await rollbackAttachment(rollbackMedia || rollbackAttachmentOverride, attachment);
            await addToGallery(result.imageData, prompt, target.messageId, filePath, {
                source: 'message', chatId: target.chatId, messageId: target.messageId, messageFingerprint: target.messageFingerprint,
                attachmentStatus: 'not-attached', reason: saveResult.reason || 'unavailable',
                ...(galleryMetadata ? { iterationArtifact: galleryMetadata.iterationArtifact } : {}),
            });
            notify(STALE_TARGET_TOAST);
            return { attached: false, stale: true };
        }
        await addToGallery(result.imageData, prompt, target.messageId, filePath, galleryMetadata ? { iterationArtifact: galleryMetadata.iterationArtifact } : undefined);
        return { attached: true, stale: false };
    };

    const generated = await generate({
        prompt,
        sender,
        messageId: target.messageId,
        focusText,
        target,
        finalize: async (result, signal) => ({ ...result, __cigFinalized: true, persistence: await persist(result, signal) }),
    });
    if (generated?.__cigFinalized) return generated.persistence?.attached === true;
    return (await persist(generated, signal)).attached;
}

export { STALE_TARGET_TOAST };

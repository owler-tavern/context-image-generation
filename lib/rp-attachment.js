const STALE_TARGET_TOAST = 'Image kept in the gallery because the original message is no longer active.';

async function rollbackAttachment(rollbackMedia, attachment) {
    if (rollbackMedia) {
        await rollbackMedia(attachment);
    } else if (typeof attachment === 'function') {
        await attachment();
    }
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
}) {
    const result = await generate({ prompt, sender, messageId: target.messageId, focusText, target });
    if (!result) return false;

    const filePath = await saveImage(result.imageData);
    const validation = getCurrentTarget();
    if (!validation?.safe) {
        await addToGallery(result.imageData, prompt, target.messageId, filePath, {
            source: 'message',
            chatId: target.chatId,
            messageId: target.messageId,
            messageFingerprint: target.messageFingerprint,
            attachmentStatus: 'not-attached',
            reason: validation?.reason || 'unavailable',
        });
        notify(STALE_TARGET_TOAST);
        return false;
    }

    const attachment = await appendMedia({ result, filePath, prompt, message: validation.message });
    const saveValidation = getCurrentTarget();
    if (!saveValidation?.safe) {
        await rollbackAttachment(rollbackMedia, attachment);
        await addToGallery(result.imageData, prompt, target.messageId, filePath, {
            source: 'message',
            chatId: target.chatId,
            messageId: target.messageId,
            messageFingerprint: target.messageFingerprint,
            attachmentStatus: 'not-attached',
            reason: saveValidation?.reason || 'unavailable',
        });
        notify(STALE_TARGET_TOAST);
        return false;
    }

    const saveResult = await saveChat();
    if (saveResult?.saved === false) {
        await rollbackAttachment(rollbackMedia, attachment);
        await addToGallery(result.imageData, prompt, target.messageId, filePath, {
            source: 'message',
            chatId: target.chatId,
            messageId: target.messageId,
            messageFingerprint: target.messageFingerprint,
            attachmentStatus: 'not-attached',
            reason: saveResult.reason || 'unavailable',
        });
        notify(STALE_TARGET_TOAST);
        return false;
    }
    await addToGallery(result.imageData, prompt, target.messageId, filePath);
    return true;
}

export { STALE_TARGET_TOAST };

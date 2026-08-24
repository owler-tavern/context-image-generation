const STALE_TARGET_TOAST = 'Image kept in the gallery because the original message is no longer active.';

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

    appendMedia({ result, filePath, prompt, message: validation.message });
    await saveChat();
    await addToGallery(result.imageData, prompt, target.messageId, filePath);
    return true;
}

export { STALE_TARGET_TOAST };

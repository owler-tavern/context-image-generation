export function getMessageFingerprint(message) {
    const source = JSON.stringify([
        message?.send_date ?? null,
        message?.name ?? null,
        message?.is_user === true,
        message?.is_system === true,
        message?.mes ?? null,
    ]);
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function captureMessageTarget({ chatId, messageId, message }) {
    return {
        chatId: chatId ?? null,
        messageId,
        messageFingerprint: getMessageFingerprint(message),
    };
}

export function validateMessageTarget({ target, currentChatId, currentChat }) {
    if (!target || target.chatId === null || target.chatId === undefined || currentChatId === undefined || currentChatId === null) {
        return { safe: false, reason: 'unavailable' };
    }
    if (target.chatId !== currentChatId) return { safe: false, reason: 'chat-changed' };
    if (!Number.isInteger(target.messageId) || target.messageId < 0 || !Array.isArray(currentChat) || !currentChat[target.messageId]) {
        return { safe: false, reason: 'deleted' };
    }
    const message = currentChat[target.messageId];
    if (getMessageFingerprint(message) !== target.messageFingerprint) return { safe: false, reason: 'replaced' };
    return { safe: true, message };
}

export function buildGenerationKey({ chatId, messageId, prompt }) {
    if (messageId === null || messageId === undefined) return `prompt:${String(prompt).trim()}`;
    return `message:${chatId ?? 'unknown'}:${messageId}`;
}

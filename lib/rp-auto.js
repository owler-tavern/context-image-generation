import { captureMessageTarget, validateMessageTarget } from './rp-target.js';

export function captureAutoGenerationInput({ context, messageId }) {
    const message = context?.chat?.[messageId];
    if (!message || !message.mes || message.is_system) return null;

    return {
        message,
        messageId,
        target: captureMessageTarget({ chatId: context.chatId, messageId, message }),
    };
}

export function validateAutoGenerationInput({ input, context }) {
    if (!input) return { safe: false, reason: 'unavailable' };
    const validation = validateMessageTarget({
        target: input.target,
        currentChatId: context?.chatId,
        currentChat: context?.chat,
    });
    return validation.safe ? { ...validation, input } : validation;
}

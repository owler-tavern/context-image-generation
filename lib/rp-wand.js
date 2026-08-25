import { isEligibleMessageSelection, normalizeFocusText } from './rp-selection.js';
import { captureMessageTarget } from './rp-target.js';

export function captureWandGenerationInput({
    chatId,
    messageId,
    message,
    messageElement,
    selection,
    sender,
    captureSelection = true,
}) {
    const focusText = captureSelection
        && isEligibleMessageSelection({ selection, clickedMessageElement: messageElement })
        ? normalizeFocusText(selection.toString())
        : null;

    return {
        sourceMessage: message.mes,
        focusText,
        sender,
        target: captureMessageTarget({ chatId, messageId, message }),
    };
}

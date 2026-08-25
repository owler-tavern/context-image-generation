/**
 * Context Image Generation 🍌
 * Gemini-powered image generation with avatar references and character context
 * Uses SillyTavern's backend to handle Google AI authentication
 * Version 1.3.3
 */

import {
    saveSettingsDebounced,
    getRequestHeaders,
    appendMediaToMessage,
    eventSource,
    event_types,
    saveChatConditional,
    user_avatar,
    getUserAvatar as getAvatarPath,
    name1,
} from '../../../../script.js';

import { getContext, extension_settings } from '../../../extensions.js';
import { getBase64Async, saveBase64AsFile } from '../../../utils.js';
import { power_user } from '../../../power-user.js';
import { oai_settings } from '../../../openai.js';
import { MEDIA_DISPLAY, MEDIA_SOURCE, MEDIA_TYPE, SCROLL_BEHAVIOR, SWIPE_DIRECTION } from '../../../constants.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { getModelDefinition, getProviderDefinition, resolveProviderRoute, getProviderDefinitions, requiresAdapterRoute } from './lib/providers/registry.js';
import { getModelFallback, projectProviderControls, projectProviderOptions, projectProviderUi } from './lib/providers/ui-projection.js';
import { mergeFetchedModelEntries, updateLocalModelEntries } from './lib/providers/model-manager.js';
import { fetchProviderModels } from './lib/providers/model-discovery.js';
import { buildOpenAiImagesRequest, parseOpenAiImagesResponse } from './lib/providers/openai-images.js';
import { dispatchProviderRoute } from './lib/providers/dispatch.js';
import { createGenerationCoordinator } from './lib/generation-coordinator.js';

const extensionName = 'context-image-generation';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    provider: 'makersuite',
    model: 'gemini-2.5-flash-image',
    linkapi_key: '',
    provider_keys: {},
    provider_models: {},
    linkapi_use_legacy_routing: false,
    aspect_ratio: '1:1',
    image_size: '',
    thinking_level: 'auto',
    use_google_search: false,
    auto_generate: 'off',
    use_avatars: false,
    regenerate_on_swipe: false,
    include_descriptions: false,
    use_previous_image: false,
    message_depth: 1,
    system_instruction: 'You are an image generation assistant. When reference images are provided, they represent the characters in the story. Generate an illustration that depicts the scene described in the prompt while maintaining the art style and appearance of the reference characters. You are not obligated to include both characters - if the scene depicts only one character alone, illustrate them alone. When available, you can use the internet to search for reference pictures and information to improve the accuracy and quality of your generations.',
    gallery: [],
};

const MAX_GALLERY_SIZE = 50;
const generationCoordinator = createGenerationCoordinator();

function getProviderApiKey(settings, providerId) {
    const providerKeys = settings.provider_keys;
    if (providerKeys && typeof providerKeys === 'object' && typeof providerKeys[providerId] === 'string') return providerKeys[providerId];
    return providerId === 'linkapi' ? settings.linkapi_key || '' : '';
}

function setProviderApiKey(settings, providerId, value) {
    if (!settings.provider_keys || typeof settings.provider_keys !== 'object' || Array.isArray(settings.provider_keys)) settings.provider_keys = {};
    settings.provider_keys[providerId] = value;
    if (providerId === 'linkapi') { settings.linkapi_key = value; settings.provider_keys.linkapi = value; }
}

function getProviderModelEntries(settings, providerId) {
    const entries = settings.provider_models?.[providerId];
    return Array.isArray(entries) ? entries : [];
}

function setProviderModelEntries(settings, providerId, entries) {
    if (!settings.provider_models || typeof settings.provider_models !== 'object' || Array.isArray(settings.provider_models)) {
        settings.provider_models = {};
    }
    settings.provider_models[providerId] = entries;
}

// --- LinkAPI ChatGPT (gpt-image) helpers (pure, text-prompt only) ---

function isOpenAiImageModel(model) {
    return /^(gpt-image|dall-e)/i.test(model || '');
}

function mapAspectRatioToSize(aspectRatio) {
    switch (aspectRatio) {
        case '3:4':
        case '9:16':
            return '1024x1536';
        case '4:3':
        case '16:9':
            return '1536x1024';
        case '1:1':
        default:
            return '1024x1024';
    }
}

function extractPromptText(messages) {
    const parts = [];
    for (const msg of messages || []) {
        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part && part.type === 'text' && part.text) {
                    parts.push(part.text);
                }
            }
        } else if (typeof msg.content === 'string' && msg.content) {
            parts.push(msg.content);
        }
    }
    return parts.join('\n\n');
}

function parseImagesResponse(json) {
    const item = json && Array.isArray(json.data) ? json.data[0] : null;
    return { b64: (item && item.b64_json) || null, url: (item && item.url) || null };
}

function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

async function requestLinkApiImage({ apiKey, model, prompt, size, host = 'https://linkapi.ai' }) {
    const url = `${host}/v1/images/generations`;
    // Direct browser -> LinkAPI request (does NOT pass through the ST server, so
    // it appears in the browser console/Network tab, not the ST server terminal).
    console.log(`[${extensionName}] LinkAPI image request:`, { url, model, size, promptLength: (prompt || '').length });

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || ''}`,
        },
        body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json' }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] LinkAPI image error (${response.status}):`, errorText);
        let message = `API Error: ${response.status}`;
        try {
            const j = JSON.parse(errorText);
            message = j.error?.message || j.message || message;
        } catch (e) { /* keep default */ }
        throw new Error(message);
    }

    const json = await response.json();
    const { b64, url: imageUrl } = parseImagesResponse(json);
    if (b64) {
        console.log(`[${extensionName}] LinkAPI image received (b64_json, model: ${model})`);
        return { imageData: b64, mimeType: 'image/png' };
    }
    if (imageUrl) {
        console.log(`[${extensionName}] LinkAPI image received (url, fetching bytes, model: ${model})`);
        const imgResp = await fetch(imageUrl);
        const buf = await imgResp.arrayBuffer();
        return { imageData: arrayBufferToBase64(buf), mimeType: 'image/png' };
    }
    throw new Error('No image was returned by the API');
}

async function requestOpenAiImages({ apiKey, model, prompt, size, baseUrl }) {
    const response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || ''}`,
        },
        body: JSON.stringify(buildOpenAiImagesRequest({
            model,
            prompt,
            size,
            responseFormat: 'b64_json',
        })),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] OpenAI Images error (${response.status}):`, errorText);
        let message = `API Error: ${response.status}`;
        try {
            const json = JSON.parse(errorText);
            message = json.error?.message || json.message || message;
        } catch (e) { /* keep default */ }
        throw new Error(message);
    }

    const { b64, url: imageUrl } = parseOpenAiImagesResponse(await response.json());
    if (b64) {
        return { imageData: b64, mimeType: 'image/png' };
    }

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
        throw new Error(`Failed to download generated image: HTTP ${imageResponse.status}`);
    }
    return { imageData: arrayBufferToBase64(await imageResponse.arrayBuffer()), mimeType: 'image/png' };
}
async function fetchManagedProviderModels() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const ui = projectProviderUi(providerId, settings.model, { localEntries: getProviderModelEntries(settings, providerId) });
    if (!ui?.supportsModelDiscovery) return;

    const key = getProviderApiKey(settings, providerId);
    if (ui.requiresApiKey && !key) {
        toastr.warning(`Enter a ${ui.label} key first.`, 'Context Image Generation');
        return;
    }

    try {
        const fetched = await fetchProviderModels({ providerId, apiKey: key });
        setProviderModelEntries(settings, providerId, mergeFetchedModelEntries(getProviderModelEntries(settings, providerId), fetched.map((entry) => entry.id)));
        updateModelDropdown();
        renderModelManager();
        saveSettingsDebounced();
        toastr.success(`Loaded ${fetched.length} model(s).`, 'Context Image Generation');
    } catch (error) {
        console.error(`[${extensionName}] Fetch models failed:`, error);
        toastr.error(`Failed to fetch models: ${error.message}`, 'Context Image Generation');
    }
}
// Dev aid: reach the pure helpers from the DevTools console for verification.
window.cigDebug = Object.assign(window.cigDebug || {}, {
    isOpenAiImageModel,
    mapAspectRatioToSize,
    extractPromptText,
    parseImagesResponse,
    requestLinkApiImage,
});

function renderProviderDropdown() {
    const $providerSelect = $('#cig_provider').empty();
    for (const provider of projectProviderOptions()) {
        $providerSelect.append($('<option>').val(provider.id).text(provider.label || provider.id));
    }
}

function updateModelDropdown() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const localEntries = getProviderModelEntries(settings, providerId);
    const ui = projectProviderUi(providerId, settings.model, { localEntries });
    if (!ui) return;
    const $modelSelect = $('#cig_model').empty();
    for (const model of ui.models) {
        $modelSelect.append($('<option>').val(model.id).text(model.label));
    }
    settings.model = getModelFallback(providerId, settings.model, localEntries);
    $modelSelect.val(settings.model);
    toggleImageSizeVisibility();
}async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    let settingsMigrated = false;

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
            settingsMigrated = true;
        }
    }

    // Restore the single avatar-reference preference. Existing split settings
    // migrate once: either previously enabled avatar keeps references enabled.
    const cigSettings = extension_settings[extensionName];
    if (!cigSettings.provider_keys || typeof cigSettings.provider_keys !== 'object' || Array.isArray(cigSettings.provider_keys)) {
        cigSettings.provider_keys = {};
        settingsMigrated = true;
    }
    if (!cigSettings.provider_models || typeof cigSettings.provider_models !== 'object' || Array.isArray(cigSettings.provider_models)) {
        cigSettings.provider_models = {};
        settingsMigrated = true;
    }
    if (!Object.hasOwn(cigSettings.provider_keys, 'linkapi') && cigSettings.linkapi_key) {
        cigSettings.provider_keys.linkapi = cigSettings.linkapi_key;
        settingsMigrated = true;
    }
    if (cigSettings.use_char_avatar !== undefined || cigSettings.use_user_avatar !== undefined) {
        cigSettings.use_avatars = Boolean(cigSettings.use_char_avatar || cigSettings.use_user_avatar);
        delete cigSettings.use_char_avatar;
        delete cigSettings.use_user_avatar;
        settingsMigrated = true;
    }

    if (settingsMigrated) {
        saveSettingsDebounced();
    }


    $('#cig_provider').val(extension_settings[extensionName].provider);
    updateModelDropdown();
    $('#cig_model').val(extension_settings[extensionName].model);
    $('#cig_provider_api_key').val(getProviderApiKey(cigSettings, cigSettings.provider || 'makersuite'));
    $('#cig_linkapi_use_legacy_routing').prop('checked', cigSettings.linkapi_use_legacy_routing);
    $('#cig_aspect_ratio').val(extension_settings[extensionName].aspect_ratio);
    $('#cig_image_size').val(extension_settings[extensionName].image_size);
    $('#cig_thinking_level').val(extension_settings[extensionName].thinking_level);
    $('#cig_use_google_search').prop('checked', extension_settings[extensionName].use_google_search);
    $('#cig_use_avatars').prop('checked', extension_settings[extensionName].use_avatars);
    $('#cig_include_descriptions').prop('checked', extension_settings[extensionName].include_descriptions);
    $('#cig_use_previous_image').prop('checked', extension_settings[extensionName].use_previous_image);
    $('#cig_regenerate_on_swipe').prop('checked', extension_settings[extensionName].regenerate_on_swipe);
    $('#cig_auto_generate').val(extension_settings[extensionName].auto_generate);
    $('#cig_message_depth').val(extension_settings[extensionName].message_depth);
    $('#cig_system_instruction').val(extension_settings[extensionName].system_instruction);

    toggleImageSizeVisibility();
    toggleProviderSpecificSettings();
    renderModelManager();
    renderGallery();
}

function toggleProviderSpecificSettings() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const ui = projectProviderUi(providerId, settings.model, { localEntries: getProviderModelEntries(settings, providerId) });
    if (!ui) return;
    $('#cig_provider_key_container').toggle(ui.requiresApiKey);
    $('#cig_provider_advanced_container').toggle(ui.showsLegacyRecovery);
    $('#cig_provider_api_key_label').text(ui.apiKeyLabel);
    $('#cig_provider_api_key').val(getProviderApiKey(settings, settings.provider));
    $('#cig_provider_info').text(ui.providerInfo || '').toggle(Boolean(ui.providerInfo));
}

function renderModelManager() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const localEntries = getProviderModelEntries(settings, providerId);
    const ui = projectProviderUi(providerId, settings.model, { localEntries });
    if (!ui) return;

    const $list = $('#cig_managed_model_list').empty();
    for (const model of ui.models) {
        const isLocal = localEntries.some((entry) => entry.id === model.id);
        $list.append($('<option>').val(model.id).text(`${model.label}${isLocal ? ' (local)' : ' (built-in)'}`));
    }
    $list.val(settings.model);
    $('#cig_managed_model_id').val(settings.model || '');
    const provider = getProviderDefinition(providerId);
    const selectedEntry = localEntries.find((entry) => entry.id === settings.model);
    const $transport = $('#cig_managed_model_transport').empty();
    for (const transport of Object.keys(provider?.transports || {})) {
        const label = transport === 'sillyTavernGeminiProxy' ? 'Gemini-compatible proxy' : transport === 'openAiImages' ? 'OpenAI Images API' : transport;
        $transport.append($('<option>').val(transport).text(label));
    }
    $transport.val(selectedEntry?.transport || provider?.models?.find((model) => model.id === settings.model)?.transport || $transport.val());
    $('#cig_managed_model_transport_container').toggle($transport.children().length > 1);
    $('#cig_fetch_provider_models').toggle(ui.supportsModelDiscovery);
    $('#cig_model_discovery_note')
        .text(ui.modelDiscoveryExperimental ? 'Experimental: model discovery uses the provider’s standard /models endpoint. A failed fetch keeps your current list.' : '')
        .toggle(ui.modelDiscoveryExperimental);
    $('#cig_remove_model').prop('disabled', !localEntries.some((entry) => entry.id === settings.model));
}

function refreshManagedModels() {
    updateModelDropdown();
    toggleImageSizeVisibility();
    toggleProviderSpecificSettings();
    renderModelManager();
}

function saveManagedModel(operation) {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const id = $('#cig_managed_model_id').val().trim();
    if (!id) {
        toastr.warning('Enter an actual model ID.', 'Context Image Generation');
        return;
    }
    const previousId = $('#cig_managed_model_list').val();
    const localEntries = getProviderModelEntries(settings, providerId);
    const transport = $('#cig_managed_model_transport').val() || undefined;
    const type = operation === 'save' && localEntries.some((entry) => entry.id === previousId) ? 'replace' : 'upsert';
    setProviderModelEntries(settings, providerId, updateLocalModelEntries(localEntries, { type, previousId, id, source: 'manual', transport, supportsReferenceImages: transport === 'sillyTavernGeminiProxy', supportsSize: false }));
    settings.model = id;
    refreshManagedModels();
    saveSettingsDebounced();
}

function removeManagedModel() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const selectedId = $('#cig_managed_model_list').val();
    const localEntries = getProviderModelEntries(settings, providerId);
    if (!localEntries.some((entry) => entry.id === selectedId)) {
        toastr.info('Built-in models stay available. Select a different ID or remove a local model.', 'Context Image Generation');
        return;
    }
    setProviderModelEntries(settings, providerId, updateLocalModelEntries(localEntries, { type: 'remove', id: selectedId }));
    settings.model = getModelFallback(providerId, settings.model, getProviderModelEntries(settings, providerId));
    refreshManagedModels();
    saveSettingsDebounced();
}
function toggleImageSizeVisibility() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const ui = projectProviderControls(providerId, settings.model, settings.image_size, { localEntries: getProviderModelEntries(settings, providerId) });
    if (!ui) return;
    if (settings.image_size !== ui.imageSize) settings.image_size = ui.imageSize;
    const hasImageSizes = ui.imageSizeOptions.length > 0;
    $('#cig_image_size_container').toggle(hasImageSizes);
    $('#cig_flash2_options').toggle(ui.supportsThinking || ui.supportsGoogleSearch);
    $('#cig_model_note').text(ui.modelNote || '').toggle(Boolean(ui.modelNote));
    $('#cig_avatar_reference_option').toggle(ui.supportsReferenceImages);
    $('#cig_previous_image_reference_option').toggle(ui.supportsReferenceImages);
    if (hasImageSizes) updateSizeDropdown(ui.imageSizeOptions);
}

function updateSizeDropdown(imageSizeOptions) {
    const $sizeSelect = $('#cig_image_size');
    const currentValue = extension_settings[extensionName].image_size || '';
    $sizeSelect.empty().append('<option value="">Default</option>');
    for (const option of imageSizeOptions) $sizeSelect.append($('<option>').val(option.value).text(option.label));
    $sizeSelect.val(currentValue);
}

async function getUserAvatar() {
    try {
        let avatarUrl = getAvatarPath(user_avatar);
        if (!avatarUrl) return null;

        const response = await fetch(avatarUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';
        const data = parts[1] || base64;
        const userName = name1 || 'User';

        return { mimeType, data, role: 'user', name: userName };
    } catch (error) {
        console.warn(`[${extensionName}] Error fetching user avatar:`, error);
        return null;
    }
}

async function getCharacterAvatar() {
    const context = getContext();
    const character = context.characters[context.characterId];
    if (!character?.avatar) return null;

    try {
        const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
        const response = await fetch(avatarUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';

        return {
            mimeType,
            data: parts[1] || base64,
            role: 'character',
            name: context.name2 || 'Character',
        };
    } catch (error) {
        console.warn(`[${extensionName}] Error fetching character avatar:`, error);
        return null;
    }
}

function getRecentMessages(depth, fromMessageId = null) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return [];

    const messages = [];
    const startIndex = fromMessageId !== null ? fromMessageId : chat.length - 1;

    for (let i = startIndex; i >= 0 && messages.length < depth; i--) {
        const message = chat[i];
        if (message.mes && !message.is_system) {
            const charName = context.name2 || 'Character';
            const userName = name1 || 'User';
            messages.push({
                text: message.mes,
                isUser: message.is_user,
                name: message.is_user ? userName : charName,
            });
        }
    }

    return messages.reverse();
}

function getCharacterDescriptions() {
    const context = getContext();
    const character = context.characters[context.characterId];
    const userName = name1 || context.name1 || 'User';

    return {
        user_name: userName,
        user_persona: power_user.persona_description || '',
        char_name: context.name2 || 'Character',
        char_description: character?.description || '',
        char_scenario: character?.scenario || '',
    };
}

async function buildMessages(prompt, sender = null, messageId = null) {
    const settings = extension_settings[extensionName];
    const messages = [];
    const contentParts = [];

    if (settings.system_instruction) {
        contentParts.push({ type: 'text', text: settings.system_instruction });
    }

    if (settings.include_descriptions) {
        const descriptions = getCharacterDescriptions();
        let descText = '';
        if (descriptions.user_persona) {
            descText += `[${descriptions.user_name} (User) Description]: ${descriptions.user_persona}\n\n`;
        }
        if (descriptions.char_description) {
            descText += `[${descriptions.char_name} (Character) Description]: ${descriptions.char_description}\n\n`;
        }
        if (descriptions.char_scenario) {
            descText += `[Current Scenario]: ${descriptions.char_scenario}\n\n`;
        }
        if (descText) {
            contentParts.push({ type: 'text', text: descText.trim() });
        }
    }

    const depth = settings.message_depth || 1;

    if (messageId !== null || sender !== null) {
        const recentMessages = getRecentMessages(depth, messageId);

        if (recentMessages.length > 0) {
            let storyContext = '[Story Context - Generate an image for the final message]:\n\n';

            for (const msg of recentMessages) {
                const senderTag = msg.isUser ? '{{user}}' : '{{char}}';
                storyContext += `[${senderTag} (${msg.name})]: ${msg.text}\n\n`;
            }

            contentParts.push({ type: 'text', text: storyContext.trim() });
        } else {
            if (sender) {
                contentParts.push({ type: 'text', text: `[Message from ${sender}]: ${prompt}` });
            } else {
                contentParts.push({ type: 'text', text: prompt });
            }
        }
    } else {
        contentParts.push({ type: 'text', text: prompt });
    }

    const providerId = settings.provider || 'makersuite';
    const supportsReferenceImages = projectProviderUi(providerId, settings.model, { localEntries: getProviderModelEntries(settings, providerId) })?.supportsReferenceImages !== false;

    if (supportsReferenceImages && settings.use_previous_image && settings.gallery && settings.gallery.length > 0) {
        const dataUrl = await galleryItemToDataUrl(settings.gallery[0]);
        if (dataUrl) {
            console.log(`[${extensionName}] Adding previous generated image as reference`);
            contentParts.push({ type: 'text', text: '[Reference: Previously generated image for style consistency]' });
            contentParts.push({
                type: 'image_url',
                image_url: { url: dataUrl },
            });
        }
    }

    if (supportsReferenceImages && settings.use_avatars) {
        const charAvatarData = await getCharacterAvatar();
        if (charAvatarData) {
            console.log(`[${extensionName}] Adding character avatar for: ${charAvatarData.name}`);
            contentParts.push({ type: 'text', text: `[Reference image for {{char}}]` });
            contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${charAvatarData.mimeType};base64,${charAvatarData.data}` },
            });
        }
    }

    if (supportsReferenceImages && settings.use_avatars) {
        const userAvatarData = await getUserAvatar();
        if (userAvatarData) {
            console.log(`[${extensionName}] Adding user avatar for: ${userAvatarData.name}`);
            contentParts.push({ type: 'text', text: `[Reference image for {{user}}]` });
            contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${userAvatarData.mimeType};base64,${userAvatarData.data}` },
            });
        }
    }

    messages.push({ role: 'user', content: contentParts });
    return messages;
}

async function requestSillyTavernImage(requestBody) {
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] API Error Response:`, errorText);
        let errorMessage = `API Error: ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (e) { }
        throw new Error(errorMessage);
    }

    const result = await response.json();
    const responseContent = result.responseContent;

    if (responseContent?.parts) {
        for (const part of responseContent.parts) {
            if (part.inlineData?.data) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                return { imageData: part.inlineData.data, mimeType: mimeType };
            }
        }
    }

    const textContent = result.choices?.[0]?.message?.content;
    if (textContent) {
        console.log(`[${extensionName}] Text response received:`, textContent);
        throw new Error('Model returned text instead of image');
    }

    throw new Error('No image was returned by the API');
}

// Preserves the pre-adapter LinkAPI behavior for the explicit recovery switch.
async function generateLegacyLinkApiImage(settings, messages) {
    const isFlash2 = /gemini-3\.1/.test(settings.model);

    if (isOpenAiImageModel(settings.model)) {
        return await requestLinkApiImage({
            apiKey: getProviderApiKey(settings, 'linkapi'),
            model: settings.model,
            prompt: extractPromptText(messages),
            size: mapAspectRatioToSize(settings.aspect_ratio),
        });
    }

    const requestBody = {
        chat_completion_source: 'makersuite',
        model: settings.model,
        messages,
        max_tokens: 8192,
        temperature: 1,
        request_images: true,
        request_image_aspect_ratio: settings.aspect_ratio || '1:1',
        request_image_resolution: settings.image_size || undefined,
        stream: false,
        reverse_proxy: 'https://api.linkapi.ai',
        proxy_password: settings.linkapi_key || '',
    };

    if (isFlash2) {
        const thinkingLevel = settings.thinking_level || 'auto';
        if (thinkingLevel !== 'auto') {
            requestBody.reasoning_effort = thinkingLevel;
        }
        if (settings.use_google_search) {
            requestBody.enable_web_search = true;
        }
    }

    return await requestSillyTavernImage(requestBody);
}

function getGenerationKey(prompt, messageId) {
    return messageId === null || messageId === undefined ? 'prompt:' + String(prompt).trim() : 'message:' + messageId;
}

async function generateImageFromPrompt(prompt, sender = null, messageId = null) {
    return await generationCoordinator.run(getGenerationKey(prompt, messageId), () => generateImageFromPromptInternal(prompt, sender, messageId));
}

async function generateImageFromPromptInternal(prompt, sender = null, messageId = null) {
    const settings = extension_settings[extensionName];
    const messages = await buildMessages(prompt, sender, messageId);
    const selectedProvider = settings.provider || 'makersuite';

    let providerRoute = resolveProviderRoute(selectedProvider, settings.model);
    const localModel = getProviderModelEntries(settings, selectedProvider).find((entry) => entry.id === settings.model);
    if (!providerRoute.model && localModel?.transport) {
        providerRoute = { ...providerRoute, model: { id: settings.model, ...localModel }, transport: localModel.transport };
    }

    if (selectedProvider === 'linkapi' && settings.linkapi_use_legacy_routing === true) {
        return await generateLegacyLinkApiImage(settings, messages);
    }

    if (providerRoute.provider && providerRoute.transport) {
        return await dispatchProviderRoute({
            route: providerRoute,
            modelId: settings.model,
            messages,
            prompt: extractPromptText(messages),
            apiKey: getProviderApiKey(settings, selectedProvider),
            aspectRatio: settings.aspect_ratio,
            imageSize: settings.image_size,
            isFlash2: /gemini-3\.1/.test(settings.model),
            thinkingLevel: settings.thinking_level,
            useGoogleSearch: settings.use_google_search,
            mapAspectRatioToSize,
            requestOpenAiImages,
            requestSillyTavernImage,
        });
    }
    if (requiresAdapterRoute(providerRoute)) {
        throw new Error(`No ${providerRoute.provider.id} transport is configured for model: ${settings.model}`);
    }
    const isFlash2 = /gemini-3\.1/.test(settings.model);
    const requestBody = {
        chat_completion_source: selectedProvider,
        model: settings.model,
        messages,
        max_tokens: 8192,
        temperature: 1,
        request_images: true,
        request_image_aspect_ratio: settings.aspect_ratio || '1:1',
        request_image_resolution: settings.image_size || undefined,
        stream: false,
        reverse_proxy: oai_settings.reverse_proxy || '',
        proxy_password: oai_settings.proxy_password || '',
    };

    if (isFlash2) {
        const thinkingLevel = settings.thinking_level || 'auto';
        if (thinkingLevel !== 'auto') {
            requestBody.reasoning_effort = thinkingLevel;
        }
        if (settings.use_google_search) {
            requestBody.enable_web_search = true;
        }
    }

    console.log(`[${extensionName}] Generating image with provider: ${settings.provider}, model:`, settings.model);
    return await requestSillyTavernImage(requestBody);
}
// Resolve the <img> src for a gallery item. Supports new file-based items ({url})
// and legacy base64 items ({imageData}) so pre-existing galleries keep working.
function galleryItemSrc(item) {
    if (item.url) return item.url;
    if (item.imageData) return `data:image/png;base64,${item.imageData}`;
    return '';
}

// Get a base64 data URL for a gallery item (used for the "previous image"
// reference, which must be sent inline). Fetches the file for file-based items.
async function galleryItemToDataUrl(item) {
    if (!item) return null;
    if (item.imageData) return `data:image/png;base64,${item.imageData}`;
    if (item.url) {
        try {
            const resp = await fetch(item.url);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            return await getBase64Async(blob);
        } catch (error) {
            console.warn(`[${extensionName}] Failed to load previous image for reference:`, error);
            return null;
        }
    }
    return null;
}

async function addToGallery(imageData, prompt, messageId = null, existingPath = null) {
    const settings = extension_settings[extensionName];

    if (!settings.gallery) {
        settings.gallery = [];
    }

    // Store the image as a file and keep only its path + metadata in settings.json
    // (never base64). Reuse an already-saved file path when the caller has one.
    let url = existingPath;
    if (!url) {
        try {
            url = await saveBase64AsFile(imageData, extensionName, `cig_gallery_${Date.now()}`, 'png');
        } catch (error) {
            console.error(`[${extensionName}] Failed to save gallery image:`, error);
            return;
        }
    }

    settings.gallery.unshift({
        url: url,
        prompt: prompt.substring(0, 200),
        timestamp: Date.now(),
        messageId: messageId,
    });

    if (settings.gallery.length > MAX_GALLERY_SIZE) {
        settings.gallery = settings.gallery.slice(0, MAX_GALLERY_SIZE);
    }

    saveSettingsDebounced();
    renderGallery();
}

function renderGallery() {
    const settings = extension_settings[extensionName];
    const gallery = settings.gallery || [];
    const container = $('#cig_gallery_container');
    const emptyMsg = $('#cig_gallery_empty');

    container.empty();

    if (gallery.length === 0) {
        emptyMsg.show();
        return;
    }

    emptyMsg.hide();

    // Build via DOM construction (not string interpolation) so prompt text can't
    // break the markup or inject HTML.
    for (let i = 0; i < gallery.length; i++) {
        const item = gallery[i];
        const thumb = $('<div class="cig_gallery_item"></div>')
            .attr('data-index', i)
            .attr('title', item.prompt || '');
        $('<img>').attr('src', galleryItemSrc(item)).appendTo(thumb);
        $('<div class="cig_gallery_item_overlay"></div>')
            .append($('<i class="fa-solid fa-trash cig_gallery_delete"></i>').attr('data-index', i))
            .appendTo(thumb);
        container.append(thumb);
    }
}

async function generateImage() {
    const settings = extension_settings[extensionName];
    const depth = settings.message_depth || 1;
    const recentMessages = getRecentMessages(depth);

    if (recentMessages.length === 0) {
        toastr.warning('No message found to generate image from.', 'Context Image Generation');
        return;
    }

    const generateBtn = $('#cig_generate_btn');
    generateBtn.addClass('generating');
    generateBtn.find('i').removeClass('fa-image').addClass('fa-spinner fa-spin');

    const lastMsg = recentMessages[recentMessages.length - 1];
    const sender = lastMsg.isUser ? `{{user}} (${lastMsg.name})` : `{{char}} (${lastMsg.name})`;

    try {
        const result = await generateImageFromPrompt(lastMsg.text, sender, null);

        if (result) {
            const imageDataUrl = `data:${result.mimeType};base64,${result.imageData}`;
            $('#cig_preview_image').attr('src', imageDataUrl);
            $('#cig_preview_container').show();
            await addToGallery(result.imageData, lastMsg.text, null);
        }

    } catch (error) {
        console.error(`[${extensionName}] Generation error:`, error);
        toastr.error(`Failed to generate image: ${error.message}`, 'Context Image Generation');
    } finally {
        generateBtn.removeClass('generating');
        generateBtn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-image');
    }
}

async function cigMessageButton($icon) {
    const context = getContext();

    if ($icon.hasClass('cig_busy')) {
        console.log('[CIG] Already generating...');
        return;
    }

    const messageElement = $icon.closest('.mes');
    const messageId = Number(messageElement.attr('mesid'));
    const message = context.chat[messageId];

    if (!message) {
        console.error('[CIG] Could not find message for generation button');
        return;
    }

    const prompt = message.mes;
    if (!prompt) {
        toastr.warning('No message content to generate from.', 'Context Image Generation');
        return;
    }

    const charName = context.name2 || 'Character';
    const userName = name1 || 'User';
    const sender = message.is_user ? `{{user}} (${userName})` : `{{char}} (${charName})`;

    $icon.addClass('cig_busy');
    $icon.removeClass('fa-wand-magic-sparkles').addClass('fa-spinner fa-spin');

    try {
        await attachGeneratedImage(message, messageElement, prompt, sender, messageId);
    } catch (error) {
        console.error(`[${extensionName}] Message generation error:`, error);
        toastr.error(`Failed to generate: ${error.message}`, 'Context Image Generation');
    } finally {
        $icon.removeClass('cig_busy fa-spinner fa-spin').addClass('fa-wand-magic-sparkles');
    }
}

// Generate an image for a message and attach it to that message's media array.
// Shared by the wand button and the swipe-to-regenerate handler.
async function attachGeneratedImage(message, messageElement, prompt, sender, messageId) {
    const result = await generateImageFromPrompt(prompt, sender, messageId);
    if (!result) return false;

    const fileName = `cig_${Date.now()}`;
    const filePath = await saveBase64AsFile(result.imageData, extensionName, fileName, 'png');
    console.log(`[${extensionName}] Image saved to:`, filePath);

    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }
    if (!Array.isArray(message.extra.media)) {
        message.extra.media = [];
    }
    if (!message.extra.media_display) {
        message.extra.media_display = MEDIA_DISPLAY.GALLERY;
    }

    message.extra.media.push({
        url: filePath,
        type: MEDIA_TYPE.IMAGE,
        title: prompt.substring(0, 100),
        source: MEDIA_SOURCE.GENERATED,
    });
    message.extra.media_index = message.extra.media.length - 1;
    message.extra.inline_image = true;

    appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
    await saveChatConditional();
    await addToGallery(result.imageData, prompt, messageId, filePath);
    return true;
}

// Regenerate a fresh variation when the user swipes RIGHT past the last image of
// one of OUR generated images. Opt-in via the regenerate_on_swipe setting.
async function onCigImageSwiped({ message, element, direction }) {
    const settings = extension_settings[extensionName];
    if (!settings.regenerate_on_swipe) return;
    if (direction !== SWIPE_DIRECTION.RIGHT) return;

    const media = message?.extra?.media;
    if (!Array.isArray(media) || media.length === 0) return;

    const idx = message.extra.media_index ?? (media.length - 1);
    if (idx !== media.length - 1) return; // only an overswipe past the last image

    const current = media[idx];
    if (!current?.url || !current.url.includes(extensionName)) return; // only our own images

    const messageId = Number(element.attr('mesid') ?? element.closest('.mes').attr('mesid'));
    const context = getContext();
    const charName = context.name2 || 'Character';
    const userName = name1 || 'User';
    const sender = message.is_user ? `{{user}} (${userName})` : `{{char}} (${charName})`;
    const messageMedia = element.find('.mes_img, .mes_video');

    try {
        messageMedia.addClass('fa-fade');
        await attachGeneratedImage(message, element, message.mes, sender, messageId);
    } catch (error) {
        console.error(`[${extensionName}] Swipe-regenerate error:`, error);
        toastr.error(`Failed to regenerate: ${error.message}`, 'Context Image Generation');
    } finally {
        messageMedia.removeClass('fa-fade');
    }
}

async function autoGenerateForMessage(messageId) {
    const settings = extension_settings[extensionName];
    if (settings.auto_generate === 'off') return;

    const context = getContext();
    const message = context.chat[messageId];
    if (!message || !message.mes || message.is_system) return;

    // Check if we should generate for this message type
    if (settings.auto_generate === 'bot' && message.is_user) return;

    // Wait for the button to be injected, then click it
    setTimeout(() => {
        const messageElement = $(`.mes[mesid="${messageId}"]`);
        const $icon = messageElement.find('.cig_message_gen');
        if ($icon.length > 0 && !$icon.hasClass('cig_busy')) {
            console.log(`[${extensionName}] Auto-generating image for message ${messageId}`);
            cigMessageButton($icon);
        }
    }, 200);
}

async function slashCommandHandler(args, prompt) {
    const trimmedPrompt = String(prompt).trim();

    if (!trimmedPrompt) {
        toastr.warning('Please provide a prompt for image generation.', 'Context Image Generation');
        return '';
    }

    try {
        const result = await generateImageFromPrompt(trimmedPrompt, null, null);

        if (result) {
            const imageDataUrl = `data:${result.mimeType};base64,${result.imageData}`;
            $('#cig_preview_image').attr('src', imageDataUrl);
            $('#cig_preview_container').show();
            await addToGallery(result.imageData, trimmedPrompt, null);
            return imageDataUrl;
        }
    } catch (error) {
        console.error(`[${extensionName}] Slash command generation error:`, error);
        toastr.error(`Failed to generate: ${error.message}`, 'Context Image Generation');
    }

    return '';
}

function injectMessageButton(messageId) {
    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (messageElement.length === 0) return;

    const extraButtons = messageElement.find('.extraMesButtons');
    if (extraButtons.length === 0) return;

    if (extraButtons.find('.cig_message_gen').length > 0) return;

    const cigButton = $(`
        <div title="Generate with Gemini 🍌" 
             class="mes_button cig_message_gen fa-solid fa-wand-magic-sparkles" 
             data-i18n="[title]Generate with Gemini 🍌">
        </div>
    `);

    const sdButton = extraButtons.find('.sd_message_gen');
    if (sdButton.length) {
        sdButton.after(cigButton);
    } else {
        extraButtons.prepend(cigButton);
    }
}

function injectAllMessageButtons() {
    $('.mes').each(function () {
        const messageId = $(this).attr('mesid');
        if (messageId !== undefined) {
            injectMessageButton(Number(messageId));
        }
    });
}

async function clearGallery() {
    if (!confirm('Are you sure you want to clear the gallery? This cannot be undone.')) {
        return;
    }

    extension_settings[extensionName].gallery = [];
    saveSettingsDebounced();
    renderGallery();
    toastr.info('Gallery cleared.', 'Context Image Generation');
}

function viewGalleryImage(index) {
    const settings = extension_settings[extensionName];
    const item = settings.gallery[index];
    if (!item) return;

    const popup = $(`
        <div class="cig_popup_overlay">
            <div class="cig_popup">
                <div class="cig_popup_header">
                    <span></span>
                    <i class="fa-solid fa-xmark cig_popup_close"></i>
                </div>
                <img />
                <div class="cig_popup_prompt"></div>
            </div>
        </div>
    `);

    // Set text/attributes via jQuery so the prompt is escaped, never injected.
    popup.find('.cig_popup_header span').text(new Date(item.timestamp).toLocaleString());
    popup.find('.cig_popup img').attr('src', galleryItemSrc(item));
    popup.find('.cig_popup_prompt').text(item.prompt || '');

    popup.on('click', '.cig_popup_close, .cig_popup_overlay', function (e) {
        if (e.target === this || $(e.target).hasClass('cig_popup_close')) {
            popup.remove();
        }
    });

    $('body').append(popup);
}

function deleteGalleryImage(index) {
    const settings = extension_settings[extensionName];
    settings.gallery.splice(index, 1);
    saveSettingsDebounced();
    renderGallery();
}

jQuery(async () => {
    console.log(`[${extensionName}] Initializing extension...`);

    try {
        const response = await fetch(`/scripts/extensions/third-party/${extensionName}/settings.html`);
        if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);
        const settingsHtml = await response.text();
        $('#extensions_settings').append(settingsHtml);
    } catch (error) {
        console.error(`[${extensionName}] Error loading settings template:`, error);
        toastr.error('Failed to load extension settings.', 'Context Image Generation');
        return;
    }

    renderProviderDropdown();
    await loadSettings();

    $('#cig_provider').on('change', function () {
        extension_settings[extensionName].provider = $(this).val();
        updateModelDropdown();
        toggleImageSizeVisibility();
        toggleProviderSpecificSettings();
        renderModelManager();
        saveSettingsDebounced();
    });

    $('#cig_provider_api_key').on('input', function () {
        const settings = extension_settings[extensionName];
        const provider = settings.provider || 'makersuite';
        if (projectProviderUi(provider, settings.model)?.requiresApiKey) {
            setProviderApiKey(settings, provider, $(this).val());
            saveSettingsDebounced();
        }
    });

    $('#cig_linkapi_use_legacy_routing').on('change', function () {
        extension_settings[extensionName].linkapi_use_legacy_routing = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_fetch_provider_models').on('click', fetchManagedProviderModels);
    $('#cig_managed_model_list').on('change', function () {
        const selectedId = $(this).val() || '';
        $('#cig_managed_model_id').val(selectedId);
        const settings = extension_settings[extensionName];
        const providerId = settings.provider || 'makersuite';
        $('#cig_remove_model').prop('disabled', !getProviderModelEntries(settings, providerId).some((entry) => entry.id === selectedId));
    });
    $('#cig_add_model').on('click', () => saveManagedModel('add'));
    $('#cig_save_model').on('click', () => saveManagedModel('save'));
    $('#cig_remove_model').on('click', removeManagedModel);

    $('#cig_model').on('change', function () {
        extension_settings[extensionName].model = $(this).val();
        toggleImageSizeVisibility();
        renderModelManager();
        saveSettingsDebounced();
    });

    $('#cig_aspect_ratio').on('change', function () {
        extension_settings[extensionName].aspect_ratio = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_image_size').on('change', function () {
        extension_settings[extensionName].image_size = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_thinking_level').on('change', function () {
        extension_settings[extensionName].thinking_level = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_use_google_search').on('change', function () {
        extension_settings[extensionName].use_google_search = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_use_avatars').on('change', function () {
        extension_settings[extensionName].use_avatars = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_regenerate_on_swipe').on('change', function () {
        extension_settings[extensionName].regenerate_on_swipe = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_include_descriptions').on('change', function () {
        extension_settings[extensionName].include_descriptions = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_use_previous_image').on('change', function () {
        extension_settings[extensionName].use_previous_image = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_auto_generate').on('change', function () {
        extension_settings[extensionName].auto_generate = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_message_depth').on('change', function () {
        let value = parseInt($(this).val(), 10);
        if (isNaN(value) || value < 1) value = 1;
        if (value > 10) value = 10;
        $(this).val(value);
        extension_settings[extensionName].message_depth = value;
        saveSettingsDebounced();
    });

    $('#cig_system_instruction').on('input', function () {
        extension_settings[extensionName].system_instruction = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_generate_btn').on('click', generateImage);
    $('#cig_clear_gallery').on('click', clearGallery);

    $(document).on('click', '.cig_gallery_item img', function () {
        const index = $(this).closest('.cig_gallery_item').data('index');
        viewGalleryImage(index);
    });

    $(document).on('click', '.cig_gallery_delete', function (e) {
        e.stopPropagation();
        const index = $(this).data('index');
        deleteGalleryImage(index);
    });

    $(document).on('click', '.cig_message_gen', function (e) {
        cigMessageButton($(e.currentTarget));
    });

    eventSource.on(event_types.MESSAGE_RENDERED, (messageId) => {
        injectMessageButton(messageId);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(injectAllMessageButtons, 100);
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        setTimeout(injectAllMessageButtons, 100);
        autoGenerateForMessage(messageId);
    });

    eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
        autoGenerateForMessage(messageId);
    });

    eventSource.on(event_types.CHAT_CREATED, () => {
        setTimeout(injectAllMessageButtons, 100);
    });

    eventSource.on(event_types.IMAGE_SWIPED, onCigImageSwiped);

    setTimeout(injectAllMessageButtons, 500);

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'proimagine',
        returns: 'URL of the generated image, or an empty string if generation failed',
        callback: slashCommandHandler,
        aliases: ['proimg', 'geminiimg'],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Prompt for image generation',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Generate an image using Gemini Pro image generation. Example: /proimagine a beautiful sunset over mountains',
    }));

    console.log(`[${extensionName}] Extension loaded successfully!`);
});

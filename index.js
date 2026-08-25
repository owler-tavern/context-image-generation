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
import { getModelDefinition, getProviderDefinition, resolveProviderRoute, getProviderDefinitions, getReferenceImageCapability, requiresAdapterRoute } from './lib/providers/registry.js';
import { getModelFallback, projectProviderControls, projectProviderOptions, projectProviderUi } from './lib/providers/ui-projection.js';
import { mergeFetchedModelEntries, updateLocalModelEntries, mergeFetchedModelRecords, updateModelRecords, toLegacyModelEntries } from './lib/providers/model-manager.js';
import { discoverProviderModels, createModelDiscoveryCoordinator } from './lib/providers/model-discovery.js';
import { buildOpenAiImagesRequest, parseOpenAiImagesResponse } from './lib/providers/openai-images.js';
import { dispatchProviderRoute } from './lib/providers/dispatch.js';
import { createRunCoordinator } from './lib/generation-coordinator.js';
import { buildFocusedMessageContent } from './lib/rp-selection.js';
import { captureWandGenerationInput } from './lib/rp-wand.js';
import { attachGeneratedImageSafely } from './lib/rp-attachment.js';
import { buildGenerationKey, captureMessageTarget, validateMessageTarget } from './lib/rp-target.js';
import { attachNormalizedProviderError, getSafeProviderErrorLogFields, normalizeProviderError } from './lib/providers/errors.js';
import { captureAutoGenerationInput, validateAutoGenerationInput } from './lib/rp-auto.js';
import { createChatLifecycleEpoch } from './lib/rp-lifecycle.js';
import { createGenerationPlan } from './lib/generation-plan.js';
import { migrateProviderSettings } from './lib/providers/settings-migration.js';
import { materializeReferences } from './lib/rp/references.js';
import { downloadImageData } from './lib/providers/safe-image-download.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import {
    addAppearanceLook,
    buildAppearanceReferenceCandidates,
    galleryArtifactKey,
    listAppearanceIdentityChoices,
    materializeAppearanceAssets,
    migrateAppearanceLibrary,
    removeAppearanceLook,
    getProtectedGalleryArtifactIds,
    trimGalleryToLimit,
    setActiveAppearanceLook,
} from './lib/rp/appearance-library.js';

const extensionName = 'context-image-generation';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    provider: 'makersuite',
    model: 'gemini-2.5-flash-image',
    linkapi_key: '',
    provider_keys: {},
    provider_models: {},
    model_discovery: {},
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
    rp_library: { schema: 1, identities: {}, assets: {}, preferences: { sceneContinuity: false } },
};

const MAX_GALLERY_SIZE = 50;
const generationCoordinator = createRunCoordinator();
let currentGenerationRunId = null;
generationCoordinator.subscribe((event) => {
    if (event.to === 'running' || event.to === 'cancelling') currentGenerationRunId = event.runId;
    if (['completed', 'failed', 'stale', 'cancelled'].includes(event.to) && currentGenerationRunId === event.runId) currentGenerationRunId = null;
    const cancelControl = $('#cig_cancel_generation');
    if (cancelControl.length) cancelControl.prop('disabled', !currentGenerationRunId).toggle(!!currentGenerationRunId);
});
const modelDiscoveryCoordinator = createModelDiscoveryCoordinator();
let modelDiscoveryUiSequence = 0;
const chatLifecycleEpoch = createChatLifecycleEpoch();

function setBusyState(control, busy, { busyClass = 'generating', busyTitle = 'Working…' } = {}) {
    const $control = control?.jquery ? control : $(control);
    if (!$control?.length) return;
    if (busy) {
        if (!$control.attr('data-cig-idle-title')) $control.attr('data-cig-idle-title', $control.attr('title') || '');
        $control.addClass(busyClass)
            .attr({ 'aria-busy': 'true', 'aria-disabled': 'true', title: busyTitle })
            .prop('disabled', true);
    } else {
        const idleTitle = $control.attr('data-cig-idle-title');
        $control.removeClass(busyClass)
            .attr({ 'aria-busy': 'false', 'aria-disabled': 'false' })
            .prop('disabled', false);
        if (idleTitle !== undefined) $control.attr('title', idleTitle).removeAttr('data-cig-idle-title');
    }
}

function showGenerationError(error, operation = 'Image generation') {
    const settings = extension_settings[extensionName] || {};
    const normalized = error?.category && error?.userMessage
        ? error
        : normalizeProviderError(error, {
            providerId: settings.provider || 'unknown',
            modelId: settings.model,
        });
    console.error(`[${extensionName}] ${operation} error:`, getSafeProviderErrorLogFields(normalized));
    toastr.error(normalized.userMessage, 'Context Image Generation');
}

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
    const records = settings.model_records?.[providerId];
    if (Array.isArray(records)) return records;
    const entries = settings.provider_models?.[providerId];
    return Array.isArray(entries) ? entries : [];
}

// The legacy recovery route remains an explicit manual capability. It is not
// consulted by the ordinary wand/automation pipeline, which always dispatches
// through the resolved schema-2 plan.
function isManualLegacyLinkApiRecovery(selectedProvider, settings) {
    return selectedProvider === 'linkapi' && settings.linkapi_use_legacy_routing === true;
}

function setProviderModelRecords(settings, providerId, records) {
    if (!settings.model_records || typeof settings.model_records !== 'object' || Array.isArray(settings.model_records)) settings.model_records = {};
    if (!settings.provider_models || typeof settings.provider_models !== 'object' || Array.isArray(settings.provider_models)) settings.provider_models = {};
    settings.model_records[providerId] = records;
    settings.provider_models[providerId] = toLegacyModelEntries(records);
}

function getProviderDiscoveryState(settings, providerId) {
    const states = settings.model_discovery;
    return states && typeof states === 'object' && !Array.isArray(states) && states[providerId] && typeof states[providerId] === 'object'
        ? states[providerId]
        : {};
}

function setProviderDiscoveryState(settings, providerId, result) {
    if (!settings.model_discovery || typeof settings.model_discovery !== 'object' || Array.isArray(settings.model_discovery)) settings.model_discovery = {};
    settings.model_discovery[providerId] = {
        evidence: result?.evidence && {
            kind: result.evidence.kind,
            source: result.evidence.source,
            observedAt: result.evidence.observedAt,
            retryCount: result.evidence.retryCount,
        },
        ...(result?.warning ? { warning: { code: result.warning.code } } : {}),
    };
}

function cancelModelDiscovery(providerId) {
    modelDiscoveryUiSequence += 1;
    const cancelled = modelDiscoveryCoordinator.cancel(providerId);
    if (cancelled) setBusyState($('#cig_model_refresh'), false);
    return cancelled;
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

async function requestLinkApiImage({ apiKey, model, prompt, size, host = 'https://linkapi.ai', signal }) {
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
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        let message = `API Error: ${response.status}`;
        try {
            const j = JSON.parse(errorText);
            message = j.error?.message || j.message || message;
        } catch (e) { /* keep default */ }
        const providerError = attachNormalizedProviderError(new Error(message), {
            providerId: 'linkapi',
            modelId: model,
            status: response.status,
            responseText: errorText,
        });
        console.error(`[${extensionName}] LinkAPI image error:`, {
            status: providerError.status,
            providerId: providerError.providerId,
            modelId: providerError.modelId,
            technicalMessage: providerError.technicalMessage,
        });
        throw providerError;
    }

    const json = await response.json();
    const { b64, url: imageUrl } = parseImagesResponse(json);
    if (b64) {
        console.log(`[${extensionName}] LinkAPI image received (b64_json, model: ${model})`);
        return { imageData: b64, mimeType: 'image/png' };
    }
    if (imageUrl) {
        console.log(`[${extensionName}] LinkAPI image received (url, fetching bytes, model: ${model})`);
        return await downloadImageData(imageUrl, { signal });
    }
    throw new Error('No image was returned by the API');
}

async function requestOpenAiImages({ apiKey, model, prompt, size, baseUrl, providerId = 'unknown', signal }) {
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
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        let message = `API Error: ${response.status}`;
        try {
            const json = JSON.parse(errorText);
            message = json.error?.message || json.message || message;
        } catch (e) { /* keep default */ }
        const providerError = attachNormalizedProviderError(new Error(message), {
            providerId,
            modelId: model,
            status: response.status,
            responseText: errorText,
        });
        console.error(`[${extensionName}] OpenAI Images error:`, {
            status: providerError.status,
            providerId: providerError.providerId,
            modelId: providerError.modelId,
            technicalMessage: providerError.technicalMessage,
        });
        throw providerError;
    }

    const { b64, url: imageUrl } = parseOpenAiImagesResponse(await response.json());
    if (b64) {
        return { imageData: b64, mimeType: 'image/png' };
    }

    return await downloadImageData(imageUrl, { signal });
}
async function fetchManagedProviderModels() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const ui = projectProviderUi(providerId, settings.model, {
        localEntries: getProviderModelEntries(settings, providerId),
        discoveryEvidence: discoveryState.evidence,
        discoveryWarning: discoveryState.warning,
    });
    if (!ui?.modelDiscovery?.refreshEnabled) {
        if (ui?.modelDiscovery?.disabledReason) toastr.info(ui.modelDiscovery.disabledReason, 'Context Image Generation');
        return;
    }

    const key = getProviderApiKey(settings, providerId);
    if (ui.requiresApiKey && !key) {
        toastr.warning(`Enter a ${ui.label} key first.`, 'Context Image Generation');
        return;
    }

    const refreshToken = ++modelDiscoveryUiSequence;
    const fetchButtons = $('#cig_model_refresh');
    setBusyState(fetchButtons, true, { busyTitle: 'Refreshing models…' });
    try {
        const result = await modelDiscoveryCoordinator.refresh(providerId, { apiKey: key });
        const currentSettings = extension_settings[extensionName];
        if (result?.stale || (currentSettings.provider || 'makersuite') !== providerId) return;
        setProviderDiscoveryState(currentSettings, providerId, result);
        if (!result.warning) {
            setProviderModelRecords(currentSettings, providerId, mergeFetchedModelRecords(getProviderModelEntries(currentSettings, providerId), result.models, providerId));
        }
        updateModelDropdown();
        renderModelManager();
        saveSettingsDebounced();
        if (result.warning) toastr.warning(`${result.warning.userMessage} Your current model list was kept.`, 'Context Image Generation');
        else toastr.success(`Loaded ${result.models.length} model(s).`, 'Context Image Generation');
    } catch (error) {
        showGenerationError(error, 'Provider model discovery');
    } finally {
        if (refreshToken === modelDiscoveryUiSequence) {
            setBusyState(fetchButtons, false);
            updateModelDropdown();
            renderModelManager();
        }
    }
}
// Dev aid: reach the pure helpers from the DevTools console for verification.
window.cigDebug = Object.assign(window.cigDebug || {}, {
    isOpenAiImageModel,
    mapAspectRatioToSize,
    extractPromptText,
    parseImagesResponse,
    requestLinkApiImage,
    buildAppearanceReferenceCandidates,
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
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const ui = projectProviderUi(providerId, settings.model, {
        localEntries,
        discoveryEvidence: discoveryState.evidence,
        discoveryWarning: discoveryState.warning,
    });
    if (!ui) return;
    settings.model = getModelFallback(providerId, settings.model, localEntries);
    const $modelSelect = $('#cig_model').empty();
    const query = String($('#cig_model_search').val() || '').trim().toLowerCase();
    const filteredModels = query
        ? ui.models.filter((model) => `${model.id} ${model.label}`.toLowerCase().includes(query))
        : ui.models;
    const visibleModels = filteredModels.some((model) => model.id === settings.model) || !settings.model
        ? filteredModels
        : [...filteredModels, ...ui.models.filter((model) => model.id === settings.model)];
    for (const model of visibleModels) {
        $modelSelect.append($('<option>').val(model.id).text(model.label));
    }
    $modelSelect.val(settings.model);
    const discovery = ui.modelDiscovery;
    const statusParts = [];
    if (discovery.warning?.userMessage) statusParts.push(discovery.warning.userMessage);
    else if (discovery.evidence) {
        statusParts.push(`Source: ${discovery.evidence.source}`);
        if (discovery.lastRefresh) statusParts.push(`Last refreshed: ${new Date(discovery.lastRefresh).toLocaleString()}`);
    } else if (!discovery.refreshEnabled && discovery.disabledReason) statusParts.push(discovery.disabledReason);
    $('#cig_model_discovery_status').text(statusParts.join(' · '));
    $('#cig_model_refresh')
        .prop('disabled', !discovery.refreshEnabled)
        .attr('title', discovery.refreshEnabled ? 'Refresh available models' : discovery.disabledReason || 'Model refresh is unavailable');
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
    const existingProviderSettings = extension_settings[extensionName];
    const migratedProviderSettings = migrateProviderSettings(existingProviderSettings);
    if (JSON.stringify(existingProviderSettings) !== JSON.stringify(migratedProviderSettings)) {
        extension_settings[extensionName] = migratedProviderSettings;
        settingsMigrated = true;
    }
    const cigSettings = extension_settings[extensionName];
    const migratedAppearanceLibrary = migrateAppearanceLibrary(cigSettings.rp_library);
    if (JSON.stringify(cigSettings.rp_library) !== JSON.stringify(migratedAppearanceLibrary)) {
        cigSettings.rp_library = migratedAppearanceLibrary;
        settingsMigrated = true;
    }
    if (!cigSettings.provider_keys || typeof cigSettings.provider_keys !== 'object' || Array.isArray(cigSettings.provider_keys)) {
        cigSettings.provider_keys = {};
        settingsMigrated = true;
    }
    if (!cigSettings.provider_models || typeof cigSettings.provider_models !== 'object' || Array.isArray(cigSettings.provider_models)) {
        cigSettings.provider_models = {};
        settingsMigrated = true;
    }
    if (!cigSettings.model_discovery || typeof cigSettings.model_discovery !== 'object' || Array.isArray(cigSettings.model_discovery)) {
        cigSettings.model_discovery = {};
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
    renderAppearanceList();
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
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const ui = projectProviderUi(providerId, settings.model, {
        localEntries,
        discoveryEvidence: discoveryState.evidence,
        discoveryWarning: discoveryState.warning,
    });
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
    $transport.val(selectedEntry?.transportId || selectedEntry?.transport || provider?.models?.find((model) => model.id === settings.model)?.transport || $transport.val());
    $('#cig_managed_model_transport_container').toggle($transport.children().length > 1);
    $('#cig_model_discovery_note')
        .text(ui.modelDiscovery.warning?.userMessage || (ui.modelDiscovery.refreshEnabled
            ? 'Refresh merges discovered models and keeps your local entries.'
            : ui.modelDiscovery.disabledReason || ''))
        .toggle(Boolean(ui.modelDiscovery.warning?.userMessage || ui.modelDiscovery.refreshEnabled || ui.modelDiscovery.disabledReason));
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
    setProviderModelRecords(settings, providerId, updateModelRecords(localEntries, { type, previousId, id, source: 'manual', transportId: transport }, providerId));
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
    setProviderModelRecords(settings, providerId, updateModelRecords(localEntries, { type: 'remove', id: selectedId }, providerId));
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

function cloneSnapshot(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function captureGenerationSnapshot(prompt, sender = null, messageId = null, focusText = null, target = null, invocation = 'settings') {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const modelId = settings.model;
    let providerRoute = resolveProviderRoute(providerId, modelId);
    const localModel = getProviderModelEntries(settings, providerId).find((entry) => entry.id === modelId);
    if (!providerRoute.model && (localModel?.transportId || localModel?.transport)) {
        providerRoute = { ...providerRoute, model: { id: modelId, ...cloneSnapshot(localModel) }, transport: localModel.transportId || localModel.transport };
    }
    const legacyTransport = providerRoute.transport;
    const manualLegacyRecovery = invocation !== 'automation' && invocation !== 'swipe' && isManualLegacyLinkApiRecovery(providerId, settings);
    const transportId = manualLegacyRecovery
        ? 'linkapi-legacy-recovery'
        : legacyTransport === 'openAiImages' ? 'openai-images' : legacyTransport === 'sillyTavernGeminiProxy' ? 'sillytavern-gemini-proxy' : 'host-chat-image';
    const routeModel = providerRoute.model || { id: modelId, providerId, transportId };
    const recentMessages = cloneSnapshot(getRecentMessages(settings.message_depth || 1, messageId)) || [];
    let messageContent = prompt;
    if (messageId !== null || sender !== null) {
        if (recentMessages.length > 0) {
            let storyContext = '[Story Context - Generate an image for the final message]:\n\n';
            for (const msg of recentMessages) storyContext += `[${msg.isUser ? '{{user}}' : '{{char}}'} (${msg.name})]: ${msg.text}\n\n`;
            messageContent = buildFocusedMessageContent({ sourceMessage: prompt, focusText, sender, storyContext: storyContext.trim() });
        } else if (sender) {
            messageContent = buildFocusedMessageContent({ sourceMessage: prompt, focusText, sender });
        }
    }
    let descriptionText = '';
    if (settings.include_descriptions) {
        const descriptions = getCharacterDescriptions();
        if (descriptions.user_persona) {
            descriptionText += `[${descriptions.user_name} (User) Description]: ${descriptions.user_persona}\n\n`;
        }
        if (descriptions.char_description) {
            descriptionText += `[${descriptions.char_name} (Character) Description]: ${descriptions.char_description}\n\n`;
        }
        if (descriptions.char_scenario) {
            descriptionText += `[Current Scenario]: ${descriptions.char_scenario}\n\n`;
        }
        descriptionText = descriptionText.trim();
    }
    // Legacy resolver shape: getReferenceImageCapability(providerId, settings.model)
    const capability = getReferenceImageCapability(providerId, modelId);
    const referenceCandidates = [];
    const settingsSnapshot = cloneSnapshot(settings) || {};
    const gallerySnapshot = Array.isArray(settingsSnapshot.gallery) ? settingsSnapshot.gallery : [];
    const appearanceMaterial = materializeAppearanceAssets(settingsSnapshot.rp_library, gallerySnapshot);
    referenceCandidates.push(...buildAppearanceReferenceCandidates(settingsSnapshot.rp_library, gallerySnapshot, { currentChatId: getContext().chatId }));
    if (capability && settingsSnapshot.use_previous_image && gallerySnapshot.length > 0) referenceCandidates.push({ id: 'legacy:previous', role: 'legacy-previous', assetId: 'asset:legacy-previous', label: 'previous image' });
    // Legacy contract: if (supportsReferenceImages && settings.use_avatars) { —
    // the captured capability/setting snapshot below is the authority.
    if (capability && settingsSnapshot.use_avatars) {
        referenceCandidates.push({ id: 'host:character', role: 'host-avatar', identityId: 'character:active', assetId: 'asset:host-character', label: 'character' });
        referenceCandidates.push({ id: 'host:user', role: 'host-avatar', identityId: 'user:active', assetId: 'asset:host-user', label: 'user' });
    }
    const planInput = {
        id: `generation:${getGenerationKey(prompt, messageId, target)}`,
        idempotencyKey: getGenerationKey(prompt, messageId, target),
        invocation,
        target: cloneSnapshot(target),
        provider: { providerId, modelId, transport: transportId, capabilities: routeModel.capabilities || routeModel },
        resolved: { connectionId: `${providerId}:default`, providerId, modelId, transportId, ...(providerRoute.provider?.transports?.[legacyTransport]?.baseUrl ? { endpoint: providerRoute.provider.transports[legacyTransport].baseUrl } : {}), ...(manualLegacyRecovery ? { legacyKind: legacyTransport === 'openAiImages' ? 'openai-images' : 'gemini-proxy' } : {}), capabilities: routeModel.capabilities || routeModel },
        prompt: { sourceMessage: prompt, focusText, nearbyMessages: recentMessages, sender: sender || '', messageContent, descriptionText, intent: 'scene' },
        references: referenceCandidates,
        referenceContext: { speakerIdentityId: getStableSpeakerIdentityId(sender) },
        options: { aspectRatio: settingsSnapshot.aspect_ratio, imageSize: settingsSnapshot.image_size, systemInstruction: settingsSnapshot.system_instruction, thinkingLevel: settingsSnapshot.thinking_level, useGoogleSearch: settingsSnapshot.use_google_search },
        policy: { source: invocation === 'automation' ? 'automation' : 'manual' },
    };
    return Object.freeze({ planInput, providerRoute: cloneSnapshot(providerRoute), routeModel: cloneSnapshot(routeModel), settingsSnapshot, apiKey: getProviderApiKey(settingsSnapshot, providerId), reverseProxy: oai_settings.reverse_proxy || '', gallerySnapshot, referenceAssets: appearanceMaterial.assets, referenceCandidates });
}

async function materializeSnapshotAssets(snapshot) {
    const assets = { ...(snapshot.referenceAssets || {}) };
    if (snapshot.referenceCandidates.some((reference) => reference.id === 'legacy:previous')) {
        const dataUrl = await galleryItemToDataUrl(snapshot.gallerySnapshot[0]);
        if (dataUrl) assets['asset:legacy-previous'] = { url: dataUrl, mimeType: 'image/png' };
    }
    if (snapshot.referenceCandidates.some((reference) => reference.id === 'host:character')) {
        const charAvatarData = await getCharacterAvatar();
        if (charAvatarData) assets['asset:host-character'] = { data: charAvatarData.data, mimeType: charAvatarData.mimeType };
        const userAvatarData = await getUserAvatar();
        if (userAvatarData) assets['asset:host-user'] = { data: userAvatarData.data, mimeType: userAvatarData.mimeType };
    }
    return assets;
}

// Compatibility signature: buildMessages(prompt, sender, messageId, focusText, invocation).
async function buildMessages(prompt, sender = null, messageId = null, focusText = null, invocation = 'settings', plan = null, referenceAssets = {}) {
    if (!plan) throw new TypeError('buildMessages requires a captured GenerationPlan.');
    const contentParts = [];
    if (plan.options.systemInstruction) contentParts.push({ type: 'text', text: plan.options.systemInstruction });
    if (plan.prompt.descriptionText) contentParts.push({ type: 'text', text: plan.prompt.descriptionText });
    contentParts.push({ type: 'text', text: plan.prompt.messageContent || plan.prompt.sourceMessage });
    const materialized = materializeReferences(plan.references, { assets: referenceAssets });
    for (const reference of materialized.references) {
        contentParts.push({ type: 'text', text: `[Reference image: ${reference.label || reference.role}]` });
        const asset = reference.asset;
        const url = asset.url || `data:${asset.mimeType || 'image/png'};base64,${asset.data}`;
        contentParts.push({ type: 'image_url', image_url: { url } });
    }

    return [{ role: 'user', content: contentParts }];
}

async function requestSillyTavernImage(requestBody, { providerId = requestBody?.chat_completion_source || 'unknown', modelId = requestBody?.model, signal } = {}) {
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API Error: ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (e) { }
        const providerError = attachNormalizedProviderError(new Error(errorMessage), {
            providerId,
            modelId,
            status: response.status,
            responseText: errorText,
        });
        console.error(`[${extensionName}] API error:`, {
            status: providerError.status,
            providerId: providerError.providerId,
            modelId: providerError.modelId,
            technicalMessage: providerError.technicalMessage,
        });
        throw providerError;
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

    return await requestSillyTavernImage(requestBody, { providerId: 'linkapi', modelId: settings.model });
}

function getStableSpeakerIdentityId(sender) {
    const context = getContext();
    if (String(sender || '').startsWith('{{user}}')) return user_avatar ? `user:${user_avatar}` : 'user:display';
    const senderName = String(sender || '').match(/\(([^()]*)\)\s*$/u)?.[1]?.trim();
    if (senderName) {
        const matches = getAppearanceIdentityChoices().filter((identity) => identity.label.trim().toLocaleLowerCase('und') === senderName.toLocaleLowerCase('und'));
        if (matches.length === 1) return matches[0].id;
    }
    const character = context.characters?.[context.characterId];
    return character?.avatar ? `character:${character.avatar}` : null;
}

function getGenerationKey(prompt, messageId, target = null) {
    return buildGenerationKey({
        chatId: target?.chatId ?? getContext().chatId,
        messageId,
        prompt,
    });
}

async function generateImageFromPrompt(prompt, sender = null, messageId = null, focusText = null, target = null, invocation = 'settings', finalize = null) {
    return await generateImageFromPromptInternal(prompt, sender, messageId, focusText, target, invocation, finalize);
}

async function generateImageFromPromptInternal(prompt, sender = null, messageId = null, focusText = null, target = null, invocation = 'settings', finalize = null) {
    let snapshot;
    try {
        // Legacy resolver shape: let providerRoute = resolveProviderRoute(selectedProvider, settings.model);
        snapshot = captureGenerationSnapshot(prompt, sender, messageId, focusText, target, invocation);
        const assets = await materializeSnapshotAssets(snapshot);
        const availableReferences = snapshot.referenceCandidates.filter((reference) => !reference.assetId || assets[reference.assetId]);
        const missingReferenceOmissions = snapshot.referenceCandidates.filter((reference) => reference.assetId && !assets[reference.assetId]).map((reference) => ({ id: reference.id, reason: 'asset-unavailable' }));
        const plan = createGenerationPlan({ ...snapshot.planInput, references: availableReferences, referenceOmissions: missingReferenceOmissions });
        const messages = await buildMessages(prompt, sender, messageId, focusText, invocation, plan, assets);
        const dispatchedPlan = createGenerationPlan({ ...snapshot.planInput, references: availableReferences, referenceOmissions: missingReferenceOmissions, messages });
        const connection = {
            id: dispatchedPlan.resolved.connectionId,
            providerId: dispatchedPlan.resolved.providerId,
            kind: snapshot.providerRoute?.credentialKey ? 'browser-api-key' : 'sillytavern-proxy',
            enabled: true,
        };
        const execution = generationCoordinator.enqueue(dispatchedPlan, async (signal) => {
            const generated = await dispatchProviderRoute({
                plan: dispatchedPlan,
                connection,
                signal,
                transportContext: {
                    apiKey: snapshot.apiKey,
                    messages,
                    reverseProxy: snapshot.reverseProxy,
                    fetchImpl: fetch,
                    getRequestHeaders,
                    mapAspectRatioToSize,
                    requestSillyTavernImage,
                },
            });
            if (typeof finalize !== 'function') return generated;
            const persisted = await finalize(generated, signal);
            return persisted?.persistence?.stale ? { ...persisted, stale: true } : persisted;
        });
        currentGenerationRunId = execution.runId || currentGenerationRunId;
        $('#cig_cancel_generation').prop('disabled', !currentGenerationRunId).toggle(!!currentGenerationRunId);
        return await execution;
    } catch (error) {
        throw attachNormalizedProviderError(error, { providerId: snapshot?.planInput?.resolved?.providerId || 'unknown', modelId: snapshot?.planInput?.resolved?.modelId });
    }
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

async function addToGallery(imageData, prompt, messageId = null, existingPath = null, sourceMetadata = undefined) {
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

    const galleryId = sourceMetadata?.galleryId || `gallery:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    settings.gallery.unshift({
        id: galleryId,
        url: url,
        prompt: prompt.substring(0, 200),
        timestamp: Date.now(),
        messageId: messageId,
        ...(sourceMetadata ? { sourceMetadata } : {}),
    });

    settings.gallery = trimGalleryToLimit(settings.gallery, MAX_GALLERY_SIZE, settings.rp_library).gallery;

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
        const overlay = $('<div class="cig_gallery_item_overlay"></div>');
        $('<button type="button" class="cig_gallery_action cig_gallery_remember" title="Remember appearance" aria-label="Remember appearance">')
            .attr('data-index', i)
            .append($('<i class="fa-solid fa-user-pen" aria-hidden="true"></i>'))
            .appendTo(overlay);
        $('<button type="button" class="cig_gallery_action cig_gallery_delete" title="Delete image" aria-label="Delete image">')
            .attr('data-index', i)
            .append($('<i class="fa-solid fa-trash" aria-hidden="true"></i>'))
            .appendTo(overlay);
        overlay.appendTo(thumb);
        container.append(thumb);
    }
}

function getAppearanceIdentityChoices() {
    const context = getContext();
    const character = context.characters?.[context.characterId] || null;
    const group = context.groups?.find((entry) => String(entry.id) === String(context.groupId));
    const groupMembers = (group?.members || []).map((avatar) => context.characters?.find((entry) => entry.avatar === avatar) || { avatar, name: avatar });
    const library = extension_settings[extensionName]?.rp_library;
    const chatIdentities = Object.values(library?.identities || {})
        .filter((identity) => identity.kind === 'npc' && identity.durable === false);
    return listAppearanceIdentityChoices({
        activeCharacter: character,
        persona: { avatar: user_avatar, name: name1 || 'User' },
        groupMembers,
        chatIdentities,
        library,
        currentChatId: context.chatId,
    });
}

function safeNpcId(chatId, name) {
    const chatPart = String(chatId || 'chat').replace(/[^a-zA-Z0-9_-]/gu, '-').slice(0, 80);
    const namePart = String(name || 'npc').trim().toLocaleLowerCase('und').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'npc';
    return `npc:${chatPart}:${namePart}`;
}

async function chooseAppearanceIdentity(defaultLabel = '') {
    const context = getContext();
    const choices = getAppearanceIdentityChoices();
    const content = document.createElement('div');
    content.className = 'cig_appearance_dialog';

    const description = document.createElement('p');
    description.textContent = 'Choose who this whole image represents. The extension will not guess from a multi-person image.';
    content.appendChild(description);

    const label = document.createElement('label');
    label.className = 'text_label';
    label.textContent = 'Identity';
    const select = document.createElement('select');
    select.className = 'text_pole';
    select.id = 'cig_appearance_identity';
    select.setAttribute('aria-label', 'Identity for saved appearance');
    for (const identity of choices) {
        const option = document.createElement('option');
        option.value = identity.id;
        option.textContent = identity.label;
        select.appendChild(option);
    }
    const npcOption = document.createElement('option');
    npcOption.value = '__chat_npc__';
    npcOption.textContent = 'Named NPC in this chat…';
    select.appendChild(npcOption);
    label.appendChild(select);
    content.appendChild(label);

    const npcLabel = document.createElement('label');
    npcLabel.className = 'text_label cig_appearance_npc_name';
    npcLabel.textContent = 'NPC name';
    npcLabel.hidden = true;
    const npcInput = document.createElement('input');
    npcInput.className = 'text_pole';
    npcInput.type = 'text';
    npcInput.maxLength = 80;
    npcInput.placeholder = 'e.g. The guard';
    npcInput.setAttribute('aria-label', 'Named NPC');
    npcLabel.appendChild(npcInput);
    content.appendChild(npcLabel);

    const lookLabel = document.createElement('label');
    lookLabel.className = 'text_label';
    lookLabel.textContent = 'Look name (optional)';
    const lookInput = document.createElement('input');
    lookInput.className = 'text_pole';
    lookInput.type = 'text';
    lookInput.maxLength = 120;
    lookInput.value = String(defaultLabel || '').slice(0, 120);
    lookInput.placeholder = 'e.g. Evening outfit';
    lookInput.setAttribute('aria-label', 'Optional look name');
    lookLabel.appendChild(lookInput);
    content.appendChild(lookLabel);

    select.addEventListener('change', () => {
        npcLabel.hidden = select.value !== '__chat_npc__';
        if (!npcLabel.hidden) npcInput.focus();
    });

    const popup = new Popup(content, POPUP_TYPE.TEXT, null, {
        okButton: 'Remember',
        cancelButton: 'Cancel',
        animation: 'fast',
    });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    if (select.value === '__chat_npc__') {
        const labelText = npcInput.value.trim();
        if (!labelText) {
            toastr.warning('Enter a name for the chat NPC.', 'Context Image Generation');
            return null;
        }
        return {
            identity: { id: safeNpcId(context.chatId, labelText), kind: 'npc', label: labelText, aliases: [labelText], chatId: context.chatId || null, durable: false },
            label: lookInput.value.trim() || defaultLabel || 'Saved appearance',
        };
    }
    const identity = choices.find((entry) => entry.id === select.value) || null;
    return identity ? { identity, label: lookInput.value.trim() || defaultLabel || 'Saved appearance' } : null;
}

async function rememberGalleryAppearance(index) {
    const settings = extension_settings[extensionName];
    const item = settings.gallery?.[index];
    if (!item) return;
    const selection = await chooseAppearanceIdentity(item.prompt || 'Saved appearance');
    if (!selection) return;
    const { identity, label } = selection;

    // Promote legacy gallery entries to a stable artifact key; no image bytes are copied.
    if (!item.id) item.id = `gallery:${galleryArtifactKey(item)}`;
    const result = addAppearanceLook(settings.rp_library, {
        identity,
        galleryItem: item,
        label,
    });
    if (!result.look) {
        toastr.warning('This gallery image cannot be remembered.', 'Context Image Generation');
        return;
    }
    settings.rp_library = result.library;
    saveSettingsDebounced();
    renderAppearanceList();
    toastr.success(`Saved appearance for ${identity.label}.`, 'Context Image Generation');
}

function renderAppearanceList() {
    const settings = extension_settings[extensionName] || {};
    const list = $('#cig_appearance_list').empty();
    const empty = $('#cig_appearance_empty');
    const library = migrateAppearanceLibrary(settings.rp_library);
    const materialized = materializeAppearanceAssets(library, settings.gallery || []);
    const available = new Set(Object.keys(materialized.assets));
    const entries = [];
    for (const identity of Object.values(library.identities)) {
        for (const look of identity.looks || []) entries.push({ identity, look });
    }
    empty.toggle(entries.length === 0);
    for (const { identity, look } of entries) {
        const row = $('<div class="cig_appearance_item" role="listitem"></div>')
            .attr('data-identity-id', identity.id)
            .attr('data-look-id', look.id);
        const text = $('<div class="cig_appearance_item_text"></div>');
        $('<span>').text(`${identity.label}: ${look.label}`).appendTo(text);
        if (identity.activeLookId === look.id) {
            $('<small class="cig_appearance_active">Active</small>').appendTo(text);
        }
        if (!available.has(look.assetId)) $('<small>').text('Unavailable').appendTo(text);
        if (identity.activeLookId !== look.id) {
            $('<button type="button" class="menu_button cig_appearance_use" title="Use this appearance" aria-label="Use this appearance">')
                .text('Use')
                .appendTo(row);
        }
        $('<button type="button" class="menu_button cig_appearance_remove" title="Remove saved appearance" aria-label="Remove saved appearance">')
            .text('Remove')
            .appendTo(row);
        row.prepend(text);
        list.append(row);
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
    setBusyState(generateBtn, true, { busyTitle: 'Generating image…' });
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
        showGenerationError(error);
    } finally {
        setBusyState(generateBtn, false);
        generateBtn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-image');
    }
}

async function cigMessageButton($icon, { captureSelection = true, generationInput = null, invocation = 'wand' } = {}) {
    const context = getContext();

    if ($icon.hasClass('cig_busy')) {
        console.log('[CIG] Already generating...');
        return;
    }

    const messageElement = $icon.closest('.mes');
    const messageId = Number(messageElement.attr('mesid'));
    const message = generationInput?.message || context.chat[messageId];

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
    const capturedInput = generationInput || captureWandGenerationInput({
        chatId: context.chatId,
        messageId,
        message,
        messageElement: messageElement[0],
        selection: captureSelection ? document.getSelection?.() : null,
        sender,
        captureSelection,
    });

    setBusyState($icon, true, { busyClass: 'cig_busy', busyTitle: 'Generating image…' });
    $icon.removeClass('fa-wand-magic-sparkles').addClass('fa-spinner fa-spin');

    try {
        await attachGeneratedImage(message, messageElement, prompt, sender, messageId, capturedInput.focusText, capturedInput.target, invocation);
    } catch (error) {
        showGenerationError(error);
    } finally {
        setBusyState($icon, false, { busyClass: 'cig_busy' });
        $icon.removeClass('fa-spinner fa-spin').addClass('fa-wand-magic-sparkles');
    }
}

// Generate an image for a message and attach it to that message's media array.
// Shared by the wand button and the swipe-to-regenerate handler.
async function attachGeneratedImage(message, messageElement, prompt, sender, messageId, focusText = null, target = null, invocation = 'wand') {
    const effectiveTarget = target || captureMessageTarget({
        chatId: getContext().chatId,
        messageId,
        message,
    });
    const attachmentLifecycleEpoch = chatLifecycleEpoch.capture();
    let currentMessageElement = null;

    return await attachGeneratedImageSafely({
        target: effectiveTarget,
        prompt,
        sender,
        focusText,
        generate: ({ finalize } = {}) => generateImageFromPrompt(prompt, sender, messageId, focusText, effectiveTarget, invocation, finalize),
        saveImage: async (imageData) => {
            const fileName = `cig_${Date.now()}`;
            const filePath = await saveBase64AsFile(imageData, extensionName, fileName, 'png');
            console.log(`[${extensionName}] Image saved to:`, filePath);
            return filePath;
        },
        getCurrentTarget: () => {
            const currentContext = getContext();
            const validation = validateMessageTarget({
                target: effectiveTarget,
                currentChatId: currentContext.chatId,
                currentChat: currentContext.chat,
            });
            if (!validation.safe) return validation;
            currentMessageElement = $(`.mes[mesid="${messageId}"]`);
            if (currentMessageElement.length === 0) return { safe: false, reason: 'unavailable' };
            return validation;
        },
        appendMedia: ({ result, filePath: savedPath, prompt: sourcePrompt, message: currentMessage }) => {
            const previousExtra = currentMessage.extra && typeof currentMessage.extra === 'object'
                ? {
                    ...currentMessage.extra,
                    ...(Array.isArray(currentMessage.extra.media) ? { media: [...currentMessage.extra.media] } : {}),
                }
                : null;
            if (!currentMessage.extra || typeof currentMessage.extra !== 'object') {
                currentMessage.extra = {};
            }
            if (!Array.isArray(currentMessage.extra.media)) {
                currentMessage.extra.media = [];
            }
            if (!currentMessage.extra.media_display) {
                currentMessage.extra.media_display = MEDIA_DISPLAY.GALLERY;
            }

            currentMessage.extra.media.push({
                url: savedPath,
                type: MEDIA_TYPE.IMAGE,
                title: sourcePrompt.substring(0, 100),
                source: MEDIA_SOURCE.GENERATED,
            });
            currentMessage.extra.media_index = currentMessage.extra.media.length - 1;
            currentMessage.extra.inline_image = true;
            appendMediaToMessage(currentMessage, currentMessageElement, SCROLL_BEHAVIOR.KEEP);
            return () => {
                if (previousExtra === null) {
                    delete currentMessage.extra;
                } else {
                    currentMessage.extra = {
                        ...previousExtra,
                        ...(Array.isArray(previousExtra.media) ? { media: [...previousExtra.media] } : {}),
                    };
                }
                appendMediaToMessage(currentMessage, currentMessageElement, SCROLL_BEHAVIOR.KEEP);
            };
        },
        saveChat: async () => {
            const saveEpoch = attachmentLifecycleEpoch;
            const beforeSave = validateMessageTarget({
                target: effectiveTarget,
                currentChatId: getContext().chatId,
                currentChat: getContext().chat,
            });
            if (!beforeSave.safe || !chatLifecycleEpoch.isCurrent(saveEpoch)) {
                return beforeSave.safe ? { safe: false, reason: 'chat-changed' } : beforeSave;
            }

            // ST's saveChatConditional has no target argument. Re-check after it
            // completes so an intervening chat switch cannot be reported as a
            // successful attachment; the helper rolls back the in-memory append
            // and keeps the file in the gallery when this gate fails.
            await saveChatConditional();
            if (!chatLifecycleEpoch.isCurrent(saveEpoch)) return { safe: false, reason: 'chat-changed' };
            const afterSaveContext = getContext();
            const afterSave = validateMessageTarget({
                target: effectiveTarget,
                currentChatId: afterSaveContext.chatId,
                currentChat: afterSaveContext.chat,
            });
            return afterSave.safe ? { saved: true } : afterSave;
        },
        addToGallery,
        notify: (messageText) => toastr.info(messageText, 'Context Image Generation'),
        rollbackMedia: (rollback) => rollback?.(),
    });
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
        await attachGeneratedImage(message, element, message.mes, sender, messageId, null, null, 'swipe');
    } catch (error) {
        showGenerationError(error, 'Swipe regeneration');
    } finally {
        messageMedia.removeClass('fa-fade');
    }
}

async function autoGenerateForMessage(messageId) {
    const settings = extension_settings[extensionName];
    if (settings.auto_generate === 'off') return;

    const context = getContext();
    const autoInput = captureAutoGenerationInput({ context, messageId });
    const message = autoInput?.message;
    if (!message || !message.mes || message.is_system) return;

    // Check if we should generate for this message type
    if (settings.auto_generate === 'bot' && message.is_user) return;

    // Wait for the button to be injected, then click it
    setTimeout(() => {
        const validation = validateAutoGenerationInput({ input: autoInput, context: getContext() });
        if (!validation.safe) return;
        const messageElement = $(`.mes[mesid="${messageId}"]`);
        const $icon = messageElement.find('.cig_message_gen');
        if ($icon.length > 0 && !$icon.hasClass('cig_busy')) {
            console.log(`[${extensionName}] Auto-generating image for message ${messageId}`);
            cigMessageButton($icon, {
                captureSelection: false,
                invocation: 'automation',
                generationInput: { ...autoInput, message: validation.message, focusText: null },
            });
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
        const result = await generateImageFromPrompt(trimmedPrompt, null, null, null, null, 'slash');

        if (result) {
            const imageDataUrl = `data:${result.mimeType};base64,${result.imageData}`;
            $('#cig_preview_image').attr('src', imageDataUrl);
            $('#cig_preview_container').show();
            await addToGallery(result.imageData, trimmedPrompt, null);
            return imageDataUrl;
        }
    } catch (error) {
        showGenerationError(error, 'Slash command generation');
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

    const settings = extension_settings[extensionName];
    const protectedIds = getProtectedGalleryArtifactIds(settings.rp_library);
    const originalCount = settings.gallery.length;
    settings.gallery = settings.gallery.filter((item) => !protectedIds.has(galleryArtifactKey(item)));
    const removedCount = originalCount - settings.gallery.length;
    saveSettingsDebounced();
    renderGallery();
    renderAppearanceList();
    toastr.info(removedCount > 0 ? `Gallery cleared. Kept ${settings.gallery.length} referenced image(s).` : 'Gallery already contains only referenced images.', 'Context Image Generation');
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
    const item = settings.gallery[index];
    const protectedIds = getProtectedGalleryArtifactIds(settings.rp_library);
    if (item && protectedIds.has(galleryArtifactKey(item))) {
        toastr.info('This image is remembered as an appearance. Remove that appearance first.', 'Context Image Generation');
        return;
    }
    settings.gallery.splice(index, 1);
    saveSettingsDebounced();
    renderGallery();
    renderAppearanceList();
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
        const settings = extension_settings[extensionName];
        cancelModelDiscovery(settings.provider || 'makersuite');
        settings.provider = $(this).val();
        updateModelDropdown();
        toggleImageSizeVisibility();
        toggleProviderSpecificSettings();
        renderModelManager();
        saveSettingsDebounced();
    });

    $('#cig_provider_api_key').on('input', function () {
        const settings = extension_settings[extensionName];
        const provider = settings.provider || 'makersuite';
        cancelModelDiscovery(provider);
        if (projectProviderUi(provider, settings.model)?.requiresApiKey) {
            setProviderApiKey(settings, provider, $(this).val());
            saveSettingsDebounced();
        }
    });

    $('#cig_linkapi_use_legacy_routing').on('change', function () {
        extension_settings[extensionName].linkapi_use_legacy_routing = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cig_cancel_generation').on('click', function () {
        if (currentGenerationRunId) generationCoordinator.cancel(currentGenerationRunId);
    });

    $('#cig_model_refresh').on('click', fetchManagedProviderModels);
    $('#cig_model_search').on('input', updateModelDropdown);
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
        const settings = extension_settings[extensionName];
        cancelModelDiscovery(settings.provider || 'makersuite');
        settings.model = $(this).val();
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

    $(document).on('click', '.cig_gallery_remember', async function (e) {
        e.stopPropagation();
        const index = $(this).data('index');
        try {
            await rememberGalleryAppearance(index);
        } catch (error) {
            showGenerationError(error, 'Remember appearance');
        }
    });

    $(document).on('click', '.cig_gallery_delete', function (e) {
        e.stopPropagation();
        const index = $(this).data('index');
        deleteGalleryImage(index);
    });

    $(document).on('click', '.cig_appearance_remove', function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_appearance_item');
        const settings = extension_settings[extensionName];
        settings.rp_library = removeAppearanceLook(settings.rp_library, row.data('identity-id'), row.data('look-id'));
        saveSettingsDebounced();
        renderAppearanceList();
    });

    $(document).on('click', '.cig_appearance_use', function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_appearance_item');
        const settings = extension_settings[extensionName];
        settings.rp_library = setActiveAppearanceLook(settings.rp_library, row.attr('data-identity-id'), row.attr('data-look-id'));
        saveSettingsDebounced();
        renderAppearanceList();
    });

    $(document).on('click', '.cig_message_gen', function (e) {
        cigMessageButton($(e.currentTarget));
    });

    eventSource.on(event_types.MESSAGE_RENDERED, (messageId) => {
        injectMessageButton(messageId);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        chatLifecycleEpoch.advance();
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
        chatLifecycleEpoch.advance();
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

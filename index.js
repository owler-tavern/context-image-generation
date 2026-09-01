/**
 * Context Image Generation 🍌
 * Gemini-powered image generation with avatar references and character context
 * Uses SillyTavern's backend to handle Google AI authentication
 * Version 1.3.3
 */

import {
    saveSettingsDebounced,
    saveSettings,
    chat_metadata,
    getRequestHeaders,
    appendMediaToMessage,
    eventSource,
    event_types,
    saveChat,
    saveChatConditional,
    user_avatar,
    getUserAvatar as getAvatarPath,
    name1,
} from '../../../../script.js';

import { getContext, extension_settings } from '../../../extensions.js';
import { getBase64Async, saveBase64AsFile } from '../../../utils.js';
import { power_user } from '../../../power-user.js';
import { oai_settings } from '../../../openai.js';
import { MEDIA_DISPLAY, MEDIA_SOURCE, MEDIA_TYPE, SCROLL_BEHAVIOR } from '../../../constants.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { getModelDefinition, getProviderDefinition, resolveAdapterId, resolveProviderRoute, getProviderDefinitions, getReferenceImageCapability, requiresAdapterRoute } from './lib/providers/registry.js';
import { getCustomCatalogRefreshMessage, getModelFallback, projectCustomConnectionEditor, projectCustomConnectionProviderUi, projectCustomFirstRequestConfirmation, projectProviderControls, projectProviderOptions, projectProviderUi, projectRouteDiagnostics } from './lib/providers/ui-projection.js';
import { mergeFetchedModelEntries, updateLocalModelEntries, mergeDiscoveryModelRecords, getDiscoveryRefreshMessage, updateModelRecords, toLegacyModelEntries } from './lib/providers/model-manager.js';
import { discoverProviderModels, discoverCustomConnectionModels, createModelDiscoveryCoordinator } from './lib/providers/model-discovery.js';
import { dispatchProviderRoute, promoteCustomConnectionEvidence, promoteCustomModelEvidence } from './lib/providers/dispatch.js';
import { createRunCoordinator } from './lib/generation-coordinator.js';
import { buildFocusedMessageContent } from './lib/rp-selection.js';
import { captureWandGenerationInput } from './lib/rp-wand.js';
import { attachGeneratedImageSafely } from './lib/rp-attachment.js';
import { buildGenerationKey, captureMessageTarget, validateMessageTarget } from './lib/rp-target.js';
import { attachNormalizedProviderError, getSafeProviderErrorLogFields, normalizeProviderError } from './lib/providers/errors.js';
import { captureAutoGenerationInput, validateAutoGenerationInput } from './lib/rp-auto.js';
import { bindAppearanceLifecycle, createChatLifecycleEpoch } from './lib/rp-lifecycle.js';
import { createGenerationPlan, mapAspectRatioToImageSize } from './lib/generation-plan.js';
import { experimentalModelPreflightKey, hasExperimentalModelPreflightConsent, inspectGenerationPlan } from './lib/providers/preflight.js';
import { serializeDiagnosticsExport } from './lib/providers/diagnostics.js';
import { migrateProviderSettings } from './lib/providers/settings-migration.js';
import { connectionRevision, createCustomConnectionId, customCredentialRef, migrateCustomConnections, nextCustomDiscoveryEvidence, projectCurrentCustomDiscoveryState, removeCustomConnectionFromSettings, selectCustomConnection, upsertCustomConnection, validateCustomConnection } from './lib/providers/custom-connections.js';
import { deriveSetupReadiness, formatSetupRuntimeIssue, normalizeSettingsTab, projectImageSizePreference, projectReferencePreferences, projectSetupTabStatus, resolveInitialSettingsTab } from './lib/settings-ui.js';
import { createAccessibleDialogController } from './lib/gallery-dialog.js';
import { handleImageArrowNavigation, handleImageGesture, scheduleImageArrowConfiguration } from './lib/rp/image-navigation.js';
import { captureCanonForGeneration, notifyBrokenCanon, resolveHostAvatarIdentityReferences } from './lib/rp/canon-generation-capture.js';
import { buildReferenceMessageParts, materializeHostAvatarReferenceAssets } from './lib/rp/reference-message-parts.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import {
    addAppearanceLook,
    buildAppearanceReferenceCandidates,
    galleryArtifactKey,
    listAppearanceIdentityChoices,
    materializeAppearanceAssets,
    migrateAppearanceLibrary,
    listVisibleAppearanceEntries,
    applyGalleryImageDeletion,
    getProtectedGalleryArtifactIds,
    trimGalleryToLimit,
    planGlobalLookDeletion,
    projectAppearanceLookActionState,
} from './lib/rp/appearance-library.js';
import { deleteAppearanceAssetFile, deleteAppearanceFile } from './lib/rp/appearance-assets.js';
import { CHAT_CANON_KEY, chatCanonRevisionFingerprint, getChatBinding, migrateChatCanon, selectLookForChat, setChatBinding, setChatLock } from './lib/rp/chat-canon.js';
import { enqueueLibraryMutation, persistVerifiedChatMutation, readPersistedExtensionLibrary, reconcilePendingOperation, verifyPersistedChatBinding, verifyPersistedChatMediaLink, verifyPersistedIterationArtifact, verifyPersistedExtensionLibrary, verifyPersistedGalleryArtifact, verifyPersistedGalleryClear, verifyPersistedVisibleCanonPending } from './lib/rp/persistence-verifier.js';
import { persistOrphanCleanupRecovery, reconcileAppearanceOperations, runRebasedLibraryMutation } from './lib/rp/appearance-operations.js';
import { createAppearanceFeatureController, runRememberAppearance } from './lib/rp/appearance-runtime.js';
import { runGlobalLookDeletion, runStopUsingInChat } from './lib/rp/appearance-removal.js';
import { runClearGalleryPreservingLooks } from './lib/rp/appearance-migration.js';
import { buildVisibleCanonMediaArtifactId, createVisibleCanonActionController, createVisibleCanonDomController, linkVisibleCanonGalleryArtifact, linkVisibleCanonMediaArtifact, projectVisibleCanon, resolveVisibleCanonIdentityId, visibleCanonStatus } from './lib/rp/visible-canon.js';
import { createVisibleCanonPendingState, finalizeVisibleCanonPendingReplay, queueVisibleCanonPending, reconcileVisibleCanonPendingLink, resumeVisibleCanonPending, splitVisibleCanonPendingByChat } from './lib/rp/visible-canon-persistence.js';
import { buildAppearanceTruths, buildContinuityReferenceCandidates, buildOutfitPrompt, projectContinuityShelf } from './lib/rp/continuity-shelf.js';
import { buildSceneGenerationSnapshot, createSceneArtifactMetadata, createSceneStatePending, persistAcceptedSceneState, sceneStatePendingKey, SCENE_STATE_METADATA_KEY } from './lib/rp/scene-generation.js';
import { createOutfit, migrateOutfitCatalog, migrateChatOutfitState, getChatOutfitBinding, resolveActiveChatOutfit, selectChatOutfit, setChatOutfitLock } from './lib/rp/outfit-lock.js';
import { createOutfitPendingState, queueOutfitPending, removeOutfitPending, persistTargetedOutfitMutation, resumeOutfitPending, splitOutfitPendingByChat } from './lib/rp/outfit-persistence.js';
import { createIterationArtifact, sanitizeIterationArtifactForStorage } from './lib/rp/iteration-domain.js';
import { createIterationSurfaceController, mountIterationSurface, installIterationSurfaceStyles } from './lib/rp/iteration-ui.js';
import { saveGroupChat } from '../../../group-chats.js';

const extensionName = 'context-image-generation';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    provider: 'makersuite',
    model: 'gemini-2.5-flash-image',
    linkapi_key: '',
    provider_keys: {},
    provider_models: {},
    ui_last_settings_tab: 'setup',
    model_discovery: {},
    experimental_model_preflight: {},
    custom_connections: { schema: 1, connections: {}, models: {}, evidence: {}, modelEvidence: {}, confirmations: {} },
    custom_connection_keys: {},
    custom_connection_editor_id: '',
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
    framing_preference: 'auto',
    continuity_strength: 'balanced',
    custom_visual_instruction: '',
    system_instruction: 'You are an image generation assistant. When reference images are provided, they represent the characters in the story. Generate an illustration that depicts the scene described in the prompt while maintaining the art style and appearance of the reference characters. You are not obligated to include both characters - if the scene depicts only one character alone, illustrate them alone. When available, you can use the internet to search for reference pictures and information to improve the accuracy and quality of your generations.',
    gallery: [],
    visible_canon_pending: {},
    rp_library: { schema: 1, identities: {}, assets: {}, preferences: { sceneContinuity: false } },
    rp_outfits: { schema: 1, outfits: [] },
    outfit_pending: { schema: 1, pending: {} },
    scene_state_pending: { schema: 1, pending: {} },
};

const MAX_GALLERY_SIZE = 50;
const generationCoordinator = createRunCoordinator();
let currentGenerationRunId = null;
let lastGenerationPlanInspection = null;
let setupRuntimeIssue = null;
const activeImageBoundaryGenerations = new Set();
const iterationSurfaceMounts = new Map();
const iterationInvocations = new Set();
generationCoordinator.subscribe((event) => {
    if (event.to === 'running' || event.to === 'cancelling') currentGenerationRunId = event.runId;
    if (['completed', 'failed', 'stale', 'cancelled'].includes(event.to) && currentGenerationRunId === event.runId) currentGenerationRunId = null;
    const cancelControl = $('#cig_cancel_generation');
    if (cancelControl.length) cancelControl.prop('disabled', !currentGenerationRunId).toggle(!!currentGenerationRunId);
});
const modelDiscoveryCoordinator = createModelDiscoveryCoordinator();
let modelDiscoveryUiSequence = 0;
let customConnectionDraftId = '';
const chatLifecycleEpoch = createChatLifecycleEpoch();

function renderAdvancedPlanInspector() {
    const output = $('#cig_preflight_summary');
    if (!output.length) return;
    if (!lastGenerationPlanInspection) {
        output.text('Generate an image first to inspect the captured plan.').show();
        return;
    }
    output.text(JSON.stringify(lastGenerationPlanInspection, null, 2)).show();
}

function exportDiagnostics() {
    const settings = extension_settings[extensionName] || {};
    const blob = new Blob([serializeDiagnosticsExport({ runs: generationCoordinator.list(), discovery: settings.model_discovery })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `context-image-generation-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
    setSetupRuntimeIssue(normalized, operation);
    toastr.error(normalized.userMessage, 'Context Image Generation');
}

function renderSetupReadiness(settings) {
    const providerId = settings.provider || 'makersuite';
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const providerUi = projectSelectedProviderUi(settings, providerId, settings.model, {
        localEntries: getProviderModelEntries(settings, providerId),
        discoveryEvidence: discoveryState.evidence,
        discoveryWarning: discoveryState.warning,
    });
    const readiness = deriveSetupReadiness({
        providerUi,
        providerId,
        modelId: settings.model,
        apiKey: getProviderApiKey(settings, providerId),
    });
    $('#cig_setup_status').text(readiness.label).attr('data-cig-readiness', readiness.state);
    renderSetupTabStatus(readiness);
}

function renderSetupTabStatus(readiness) {
    const status = projectSetupTabStatus(readiness, setupRuntimeIssue);
    const $tab = $('#cig_settings_tab_setup');
    const $badge = $('#cig_setup_tab_status');
    $tab
        .attr('aria-label', status.accessibleLabel)
        .attr('data-cig-status', status.state)
        .toggleClass('cig-has-issue', status.state === 'issue');
    $badge.prop('hidden', !status.text);
    $badge.find('i').attr('class', status.icon ? `fa-solid ${status.icon}` : 'fa-solid');
    $badge.find('span').text(status.text);
}

function renderSetupRuntimeIssue() {
    const $issue = $('#cig_setup_issue');
    $issue.text(setupRuntimeIssue || '').toggle(Boolean(setupRuntimeIssue));
    renderSetupReadiness(extension_settings[extensionName] || {});
}

function setSetupRuntimeIssue(error, context) {
    const settings = extension_settings[extensionName] || {};
    const normalized = error?.userMessage
        ? error
        : normalizeProviderError(error, {
                providerId: settings.provider || 'unknown',
                modelId: settings.model,
            });
    setupRuntimeIssue = formatSetupRuntimeIssue({ context, userMessage: normalized.userMessage });
    renderSetupRuntimeIssue();
}

function clearSetupRuntimeIssue() {
    setupRuntimeIssue = null;
    renderSetupRuntimeIssue();
}

function getProviderApiKey(settings, providerId) {
    const customConnection = getCustomConnection(settings, providerId);
    if (customConnection) return getCustomConnectionKey(settings, customConnection);
    const providerKeys = settings.provider_keys;
    if (providerKeys && typeof providerKeys === 'object' && typeof providerKeys[providerId] === 'string') return providerKeys[providerId];
    return providerId === 'linkapi' ? settings.linkapi_key || '' : '';
}

function setProviderApiKey(settings, providerId, value) {
    if (!settings.provider_keys || typeof settings.provider_keys !== 'object' || Array.isArray(settings.provider_keys)) settings.provider_keys = {};
    settings.provider_keys[providerId] = value;
    if (providerId === 'linkapi') { settings.linkapi_key = value; settings.provider_keys.linkapi = value; }
}

function getCustomConnectionStore(settings) {
    return migrateCustomConnections(settings?.custom_connections);
}

function getCustomConnection(settings, connectionId = settings?.provider) {
    return getCustomConnectionStore(settings).connections?.[connectionId];
}

function getCustomConnectionKey(settings, connection) {
    if (!connection?.credentialRef) return '';
    const keys = settings?.custom_connection_keys;
    return keys && typeof keys === 'object' && typeof keys[connection.credentialRef] === 'string' ? keys[connection.credentialRef] : '';
}

function projectSelectedProviderUi(settings, providerId = settings?.provider || 'makersuite', modelId = settings?.model, options = {}) {
    const connection = getCustomConnection(settings, providerId);
    if (connection) return projectCustomConnectionProviderUi(connection, modelId, {
        ...options,
        credentialConfigured: Boolean(getCustomConnectionKey(settings, connection)),
    });
    return projectProviderUi(providerId, modelId, options);
}

function getProviderModelEntries(settings, providerId) {
    const custom = getCustomConnectionStore(settings);
    if (custom.connections[providerId]) return custom.models[providerId] || [];
    const records = settings.model_records?.[providerId];
    if (Array.isArray(records)) return records;
    const entries = settings.provider_models?.[providerId];
    return Array.isArray(entries) ? entries : [];
}

function getSelectedModelRoute(settings, modelId = settings.model) {
    const providerId = settings.provider || 'makersuite';
    const localModel = getProviderModelEntries(settings, providerId).find((entry) => entry.id === modelId);
    let providerRoute = resolveProviderRoute(providerId, modelId);
    if (!providerRoute.model && (localModel?.transportId || localModel?.transport)) {
        providerRoute = { ...providerRoute, model: { id: modelId, ...cloneSnapshot(localModel) }, transport: localModel.transportId || localModel.transport };
    }
    return {
        providerId,
        modelId,
        model: providerRoute.model,
        transportId: providerRoute.model?.transportId || providerRoute.model?.transport || providerRoute.transport || '',
    };
}

function modelNeedsExperimentalPreflight(model) {
    const sourceKind = model?.source?.kind || model?.source;
    const imageGenerationState = model?.capabilities?.imageGeneration?.state || 'unknown';
    return ['manual', 'fetched'].includes(sourceKind) && imageGenerationState !== 'supported';
}

function isExperimentalPreflightAccepted(settings, route) {
    return hasExperimentalModelPreflightConsent(settings.experimental_model_preflight, route);
}

function setExperimentalPreflight(settings, route, accepted) {
    const key = experimentalModelPreflightKey(route);
    if (!key) return;
    if (!settings.experimental_model_preflight || typeof settings.experimental_model_preflight !== 'object' || Array.isArray(settings.experimental_model_preflight)) settings.experimental_model_preflight = {};
    if (accepted === true) settings.experimental_model_preflight[key] = true;
    else delete settings.experimental_model_preflight[key];
}

function clearExperimentalPreflightForRoute(settings, route) {
    setExperimentalPreflight(settings, route, false);
}

function clearExperimentalPreflightForProvider(settings, providerId) {
    const map = settings.experimental_model_preflight;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const key of Object.keys(map)) {
        try {
            const parsed = JSON.parse(key);
            if (Array.isArray(parsed) && parsed[0] === providerId) delete map[key];
        } catch { /* migration will discard malformed keys */ }
    }
}

function renderExperimentalPreflight(settings, modelId = settings.model) {
    const selectedRoute = getSelectedModelRoute(settings, modelId);
    const showExperimentalPreflight = modelNeedsExperimentalPreflight(selectedRoute.model);
    $('#cig_experimental_preflight').toggle(showExperimentalPreflight);
    $('#cig_experimental_preflight_checkbox')
        .prop('checked', showExperimentalPreflight && isExperimentalPreflightAccepted(settings, selectedRoute))
        .prop('disabled', !showExperimentalPreflight);
    $('#cig_experimental_preflight_warning')
        .text('Endpoint/model is unverified; optional features are disabled.')
        .toggle(showExperimentalPreflight);
}

function setProviderModelRecords(settings, providerId, records) {
    const custom = getCustomConnectionStore(settings);
    if (custom.connections[providerId]) {
        settings.custom_connections = migrateCustomConnections({ ...custom, models: { ...custom.models, [providerId]: records } });
        return;
    }
    if (!settings.model_records || typeof settings.model_records !== 'object' || Array.isArray(settings.model_records)) settings.model_records = {};
    if (!settings.provider_models || typeof settings.provider_models !== 'object' || Array.isArray(settings.provider_models)) settings.provider_models = {};
    settings.model_records[providerId] = records;
    settings.provider_models[providerId] = toLegacyModelEntries(records);
}

function getProviderDiscoveryState(settings, providerId) {
    const custom = getCustomConnectionStore(settings);
    if (custom.connections[providerId]) {
        const evidence = custom.evidence[providerId];
        const states = settings.model_discovery;
        const customStoredState = states && typeof states === 'object' && !Array.isArray(states) ? states[providerId] : undefined;
        const currentDiscovery = projectCurrentCustomDiscoveryState(custom.connections[providerId], customStoredState);
        return evidence ? { evidence: {
            kind: 'openai-list', source: 'custom connection /models endpoint', observedAt: evidence.observedAt,
            retryCount: 0, connectionId: providerId, revision: evidence.revision,
            returnedCount: currentDiscovery.evidence?.returnedCount || 0,
            acceptedCount: currentDiscovery.evidence?.acceptedCount || 0,
            unresolvedCount: currentDiscovery.evidence?.unresolvedCount || 0,
            rejectedCount: currentDiscovery.evidence?.rejectedCount || 0,
        }, ...(currentDiscovery.warning ? { warning: currentDiscovery.warning } : {}) } : currentDiscovery;
    }
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
            returnedCount: result.evidence.returnedCount,
            acceptedCount: result.evidence.acceptedCount,
            unresolvedCount: result.evidence.unresolvedCount,
            rejectedCount: result.evidence.rejectedCount,
            connectionId: result.evidence.connectionId,
            revision: result.evidence.revision,
        },
        ...(result?.warning ? { warning: { code: result.warning.code } } : {}),
    };
    const custom = getCustomConnectionStore(settings);
    if (custom.connections[providerId]) {
        const catalogSucceeded = !result?.warning || result.warning.code === 'DISCOVERY_EMPTY';
        const nextEvidence = catalogSucceeded ? nextCustomDiscoveryEvidence({
            connection: custom.connections[providerId],
            currentEvidence: custom.evidence[providerId],
            observedAt: result?.evidence?.observedAt || new Date().toISOString(),
        }) : undefined;
        settings.custom_connections = migrateCustomConnections({
            ...custom,
            evidence: nextEvidence ? { ...custom.evidence, [providerId]: nextEvidence } : custom.evidence,
        });
        return;
    }
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

const mapAspectRatioToSize = mapAspectRatioToImageSize;

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

/*
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
        } catch (e) { }
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
*/
async function fetchManagedProviderModels() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const ui = projectSelectedProviderUi(settings, providerId, settings.model, {
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
        const customConnection = getCustomConnection(settings, providerId);
        const result = customConnection
            ? await discoverCustomConnectionModels({
                connection: customConnection,
                authPreset: customConnection.credentialRef ? 'bearer' : 'none',
                credential: key,
                existingEvidence: getCustomConnectionStore(settings).evidence[providerId],
                savedModels: getProviderModelEntries(settings, providerId),
                fetchImpl: fetch,
            })
            : await modelDiscoveryCoordinator.refresh(providerId, { apiKey: key });
        const currentSettings = extension_settings[extensionName];
        if (result?.stale || (currentSettings.provider || 'makersuite') !== providerId) return;
        setProviderDiscoveryState(currentSettings, providerId, result);
        setProviderModelRecords(currentSettings, providerId, customConnection
            ? result.models
            : mergeDiscoveryModelRecords(getProviderModelEntries(currentSettings, providerId), result, providerId));
        updateModelDropdown();
        renderModelManager();
        saveSettingsDebounced();
        if (result.warning) {
            setSetupRuntimeIssue(result.warning, 'Provider model discovery');
            toastr.warning(`${result.warning.userMessage} Your current model list was kept.`, 'Context Image Generation');
        }
        else {
            const outcome = getDiscoveryRefreshMessage(result);
            toastr[outcome.level](outcome.message, 'Context Image Generation');
        }
    } catch (error) {
        setSetupRuntimeIssue(error, 'Provider model discovery');
        const safeError = normalizeProviderError(error, { providerId, modelId: settings.model });
        toastr.error(`${safeError.userMessage} Your current model list was kept.`, 'Context Image Generation');
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
    buildAppearanceReferenceCandidates,
});

function emptyCustomConnectionDraft() {
    const id = createCustomConnectionId();
    return {
        schema: 1,
        id,
        label: '',
        protocol: 'openai-images',
        baseUrl: '',
        modelsPath: '/v1/models',
        generationPath: '/v1/images/generations',
        credentialRef: customCredentialRef(id),
        enabled: true,
    };
}

function selectedCustomConnection(settings) {
    const store = getCustomConnectionStore(settings);
    const selectedId = settings.custom_connection_editor_id || customConnectionDraftId;
    return selectCustomConnection(store, selectedId);
}

function renderCustomConnectionEditor() {
    const settings = extension_settings[extensionName] || {};
    const store = getCustomConnectionStore(settings);
    let connection = selectedCustomConnection(settings);
    if (!connection) {
        if (!customConnectionDraftId) customConnectionDraftId = createCustomConnectionId();
        connection = { ...emptyCustomConnectionDraft(), id: customConnectionDraftId, credentialRef: customCredentialRef(customConnectionDraftId) };
    } else {
        customConnectionDraftId = connection.id;
        settings.custom_connection_editor_id = connection.id;
    }
    const $list = $('#cig_custom_connection_list').empty();
    for (const saved of Object.values(store.connections)) $list.append($('<option>').val(saved.id).text(saved.label));
    $list.val(store.connections[connection.id] ? connection.id : '');
    const key = getCustomConnectionKey(settings, connection);
    const editor = validateCustomConnection(connection).valid
        ? projectCustomConnectionEditor(connection, { credentialConfigured: Boolean(key), evidence: store.evidence[connection.id] })
        : null;
    $('#cig_custom_connection_label').val(connection.label || '');
    const protocol = connection.protocol === 'gemini-compatible' ? 'gemini-compatible' : 'openai-images';
    $('#cig_custom_connection_protocol').val(protocol);
    $('#cig_custom_connection_base_url').val(connection.baseUrl || '');
    $('#cig_custom_connection_models_path').val(connection.modelsPath || '/v1/models');
    $('#cig_custom_connection_generation_path').val(connection.generationPath || '/v1/images/generations').toggle(protocol === 'openai-images');
    $('#cig_custom_connection_generation_path_label').toggle(protocol === 'openai-images');
    $('#cig_custom_connection_auth').val(connection.credentialRef ? (protocol === 'gemini-compatible' ? 'gemini-api-key' : 'bearer') : 'none');
    $('#cig_custom_connection_key').val('').prop('disabled', !connection.credentialRef)
        .attr('placeholder', key ? 'Saved key (enter to replace)' : 'Enter API key');
    $('#cig_custom_connection_enabled').prop('checked', connection.enabled !== false);
    $('#cig_custom_connection_status').text(editor ? editor.status.label : 'Not saved');
    $('#cig_custom_connection_delete').prop('disabled', !store.connections[connection.id]);
    const localWarning = editor?.localInsecure ? 'Local HTTP connections are not encrypted. Use this only for a trusted service on this device.' : '';
    $('#cig_custom_connection_local_warning').text(localWarning).prop('hidden', !editor?.localInsecure).toggle(Boolean(editor?.localInsecure));
    const firstRequestWarning = editor?.status?.firstRequestWarning || '';
    $('#cig_custom_connection_first_request_warning').text(firstRequestWarning).prop('hidden', !firstRequestWarning).toggle(Boolean(firstRequestWarning));
    const selectedModel = store.models[connection.id]?.find((model) => model.id === settings.model) || store.models[connection.id]?.[0];
    const routeEvidence = selectedModel?.routeEvidence || (store.evidence[connection.id] ? {
        ...store.evidence[connection.id],
        source: store.evidence[connection.id].state === 'verified' ? 'sanitized-probe' : 'user-configured-protocol',
    } : undefined);
    const discoveryEvidence = getProviderDiscoveryState(settings, connection.id).evidence;
    const diagnostics = editor ? projectRouteDiagnostics({
        label: editor.label,
        protocol: editor.protocol.value,
        transportId: selectedModel?.transportId || (editor.protocol.value === 'gemini-compatible' ? 'sillytavern-gemini-proxy' : 'openai-images'),
        endpointClass: selectedModel?.endpointClass || (editor.protocol.value === 'gemini-compatible' ? 'custom-gemini-proxy' : 'custom-openai-images'),
        originClass: editor.localInsecure ? 'local-loopback' : 'secure-remote',
        modelId: selectedModel?.id,
        imageCapability: selectedModel?.capabilities?.imageGeneration,
        routeEvidence,
        discoveryEvidence,
    }) : null;
    $('#cig_custom_connection_route_summary').text(diagnostics
        ? `${diagnostics.label} · ${diagnostics.evidence.state} route · ${diagnostics.catalog.returned} returned / ${diagnostics.catalog.accepted} accepted / ${diagnostics.catalog.unresolved} unresolved / ${diagnostics.catalog.rejected} rejected`
        : 'Save a valid connection to inspect its route.');
    const previewLines = editor && diagnostics ? [
        `Connection: ${diagnostics.label}`,
        `Protocol: ${diagnostics.protocol}`,
        `Transport: ${diagnostics.transport}`,
        `Endpoint class: ${diagnostics.endpointClass}`,
        `Origin class: ${diagnostics.originClass}`,
        'Catalog request: GET expected catalog path',
        'Generation request: POST configured endpoint class',
        `Model: ${diagnostics.model.id}`,
        `Image capability: ${diagnostics.model.imageCapability}`,
        `Route evidence: ${diagnostics.evidence.state} (${diagnostics.evidence.source})`,
        ...(diagnostics.evidence.observedAt ? [`Observed: ${diagnostics.evidence.observedAt}`] : []),
        `Catalog counts: ${diagnostics.catalog.returned} returned, ${diagnostics.catalog.accepted} accepted, ${diagnostics.catalog.unresolved} unresolved, ${diagnostics.catalog.rejected} rejected`,
    ] : ['Save a valid origin and paths to preview the route.'];
    $('#cig_custom_connection_preview').text(previewLines.join('\n'));
}

function readCustomConnectionDraft() {
    const settings = extension_settings[extensionName] || {};
    const existing = selectedCustomConnection(settings);
    const id = existing?.id || customConnectionDraftId || createCustomConnectionId();
    const protocol = $('#cig_custom_connection_protocol').val() === 'gemini-compatible' ? 'gemini-compatible' : 'openai-images';
    const authPreset = $('#cig_custom_connection_auth').val() === 'none' ? 'none' : (protocol === 'gemini-compatible' ? 'gemini-api-key' : 'bearer');
    return {
        schema: 1,
        id,
        label: String($('#cig_custom_connection_label').val() || ''),
        protocol,
        baseUrl: String($('#cig_custom_connection_base_url').val() || ''),
        modelsPath: String($('#cig_custom_connection_models_path').val() || '/v1/models'),
        ...(protocol === 'openai-images' ? { generationPath: String($('#cig_custom_connection_generation_path').val() || '/v1/images/generations') } : {}),
        credentialRef: authPreset !== 'none' ? customCredentialRef(id) : null,
        enabled: $('#cig_custom_connection_enabled').prop('checked') !== false,
    };
}

function saveCustomConnectionFromEditor() {
    const settings = extension_settings[extensionName];
    const draft = readCustomConnectionDraft();
    const validation = validateCustomConnection(draft);
    if (!validation.valid) throw new TypeError(validation.errors[0]?.message || 'Invalid custom connection.');
    settings.custom_connections = upsertCustomConnection(getCustomConnectionStore(settings), validation.connection);
    if (!settings.custom_connection_keys || typeof settings.custom_connection_keys !== 'object' || Array.isArray(settings.custom_connection_keys)) settings.custom_connection_keys = {};
    const enteredKey = String($('#cig_custom_connection_key').val() || '');
    if (validation.connection.credentialRef && enteredKey) settings.custom_connection_keys[validation.connection.credentialRef] = enteredKey;
    if (!validation.connection.credentialRef && draft.id) delete settings.custom_connection_keys[customCredentialRef(draft.id)];
    settings.custom_connection_editor_id = validation.connection.id;
    customConnectionDraftId = validation.connection.id;
    renderProviderDropdown();
    $('#cig_provider').val(settings.provider);
    renderCustomConnectionEditor();
    saveSettingsDebounced();
    return validation.connection;
}

async function testCustomConnectionFromEditor() {
    let connection;
    try { connection = saveCustomConnectionFromEditor(); }
    catch (error) { toastr.warning(error.message, 'Context Image Generation'); return; }
    const settings = extension_settings[extensionName];
    const control = $('#cig_custom_connection_test');
    setBusyState(control, true, { busyTitle: 'Testing connection…' });
    try {
        const store = getCustomConnectionStore(settings);
        const result = await discoverCustomConnectionModels({
            connection,
            authPreset: connection.credentialRef ? (connection.protocol === 'gemini-compatible' ? 'gemini-api-key' : 'bearer') : 'none',
            credential: getCustomConnectionKey(settings, connection),
            existingEvidence: store.evidence[connection.id],
            savedModels: store.models[connection.id] || [],
            fetchImpl: fetch,
        });
        setProviderModelRecords(settings, connection.id, result.models);
        setProviderDiscoveryState(settings, connection.id, result);
        if (!result.warning || result.warning.code === 'DISCOVERY_EMPTY') {
            settings.provider = connection.id;
            settings.model = result.models[0]?.id || settings.model;
            toastr.success(getCustomCatalogRefreshMessage(result.models), 'Context Image Generation');
        } else toastr.warning(result.warning.userMessage, 'Context Image Generation');
        renderProviderDropdown();
        $('#cig_provider').val(settings.provider);
        refreshManagedModels();
        renderCustomConnectionEditor();
        saveSettingsDebounced();
    } finally {
        setBusyState(control, false);
    }
}

async function deleteSelectedCustomConnection() {
    const settings = extension_settings[extensionName];
    const connection = selectedCustomConnection(settings);
    if (!connection || !getCustomConnectionStore(settings).connections[connection.id]) return;
    if (!await confirmDestructiveAction('Delete connection? Its saved models, route evidence, and saved key will be removed.', 'Delete connection')) return;
    cancelModelDiscovery(connection.id);
    const result = removeCustomConnectionFromSettings(settings, connection.id);
    if (!result.removed) return;
    Object.assign(settings, result.settings);
    customConnectionDraftId = '';
    clearSetupRuntimeIssue();
    renderProviderDropdown();
    $('#cig_provider').val(settings.provider);
    updateModelDropdown();
    toggleProviderSpecificSettings();
    renderModelManager();
    renderCustomConnectionEditor();
    saveSettingsDebounced();
    toastr.success('Custom connection deleted.', 'Context Image Generation');
}

function renderProviderDropdown() {
    const $providerSelect = $('#cig_provider').empty();
    const customConnections = Object.values(getCustomConnectionStore(extension_settings[extensionName] || {}).connections);
    for (const provider of projectProviderOptions({ customConnections })) {
        const unavailableLabel = provider.available === false
            ? ` — ${String(provider.unavailableReason || 'Unavailable until server adapter support').replace(/\s+/g, ' ').slice(0, 96)}`
            : '';
        $providerSelect.append($('<option>')
            .val(provider.id)
            .text(`${provider.label || provider.id}${unavailableLabel}`)
            .prop('disabled', provider.available === false)
            .attr('title', provider.available === false ? provider.unavailableReason || 'Available after the optional server adapter is installed.' : undefined));
    }
}

function updateModelDropdown() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const localEntries = getProviderModelEntries(settings, providerId);
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const ui = projectSelectedProviderUi(settings, providerId, settings.model, {
        localEntries,
        discoveryEvidence: discoveryState.evidence,
        discoveryWarning: discoveryState.warning,
    });
    if (!ui) return;
    settings.model = getCustomConnection(settings, providerId)
        ? ui.selectedModelId || settings.model || ''
        : getModelFallback(providerId, settings.model, localEntries);
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
    if (ui.available === false) statusParts.push(ui.unavailableReason || 'This provider is unavailable until a server adapter is available.');
    if (discovery.warning?.userMessage) statusParts.push(discovery.warning.userMessage);
    else if (discovery.evidence) {
        statusParts.push(`Source: ${discovery.evidence.source}`);
        if (discovery.lastRefresh) statusParts.push(`Last refreshed: ${new Date(discovery.lastRefresh).toLocaleString()}`);
    } else if (!discovery.refreshEnabled && discovery.disabledReason) statusParts.push(discovery.disabledReason);
    $('#cig_model_discovery_status').text(statusParts.join(' · '));
    $('#cig_model_refresh')
        .toggle(discovery.refreshEnabled)
        .prop('disabled', !discovery.refreshEnabled)
        .attr('title', discovery.refreshEnabled ? 'Refresh available models' : discovery.disabledReason || 'Model refresh is unavailable');
    $('#cig_model_refresh_hint')
        .text(discovery.refreshEnabled ? '' : discovery.disabledReason || '')
        .toggle(!discovery.refreshEnabled && Boolean(discovery.disabledReason));
    toggleImageSizeVisibility();
    renderSetupReadiness(settings);
}

function activateSettingsTab(tabId, { persist = true } = {}) {
    const selectedTab = normalizeSettingsTab(tabId);
    const tabs = $('#cig_settings [data-cig-tab]');
    const panels = $('#cig_settings [data-cig-panel]');
    if (!tabs.length || !panels.length) return selectedTab;

    tabs.each(function () {
        const isActive = $(this).attr('data-cig-tab') === selectedTab;
        $(this)
            .attr('aria-selected', isActive.toString())
            .attr('tabindex', isActive ? '0' : '-1');
    });
    panels.each(function () {
        const isActive = $(this).attr('data-cig-panel') === selectedTab;
        $(this).prop('hidden', !isActive);
    });

    if (persist) {
        const settings = extension_settings[extensionName];
        settings.ui_last_settings_tab = selectedTab;
        saveSettingsDebounced();
    }
    return selectedTab;
}

function selectInitialSettingsTab(settings) {
    const providerId = settings.provider || 'makersuite';
    const providerUi = projectSelectedProviderUi(settings, providerId, settings.model, {
        localEntries: getProviderModelEntries(settings, providerId),
    });
    const readiness = deriveSetupReadiness({
        providerUi,
        providerId,
        modelId: settings.model,
        apiKey: getProviderApiKey(settings, providerId),
    });
    activateSettingsTab(resolveInitialSettingsTab({ savedTab: settings.ui_last_settings_tab, readiness }), { persist: false });
}

async function loadSettings() {
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
    const migratedOutfitCatalog = migrateOutfitCatalog(cigSettings.rp_outfits);
    if (JSON.stringify(cigSettings.rp_outfits) !== JSON.stringify(migratedOutfitCatalog)) {
        cigSettings.rp_outfits = migratedOutfitCatalog;
        settingsMigrated = true;
    }
    const migratedOutfitPending = createOutfitPendingState(cigSettings.outfit_pending);
    if (JSON.stringify(cigSettings.outfit_pending) !== JSON.stringify(migratedOutfitPending)) {
        cigSettings.outfit_pending = migratedOutfitPending;
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

    await enqueueLibraryMutation(() => resumePendingAppearanceOperations());
    await resumePendingVisibleCanonLinks();
    await resumePendingOutfitState();
    await resumePendingSceneState();


    $('#cig_provider').val(extension_settings[extensionName].provider);
    updateModelDropdown();
    $('#cig_model').val(extension_settings[extensionName].model);
    $('#cig_provider_api_key').val(getProviderApiKey(cigSettings, cigSettings.provider || 'makersuite'));
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
    $('#cig_framing_preference').val(extension_settings[extensionName].framing_preference);
    $('#cig_continuity_strength').val(extension_settings[extensionName].continuity_strength);
    $('#cig_custom_visual_instruction').val(extension_settings[extensionName].custom_visual_instruction);
    $('#cig_system_instruction').val(extension_settings[extensionName].system_instruction);

    toggleImageSizeVisibility();
    toggleProviderSpecificSettings();
    renderModelManager();
    renderSetupReadiness(cigSettings);
    renderSetupRuntimeIssue();
    renderGallery();
    renderAppearanceList();
    renderCustomConnectionEditor();
    selectInitialSettingsTab(cigSettings);
}

function toggleProviderSpecificSettings() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const ui = projectSelectedProviderUi(settings, providerId, settings.model, { localEntries: getProviderModelEntries(settings, providerId) });
    if (!ui) return;
    const credential = ui.credential;
    $('#cig_provider_key_container').toggle(credential.mode === 'extension-key');
    $('#cig_provider_advanced_container').toggle(Boolean(credential.advancedHelp));
    $('#cig_provider_api_key_label').text(credential.label);
    $('#cig_provider_api_key').attr('placeholder', credential.placeholder);
    $('#cig_provider_api_key').val(getProviderApiKey(settings, settings.provider));
    $('#cig_provider_info').text(credential.setupHelp).toggle(Boolean(credential.setupHelp));
    $('#cig_provider_advanced_info').text(credential.advancedHelp).toggle(Boolean(credential.advancedHelp));
    renderSetupReadiness(settings);
}

function renderModelManager() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const localEntries = getProviderModelEntries(settings, providerId);
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const ui = projectSelectedProviderUi(settings, providerId, settings.model, {
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
    const customConnection = getCustomConnection(settings, providerId);
    const provider = getProviderDefinition(providerId) || (customConnection ? { id: providerId, transports: customConnection.protocol === 'gemini-compatible' ? { sillyTavernGeminiProxy: { baseUrl: customConnection.baseUrl } } : { openAiImages: { baseUrl: customConnection.baseUrl } }, models: [] } : undefined);
    const selectedEntry = localEntries.find((entry) => entry.id === settings.model);
    const $transport = $('#cig_managed_model_transport').empty();
    for (const transport of Object.keys(provider?.transports || {})) {
        const label = transport === 'sillyTavernGeminiProxy' ? 'Gemini-compatible proxy' : transport === 'openAiImages' ? 'OpenAI Images API' : transport;
        $transport.append($('<option>').val(transport).text(label));
    }
    $transport.val(selectedEntry?.transportId || selectedEntry?.transport || provider?.models?.find((model) => model.id === settings.model)?.transport || $transport.val());
    $('#cig_managed_model_transport_container').toggle($transport.children().length > 1);
    renderExperimentalPreflight(settings);
    $('#cig_model_discovery_note')
        .text(ui.modelDiscovery.warning?.userMessage || (ui.modelDiscovery.refreshEnabled
            ? 'Refresh merges discovered models and keeps your local entries.'
            : ui.modelDiscovery.disabledReason || ''))
        .toggle(Boolean(ui.modelDiscovery.warning?.userMessage || ui.modelDiscovery.refreshEnabled || ui.modelDiscovery.disabledReason));
    $('#cig_remove_model').prop('disabled', !localEntries.some((entry) => entry.id === settings.model));
    renderSetupReadiness(settings);
}

function refreshManagedModels() {
    updateModelDropdown();
    toggleImageSizeVisibility();
    toggleProviderSpecificSettings();
    renderModelManager();
    renderSetupReadiness(extension_settings[extensionName]);
}

function saveManagedModel(operation) {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const customConnection = getCustomConnection(settings, providerId);
    const provider = getProviderDefinition(providerId) || (customConnection ? { id: providerId, transports: customConnection.protocol === 'gemini-compatible' ? { sillyTavernGeminiProxy: { baseUrl: customConnection.baseUrl } } : { openAiImages: { baseUrl: customConnection.baseUrl } }, models: [] } : undefined);
    const id = $('#cig_managed_model_id').val().trim();
    if (!id) {
        toastr.warning('Enter an actual model ID.', 'Context Image Generation');
        return;
    }
    const previousId = $('#cig_managed_model_list').val();
    const localEntries = getProviderModelEntries(settings, providerId);
    const transport = $('#cig_managed_model_transport').val() || undefined;
    const previousEntry = localEntries.find((entry) => entry.id === previousId);
    const previousTransport = previousEntry?.transportId || previousEntry?.transport || provider?.models?.find((model) => model.id === previousId)?.transport || transport;
    clearExperimentalPreflightForRoute(settings, { providerId, modelId: previousId, transportId: previousTransport });
    clearExperimentalPreflightForRoute(settings, { providerId, modelId: previousId, transportId: transport });
    const type = operation === 'save' && localEntries.some((entry) => entry.id === previousId) ? 'replace' : 'upsert';
    setProviderModelRecords(settings, providerId, updateModelRecords(localEntries, { type, previousId, id, source: 'manual', transportId: transport }, providerId));
    settings.model = id;
    clearSetupRuntimeIssue();
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
    const customUi = projectSelectedProviderUi(settings, providerId, settings.model, { localEntries: getProviderModelEntries(settings, providerId) });
    settings.model = getCustomConnection(settings, providerId)
        ? customUi?.selectedModelId || ''
        : getModelFallback(providerId, settings.model, getProviderModelEntries(settings, providerId));
    clearSetupRuntimeIssue();
    refreshManagedModels();
    saveSettingsDebounced();
}
function toggleImageSizeVisibility() {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const connection = getCustomConnection(settings, providerId);
    const discoveryState = getProviderDiscoveryState(settings, providerId);
    const ui = projectProviderControls(providerId, settings.model, settings.image_size, {
        localEntries: getProviderModelEntries(settings, providerId),
        connection,
        discoveryEvidence: discoveryState.evidence,
        discoveryWarning: discoveryState.warning,
        credentialConfigured: Boolean(getCustomConnectionKey(settings, connection)),
    });
    if (!ui) return;
    const imageSizePreference = projectImageSizePreference(settings.image_size, ui.imageSizeOptions);
    $('#cig_image_size_container').toggle(imageSizePreference.showControl);
    $('#cig_image_size_capability_note').text(imageSizePreference.note).prop('hidden', !imageSizePreference.note);
    $('#cig_flash2_options').prop('hidden', !(ui.supportsThinking || ui.supportsGoogleSearch));
    $('#cig_model_note').text(ui.modelNote || '').toggle(Boolean(ui.modelNote));
    renderReferenceCapabilityControls(ui.supportsReferenceImages);
    if (imageSizePreference.showControl) updateSizeDropdown(ui.imageSizeOptions, imageSizePreference.selectedValue);
}

function renderReferenceCapabilityControls(supportsReferenceImages) {
    const settings = extension_settings[extensionName] || {};
    const referencePreferences = projectReferencePreferences({
        useAvatars: settings.use_avatars,
        usePreviousImage: settings.use_previous_image,
    }, supportsReferenceImages);
    $('#cig_avatar_reference_option').toggle(referencePreferences.showAvatarControl);
    $('#cig_previous_image_reference_option').toggle(referencePreferences.showPreviousImageControl);
    $('#cig_reference_capability_note').text(referencePreferences.note).prop('hidden', !referencePreferences.note);
}

function updateSizeDropdown(imageSizeOptions, selectedValue = extension_settings[extensionName].image_size || '') {
    const $sizeSelect = $('#cig_image_size');
    $sizeSelect.empty().append('<option value="">Default</option>');
    for (const option of imageSizeOptions) $sizeSelect.append($('<option>').val(option.value).text(option.label));
    $sizeSelect.val(selectedValue);
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

async function getCharacterAvatar(identityId = null) {
    const context = getContext();
    const characters = Array.isArray(context.characters) ? context.characters : Object.values(context.characters || {});
    const identityKey = String(identityId || '').replace(/^character:/u, '');
    const character = identityKey
        ? characters.find((entry) => String(entry?.avatar || '') === identityKey || String(entry?.id || '') === identityKey)
        : context.characters[context.characterId];
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

async function confirmCustomConnectionRoute(settings, invocation) {
    const connection = getCustomConnection(settings, settings.provider);
    if (!connection) return { accepted: false, confirmedRevision: '' };
    const store = getCustomConnectionStore(settings);
    const revision = connectionRevision(connection);
    const evidence = store.evidence[connection.id];
    if (evidence?.revision !== revision || !['configured', 'verified'].includes(evidence?.state)) {
        throw new Error('Test and fetch models before generating through this custom connection.');
    }
    if (evidence.state === 'verified') return { accepted: true, confirmedRevision: revision };
    if (!['settings', 'wand', 'slash'].includes(invocation)) {
        throw new Error('Configured custom connections cannot run from automation, swipe, or background generation.');
    }
    const projection = projectCustomConnectionEditor(connection, {
        credentialConfigured: Boolean(getCustomConnectionKey(settings, connection)),
        evidence,
    });
    const confirmation = projectCustomFirstRequestConfirmation(connection);
    const popup = new Popup(confirmation.message, POPUP_TYPE.CONFIRM, null, {
        okButton: 'Test with one generation',
        cancelButton: 'Cancel',
        animation: 'fast',
    });
    const accepted = (await popup.show()) === POPUP_RESULT.AFFIRMATIVE;
    if (!accepted) throw new Error('Custom connection generation was cancelled before any request.');
    return { accepted: true, confirmedRevision: revision };
}

function captureGenerationSnapshot(prompt, sender = null, messageId = null, focusText = null, target = null, invocation = 'settings', routeConfirmation = {}) {
    const settings = extension_settings[extensionName];
    const providerId = settings.provider || 'makersuite';
    const modelId = settings.model;
    const customConnection = getCustomConnection(settings, providerId);
    let providerRoute = customConnection ? {
        provider: {
            id: customConnection.id,
            label: customConnection.label,
            credentialKey: customConnection.credentialRef || undefined,
            transports: customConnection.protocol === 'gemini-compatible'
                ? { sillyTavernGeminiProxy: { baseUrl: customConnection.baseUrl } }
                : { openAiImages: { baseUrl: `${customConnection.baseUrl}${customConnection.generationPath}` } },
        },
        model: getProviderModelEntries(settings, providerId).find((entry) => entry.id === modelId),
        transport: customConnection.protocol === 'gemini-compatible' ? 'sillyTavernGeminiProxy' : 'openAiImages',
    } : resolveProviderRoute(providerId, modelId);
    const localModel = getProviderModelEntries(settings, providerId).find((entry) => entry.id === modelId);
    if (!providerRoute.model && (localModel?.transportId || localModel?.transport)) {
        providerRoute = { ...providerRoute, model: { id: modelId, ...cloneSnapshot(localModel) }, transport: localModel.transportId || localModel.transport };
    }
    const legacyTransport = providerRoute.transport;
    if (!providerRoute.provider || !providerRoute.model || !legacyTransport) {
        throw new Error(`Provider/model route is unresolved: ${providerId}/${modelId}.`);
    }
    if (providerRoute.provider.available === false || providerRoute.provider.posture === 'future-server') {
        throw new Error(`${providerRoute.provider.label || providerId} is unavailable until a server adapter is available.`);
    }
    const transportId = resolveAdapterId(legacyTransport);
    if (!transportId) throw new Error(`Transport route is unresolved for ${providerId}/${modelId}.`);
    const routeModel = providerRoute.model || { id: modelId, providerId, transportId };
    const preflightRoute = { providerId, modelId, transportId: legacyTransport };
    const preflightAccepted = !modelNeedsExperimentalPreflight(routeModel) || isExperimentalPreflightAccepted(settings, preflightRoute);
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
    const appearanceIdentities = getAppearanceIdentityChoices();
    if (capability && settingsSnapshot.use_previous_image && gallerySnapshot.length > 0) referenceCandidates.push({ id: 'legacy:previous', role: 'legacy-previous', assetId: 'asset:legacy-previous', label: 'previous image' });
    // Legacy contract: if (supportsReferenceImages && settings.use_avatars) { —
    // the captured capability/setting snapshot below is the authority.
    if (capability && settingsSnapshot.use_avatars) {
        const context = getContext();
        const activeCharacter = context.characters?.[context.characterId];
        referenceCandidates.push(...resolveHostAvatarIdentityReferences({
            identities: appearanceIdentities,
            activeCharacterAvatar: activeCharacter?.avatar,
            personaAvatar: user_avatar,
            groupCharacterAvatars: context.groups?.find((entry) => String(entry.id) === String(context.groupId))?.members || [],
        }));
    }
    const canonCapture = captureCanonForGeneration({
        library: settingsSnapshot.rp_library,
        gallery: gallerySnapshot,
        chatState: chat_metadata[CHAT_CANON_KEY],
        identities: appearanceIdentities,
        references: referenceCandidates,
    });
    const appearanceTruthEntries = continuityTruths(appearanceIdentities);
    const continuityCandidates = buildContinuityReferenceCandidates({
        identities: appearanceIdentities,
        truths: appearanceTruthEntries,
        remembered: canonCapture.canonSnapshot.references,
        avatarReferences: canonCapture.references,
        priorScene: referenceCandidates.filter((candidate) => candidate.role === 'legacy-previous'),
        includeDescriptions: settingsSnapshot.include_descriptions === true,
    }).map((candidate) => ({
        ...candidate,
        ...(canonCapture.canonSnapshot.assets?.[candidate.assetId]?.url ? { thumbnail: canonCapture.canonSnapshot.assets[candidate.assetId].url } : {}),
    }));
    const continuityReferencePlan = projectContinuityShelf({
        identities: appearanceIdentities,
        truths: appearanceTruthEntries,
        candidates: continuityCandidates,
        modelLimit: capability?.maxCount,
        outfitCatalog: settingsSnapshot.rp_outfits,
        outfitState: chat_metadata[CHAT_CANON_KEY]?.outfitState,
        includeDescriptions: settingsSnapshot.include_descriptions === true,
        includeAvatars: settingsSnapshot.use_avatars === true,
    });
    const activeOutfits = continuityReferencePlan.identities
        .filter((entry) => entry.activeOutfit)
        .map((entry) => ({ identityId: entry.identityId, identityLabel: entry.identityLabel, outfit: entry.activeOutfit }));
    const outfitText = buildOutfitPrompt(activeOutfits);
    const rawAppearanceDescription = appearanceTruthEntries
        .filter((entry) => entry.description?.text)
        .map((entry) => `[${entry.identity?.label || entry.identityId} Appearance]: ${entry.description.text}`)
        .join('\n\n');
    if (rawAppearanceDescription && settingsSnapshot.include_descriptions === true) descriptionText = [descriptionText, rawAppearanceDescription].filter(Boolean).join('\n\n');
    const sceneSnapshot = buildSceneGenerationSnapshot({
        selectedPassage: focusText,
        clickedMessage: { name: sender || '', mes: prompt },
        recentContext: recentMessages,
        identities: appearanceIdentities,
        priorStoryState: chat_metadata[SCENE_STATE_METADATA_KEY],
        settings: settingsSnapshot,
    });
    const sceneMetadata = createSceneArtifactMetadata(sceneSnapshot);
    const scenePlan = { ...sceneMetadata, state: cloneSnapshot(sceneSnapshot.state) };
    // The scene snapshot is the provider-facing source of truth for the wand:
    // selected text wins, while the clicked message and nearby context resolve
    // cast, location, and current scene facts.
    messageContent = sceneSnapshot.prompt || messageContent;
    const connectionId = routeModel.connectionId || `${providerId}:default`;
    const endpointClass = routeModel.endpointClass || (customConnection ? (customConnection.protocol === 'gemini-compatible' ? 'custom-gemini-proxy' : 'custom-openai-images') : legacyTransport);
    const planInput = {
        id: `generation:${getGenerationKey(prompt, messageId, target)}`,
        idempotencyKey: getGenerationKey(prompt, messageId, target),
        invocation,
        target: cloneSnapshot(target),
        provider: { providerId, modelId, transport: transportId, capabilities: routeModel.capabilities || routeModel },
        resolved: { connectionId, providerId, modelId, transportId, endpointClass, modelDefinition: routeModel, ...(routeModel.routeEvidence ? { routeEvidence: routeModel.routeEvidence } : {}), ...(providerRoute.provider?.transports?.[legacyTransport]?.baseUrl ? { endpoint: providerRoute.provider.transports[legacyTransport].baseUrl } : {}), capabilities: routeModel.capabilities || routeModel },
        prompt: { sourceMessage: prompt, focusText, nearbyMessages: recentMessages, sender: sender || '', messageContent, descriptionText, outfitText, intent: 'scene' },
        scene: scenePlan,
        canonSnapshot: canonCapture.canonSnapshot,
        identities: appearanceIdentities,
        references: canonCapture.references,
        referencePlan: continuityReferencePlan,
        activeOutfits,
        referenceContext: { speakerIdentityId: getStableSpeakerIdentityId(sender) },
        options: { aspectRatio: settingsSnapshot.aspect_ratio, imageSize: settingsSnapshot.image_size, systemInstruction: settingsSnapshot.system_instruction, thinkingLevel: settingsSnapshot.thinking_level, useGoogleSearch: settingsSnapshot.use_google_search },
        policy: { source: invocation === 'automation' ? 'automation' : 'manual', preflightAccepted, routeConfirmationAccepted: routeConfirmation.accepted === true },
    };
    return Object.freeze({
        planInput, providerRoute: cloneSnapshot(providerRoute), routeModel: cloneSnapshot(routeModel), settingsSnapshot,
        apiKey: getProviderApiKey(settingsSnapshot, providerId), reverseProxy: oai_settings.reverse_proxy || '', gallerySnapshot,
        referenceAssets: canonCapture.canonSnapshot.assets,
        referenceCandidates: [...canonCapture.canonSnapshot.references, ...canonCapture.references],
        customConnection: customConnection ? cloneSnapshot(customConnection) : null,
        confirmedRevision: routeConfirmation.confirmedRevision || '',
        continuityCandidates,
    });
}

async function materializeSnapshotAssets(snapshot) {
    const assets = {
        ...(snapshot.referenceAssets || {}),
        ...await materializeHostAvatarReferenceAssets({
            references: snapshot.referenceCandidates,
            getCharacterAvatar,
            getUserAvatar,
        }),
    };
    if (snapshot.referenceCandidates.some((reference) => reference.id === 'legacy:previous')) {
        const dataUrl = await galleryItemToDataUrl(snapshot.gallerySnapshot[0]);
        if (dataUrl) assets['asset:legacy-previous'] = { url: dataUrl, mimeType: 'image/png' };
    }
    return assets;
}

// Compatibility signature: buildMessages(prompt, sender, messageId, focusText, invocation).
async function buildMessages(prompt, sender = null, messageId = null, focusText = null, invocation = 'settings', plan = null, referenceAssets = {}) {
    if (!plan) throw new TypeError('buildMessages requires a captured GenerationPlan.');
    const contentParts = [];
    if (plan.options.systemInstruction) contentParts.push({ type: 'text', text: plan.options.systemInstruction });
    if (plan.prompt.descriptionText) contentParts.push({ type: 'text', text: plan.prompt.descriptionText });
    if (plan.prompt.outfitText) contentParts.push({ type: 'text', text: plan.prompt.outfitText });
    contentParts.push({ type: 'text', text: plan.prompt.messageContent || plan.prompt.sourceMessage });
    contentParts.push(...buildReferenceMessageParts(plan, referenceAssets));

    return [{ role: 'user', content: contentParts }];
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

async function generateImageFromPrompt(prompt, sender = null, messageId = null, focusText = null, target = null, invocation = 'settings', finalize = null, iterationRecipe = null) {
    return await generateImageFromPromptInternal(prompt, sender, messageId, focusText, target, invocation, finalize, iterationRecipe);
}

function assertExactIterationRoute(snapshot, recipe) {
    const savedRoute = recipe?.route || {};
    const savedModel = recipe?.model || {};
    const current = snapshot?.planInput?.resolved || {};
      const expected = {
          providerId: savedRoute.providerId || savedModel.providerId,
          modelId: savedRoute.modelId || savedModel.modelId,
          transportId: savedRoute.transportId || savedRoute.transport || savedModel.transportId,
          connectionId: savedRoute.connectionId || savedModel.connectionId,
      };
      if (savedRoute.endpointClass || savedModel.endpointClass) expected.endpointClass = savedRoute.endpointClass || savedModel.endpointClass;
    if (!expected.providerId || !expected.modelId || !expected.transportId || !expected.connectionId) throw new Error('Saved recipe route is incomplete; reopen the original image to capture a fresh route.');
    for (const key of Object.keys(expected)) {
        if (String(current[key] || '') !== String(expected[key])) throw new Error('Saved recipe route is no longer executable; choose the current settings to generate a new image.');
    }
    if (snapshot.planInput.policy?.routeConfirmationAccepted !== true) throw new Error('Saved recipe route is no longer executable because route confirmation is stale.');
}

async function generateImageFromPromptInternal(prompt, sender = null, messageId = null, focusText = null, target = null, invocation = 'settings', finalize = null, iterationRecipe = null, coordinatorOverride = generationCoordinator, executionSignal = null) {
    let snapshot;
    try {
        // Legacy resolver shape: let providerRoute = resolveProviderRoute(selectedProvider, settings.model);
        const routeConfirmation = await confirmCustomConnectionRoute(extension_settings[extensionName], invocation);
        snapshot = captureGenerationSnapshot(prompt, sender, messageId, focusText, target, invocation, routeConfirmation);
        if (iterationRecipe && typeof iterationRecipe === 'object') {
            assertExactIterationRoute(snapshot, iterationRecipe);
            const savedReferences = Array.isArray(iterationRecipe.references) ? cloneSnapshot(iterationRecipe.references) : [];
            const savedCanon = cloneSnapshot(iterationRecipe.canonSnapshot || {}) || {};
            snapshot = {
                ...snapshot,
                referenceAssets: {
                    ...(snapshot.referenceAssets || {}),
                    ...(savedCanon.assets || {}),
                    ...Object.fromEntries(Object.entries(materializeAppearanceAssets(extension_settings[extensionName].rp_library, extension_settings[extensionName].gallery || []).assets || {})
                        .filter(([assetId]) => savedReferences.some((reference) => String(reference?.assetId || '') === assetId))),
                },
                referenceCandidates: savedReferences,
                planInput: {
                    ...snapshot.planInput,
                    provider: { ...snapshot.planInput.provider, providerId: iterationRecipe.model?.providerId, modelId: iterationRecipe.model?.modelId, transport: iterationRecipe.model?.transportId },
                    resolved: { ...snapshot.planInput.resolved, ...cloneSnapshot(iterationRecipe.route), modelId: iterationRecipe.model?.modelId || snapshot.planInput.resolved.modelId },
                    prompt: { ...snapshot.planInput.prompt, sourceMessage: iterationRecipe.sourcePassage?.text || snapshot.planInput.prompt.sourceMessage, messageContent: iterationRecipe.effectivePrompt || snapshot.planInput.prompt.messageContent },
                    references: savedReferences,
                    canonSnapshot: { ...savedCanon, references: [] },
                    referencePlan: { selected: savedReferences, omitted: [] },
                    options: cloneSnapshot(iterationRecipe.options || {}),
                },
            };
            const missingSavedReference = savedReferences.find((reference) => reference?.assetId && !snapshot.referenceAssets?.[reference.assetId]);
            if (missingSavedReference) throw new Error(`Saved recipe reference ${missingSavedReference.id || missingSavedReference.assetId} is unavailable; generation is blocked.`);
        }
        notifyBrokenCanon(snapshot.planInput.canonSnapshot?.omissions, (message) => toastr.info(message, 'Context Image Generation'));
        const assets = await materializeSnapshotAssets(snapshot);
        const capturedBaseReferences = [
            ...(snapshot.planInput.references || []),
            ...(snapshot.planInput.canonSnapshot?.references || []),
        ].filter((reference, index, all) => all.findIndex((candidate) => candidate.id === reference.id) === index);
        const availableReferences = capturedBaseReferences.filter((reference) => !reference.assetId || assets[reference.assetId]);
        const missingReferenceOmissions = capturedBaseReferences.filter((reference) => reference.assetId && !assets[reference.assetId]).map((reference) => ({ id: reference.id, reason: 'asset-unavailable' }));
        const availableReferenceIds = availableReferences.map((reference) => reference.id);
        const plan = createGenerationPlan({ ...snapshot.planInput, references: availableReferences, availableReferenceIds, referenceOmissions: missingReferenceOmissions });
        const messages = await buildMessages(prompt, sender, messageId, focusText, invocation, plan, assets);
        const dispatchedPlan = createGenerationPlan({ ...snapshot.planInput, references: availableReferences, availableReferenceIds, referenceOmissions: missingReferenceOmissions, messages });
        const capturedIterationPlan = {
            planId: dispatchedPlan.id,
            revision: dispatchedPlan.resolved.routeEvidence?.revision || `${dispatchedPlan.resolved.providerId}:${dispatchedPlan.resolved.modelId}:${dispatchedPlan.resolved.transportId}`,
            routeResolved: true,
            routeConfirmationAccepted: dispatchedPlan.policy.routeConfirmationAccepted === true,
            capabilities: cloneSnapshot(dispatchedPlan.resolved.capabilities || {}),
            generationPlan: cloneSnapshot(dispatchedPlan),
        };
        const capturedIterationArtifact = {
            ...createIterationArtifact({
                artifactId: `artifact:${dispatchedPlan.id}`,
                sourcePassage: { text: dispatchedPlan.prompt.sourceMessage, messageId, userVisible: true },
                effectivePrompt: dispatchedPlan.prompt.messageContent || dispatchedPlan.prompt.sourceMessage,
                references: dispatchedPlan.references,
                model: dispatchedPlan.resolved,
                route: dispatchedPlan.resolved,
                options: dispatchedPlan.options,
                canonSnapshot: dispatchedPlan.canonSnapshot,
            }),
            generationPlan: capturedIterationPlan,
            target: cloneSnapshot(target),
            sender: sender || '',
        };
        const continuitySurface = cloneSnapshot({
            schema: 1,
            invocation,
            target,
            settings: {
                useAvatars: snapshot.settingsSnapshot.use_avatars === true,
                useDescriptions: snapshot.settingsSnapshot.include_descriptions === true,
            },
            identities: dispatchedPlan.identities,
            referencePlan: dispatchedPlan.referencePlan,
            activeOutfits: dispatchedPlan.activeOutfits,
            scene: createSceneArtifactMetadata(dispatchedPlan.scene),
        });
        // Retain only the redacted Advanced projection; prompt/context/assets
        // must not survive the dispatch lifecycle in extension state.
        lastGenerationPlanInspection = inspectGenerationPlan(dispatchedPlan);
        const connection = snapshot.customConnection ? {
            ...snapshot.customConnection,
            providerId: dispatchedPlan.resolved.providerId,
            confirmedRevision: snapshot.confirmedRevision,
        } : {
            id: dispatchedPlan.resolved.connectionId,
            providerId: dispatchedPlan.resolved.providerId,
            kind: snapshot.providerRoute?.credentialKey ? 'browser-api-key' : 'sillytavern-proxy',
            enabled: true,
        };
        const executeGeneration = async (signal) => {
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
                },
            });
            if (snapshot.customConnection) {
                const currentSettings = extension_settings[extensionName];
                const currentStore = getCustomConnectionStore(currentSettings);
                const promoted = promoteCustomConnectionEvidence({
                    connection: snapshot.customConnection,
                    evidence: currentStore.evidence[snapshot.customConnection.id],
                    decodedResult: generated,
                });
                const promotedModel = promoteCustomModelEvidence({
                    connection: snapshot.customConnection,
                    modelId: dispatchedPlan.resolved.modelId,
                    decodedResult: generated,
                });
                if (promoted?.state === 'verified'
                    && promoted.revision === connectionRevision(snapshot.customConnection)
                    && promotedModel?.revision === promoted.revision) {
                    currentSettings.custom_connections = migrateCustomConnections({
                        ...currentStore,
                        evidence: { ...currentStore.evidence, [snapshot.customConnection.id]: promoted },
                        modelEvidence: {
                            ...currentStore.modelEvidence,
                            [snapshot.customConnection.id]: {
                                ...currentStore.modelEvidence?.[snapshot.customConnection.id],
                                [dispatchedPlan.resolved.modelId]: promotedModel,
                            },
                        },
                    });
                    saveSettingsDebounced();
                    renderCustomConnectionEditor();
                }
            }
            const generatedWithContinuity = generated && typeof generated === 'object'
                ? { ...generated, __cigContinuitySnapshot: continuitySurface, __cigSceneMetadata: createSceneArtifactMetadata(dispatchedPlan.scene), __cigSceneState: cloneSnapshot(dispatchedPlan.scene?.state), __cigIterationArtifact: capturedIterationArtifact }
                : generated;
            if (typeof finalize !== 'function') return generatedWithContinuity;
            const persisted = await finalize(generatedWithContinuity, signal);
            return persisted?.persistence?.stale ? { ...persisted, stale: true } : persisted;
        };
        const execution = coordinatorOverride
            ? coordinatorOverride.enqueue(dispatchedPlan, executeGeneration)
            : executeGeneration(executionSignal || new AbortController().signal);
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
        const preview = $('<button type="button" class="cig_gallery_preview" aria-label="View generated image">')
            .attr('data-index', i)
            .attr('title', 'View generated image');
        $('<img>').attr({ src: galleryItemSrc(item), alt: item.prompt ? `Generated image: ${item.prompt}` : 'Generated image' }).appendTo(preview);
        preview.appendTo(thumb);
        const overlay = $('<div class="cig_gallery_item_overlay"></div>');
        $('<button type="button" class="cig_gallery_action cig_gallery_remember" title="Remember this look" aria-label="Remember this look">')
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

function continuityHostSources() {
    const context = getContext();
    const character = context.characters?.[context.characterId] || null;
    const group = context.groups?.find((entry) => String(entry.id) === String(context.groupId));
    const groupMembers = (group?.members || []).map((avatar) => context.characters?.find((entry) => entry.avatar === avatar) || { avatar, name: avatar });
    const records = [
        character,
        ...groupMembers,
        { avatar: user_avatar, name: name1 || 'User', description: power_user.persona_description || '', kind: 'user' },
    ].filter(Boolean);
    return records;
}

function identityHostRecord(identity) {
    const id = String(identity?.id || '');
    const hostKey = String(identity?.hostKey || id.replace(/^(?:character|user):/u, '')).trim();
    return continuityHostSources().find((record) => String(record.avatar || record.hostKey || '').trim() === hostKey)
        || (identity?.kind === 'user' ? { description: power_user.persona_description || '' } : null);
}

function continuityTruths(identities) {
    return buildAppearanceTruths({
        identities,
        sources: (identity) => {
            const record = identityHostRecord(identity);
            if (!record) return {};
            const avatar = record.avatar
                ? { path: identity.kind === 'character' ? `/characters/${encodeURIComponent(record.avatar)}` : getAvatarPath(record.avatar), characterId: identity.id }
                : null;
            return { avatar, description: record.description || '' };
        },
    });
}

function presentContinuityIdentities(message = null) {
    const choices = getAppearanceIdentityChoices();
    const context = getContext();
    const group = context.groups?.find((entry) => String(entry.id) === String(context.groupId));
    const groupKeys = new Set((group?.members || []).map((avatar) => String(avatar)));
    const isPresent = (identity) => identity.kind === 'character'
        && (!context.groupId || groupKeys.has(String(identity.hostKey)) || identity.hostKey === context.characters?.[context.characterId]?.avatar);
    const present = choices.filter((identity) => isPresent(identity) || (message?.is_user && identity.kind === 'user' && identity.hostKey === user_avatar));
    return present.filter((identity, index, all) => all.findIndex((item) => item.id === identity.id) === index);
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

function capturedChatTarget(identityId, expectedRevision, activeLookId, mediaTarget = null) {
    const context = getContext();
    const groupId = context.groupId || null;
    const requestBody = groupId
        ? { id: context.chatId }
        : { avatar_url: context.characters?.[context.characterId]?.avatar, file_name: context.chatId };
    return {
        chatId: context.chatId,
        groupId,
        identityId,
        expectedRevision,
        activeLookId,
        requestBody,
        chatData: cloneSnapshot(context.chat || []),
        metadata: cloneSnapshot(chat_metadata),
        ...(mediaTarget ? mediaTarget : {}),
        ...(mediaTarget && !mediaTarget.lookId && activeLookId ? { lookId: activeLookId } : {}),
    };
}

async function verifyPersistedChatOutfitState({ target, expectedState } = {}) {
    try {
        const endpoint = target?.groupId ? '/api/chats/group/get' : '/api/chats/get';
        const response = await fetch(endpoint, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(target?.requestBody || { chat_id: target?.chatId }) });
        if (!response.ok) return { status: 'indeterminate' };
        const payload = await response.json();
        const header = Array.isArray(payload) ? payload[0] : payload;
        const stored = header?.chat_metadata?.contextImageGeneration?.outfitState ?? header?.metadata?.contextImageGeneration?.outfitState;
        const stable = (value) => JSON.stringify(value || { schema: 1, identities: {} });
        return { status: stable(stored) === stable(expectedState) ? 'confirmed' : 'confirmed-absent', state: stored || null };
    } catch (error) {
        return { status: 'indeterminate', error };
    }
}

function normalizeScenePendingStore(value) {
    const pending = value?.pending;
    return pending && typeof pending === 'object' && !Array.isArray(pending)
        ? { schema: 1, pending: { ...pending } }
        : { schema: 1, pending: {} };
}

function queueScenePending(value, entry) {
    const store = normalizeScenePendingStore(value);
    const key = sceneStatePendingKey(entry);
    if (key) store.pending[key] = cloneSnapshot(entry);
    return store;
}

function removeScenePending(value, entry) {
    const store = normalizeScenePendingStore(value);
    delete store.pending[sceneStatePendingKey(entry)];
    return store;
}

function scheduleSceneStatePendingRetry() {
    setTimeout(() => { void resumePendingSceneState(); }, 1500);
}

async function verifyPersistedSceneState(entry) {
    try {
        const target = entry?.target || {};
        const groupId = target.groupId || getContext().groupId || null;
        const endpoint = groupId ? '/api/chats/group/get' : '/api/chats/get';
        const requestBody = target.requestBody || (groupId ? { id: target.chatId } : { chat_id: target.chatId });
        const response = await fetch(endpoint, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(requestBody) });
        if (!response.ok) return { status: 'indeterminate' };
        const payload = await response.json();
        const header = Array.isArray(payload) ? payload[0] : payload;
        const stored = header?.chat_metadata?.[SCENE_STATE_METADATA_KEY] ?? header?.metadata?.[SCENE_STATE_METADATA_KEY];
        const expected = entry.state || null;
        const stable = (value) => JSON.stringify(value ?? null);
        return { status: stable(stored) === stable(expected) ? 'confirmed' : 'confirmed-absent', state: stored || null };
    } catch (error) {
        return { status: 'indeterminate', error };
    }
}

async function persistSceneStateForAttachment(result, target, epoch) {
    const sceneState = result?.__cigSceneState;
    if (!sceneState || !target?.chatId || !Number.isInteger(target.messageId)) return { saved: true, status: 'not-applicable' };
    const captured = { chatId: target.chatId, epoch };
    const pending = createSceneStatePending({
        chatId: target.chatId,
        epoch,
        state: sceneState,
        target: { ...target, groupId: getContext().groupId || null },
    });
    const settings = extension_settings[extensionName];
    const outcome = await persistAcceptedSceneState({
        pending,
        isCurrent: (entry) => chatCaptureIsCurrent({ chatId: entry.chatId, epoch: entry.epoch })
            && validateMessageTarget({ target: entry.target, currentChatId: getContext().chatId, currentChat: getContext().chat }).safe,
        getState: () => chat_metadata[SCENE_STATE_METADATA_KEY],
        setState: (state) => { chat_metadata[SCENE_STATE_METADATA_KEY] = cloneSnapshot(state); },
        savePending: async (entry) => {
            settings.scene_state_pending = queueScenePending(settings.scene_state_pending, entry);
            await saveSettings();
        },
        saveChat: async (result) => {
            await saveChatConditional();
            return { saved: true };
        },
        readback: verifyPersistedSceneState,
        removePending: async (entry) => {
            settings.scene_state_pending = removeScenePending(settings.scene_state_pending, entry);
            await saveSettings();
        },
        scheduleRetry: scheduleSceneStatePendingRetry,
    });
    if (outcome.status === 'stale') return { saved: false, reason: 'chat-changed' };
    return { saved: true, sceneStateStatus: outcome.status, captured };
}

async function resumePendingSceneState() {
    const settings = extension_settings[extensionName];
    const store = normalizeScenePendingStore(settings.scene_state_pending);
    const currentChatId = getContext().chatId;
    const entries = Object.values(store.pending).filter((entry) => String(entry?.chatId) === String(currentChatId));
    if (!entries.length) return { status: 'nothing-to-do' };
    for (const entry of entries) {
        const outcome = await persistAcceptedSceneState({
            pending: entry,
            isCurrent: (value) => chatCaptureIsCurrent({ chatId: value.chatId, epoch: value.epoch })
                && validateMessageTarget({ target: value.target, currentChatId: getContext().chatId, currentChat: getContext().chat }).safe,
            getState: () => chat_metadata[SCENE_STATE_METADATA_KEY],
            setState: (state) => { chat_metadata[SCENE_STATE_METADATA_KEY] = cloneSnapshot(state); },
            savePending: async (value) => {
                settings.scene_state_pending = queueScenePending(settings.scene_state_pending, value);
                await saveSettings();
            },
            saveChat: async () => { await saveChatConditional(); return { saved: true }; },
            readback: verifyPersistedSceneState,
            removePending: async (value) => {
                settings.scene_state_pending = removeScenePending(settings.scene_state_pending, value);
                await saveSettings();
            },
            scheduleRetry: scheduleSceneStatePendingRetry,
        });
        if (outcome.status === 'confirmed') {
            settings.scene_state_pending = removeScenePending(settings.scene_state_pending, entry);
        }
    }
    await saveSettings();
    return { status: 'processed', pending: settings.scene_state_pending };
}

async function verifyPersistedOutfitPending(entry) {
    try {
        const response = await fetch('/api/settings/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
        if (!response.ok) return { status: 'indeterminate' };
        const payload = await response.json();
        const raw = typeof payload?.settings === 'string' ? JSON.parse(payload.settings) : payload;
        const stored = raw?.extension_settings?.[extensionName]?.outfit_pending?.pending?.[outfitPendingKey(entry)] || raw?.settings?.extension_settings?.[extensionName]?.outfit_pending?.pending?.[outfitPendingKey(entry)];
        const stable = (value) => JSON.stringify(value || null);
        return { status: stable(stored) === stable(entry) ? 'confirmed' : 'confirmed-absent', entry: stored || null };
    } catch (error) { return { status: 'indeterminate', error }; }
}

async function saveChatForCapturedTarget(captured, target) {
    if (!chatCaptureIsCurrent(captured)) return { saved: false, reason: 'chat-changed' };
    const chatData = cloneSnapshot(getContext().chat || target?.chatData || []);
    const metadata = cloneSnapshot(chat_metadata || target?.metadata || {});
    if (target?.groupId) await saveGroupChat(target.groupId, true);
    else await saveChat({ chatName: target?.requestBody?.file_name, withMetadata: metadata, chatData });
    return chatCaptureIsCurrent(captured) ? { saved: true, target } : { saved: false, reason: 'chat-changed' };
}

function outfitPendingKey(entry) {
    return `${String(entry?.chatId || '')}::${String(entry?.identityId || '')}`;
}

function scheduleOutfitPendingRetry() {
    setTimeout(() => { void resumePendingOutfitState(); }, 1500);
}

async function persistChatOutfitState(identityId, nextState) {
    const context = getContext();
    const captured = { chatId: context.chatId, epoch: chatLifecycleEpoch.capture() };
    const currentCanon = migrateChatCanon(chat_metadata[CHAT_CANON_KEY]);
    const previous = { canon: currentCanon };
    const outfitState = { ...migrateChatOutfitState(nextState), revision: `outfit:${crypto.randomUUID()}` };
    const candidate = { ...currentCanon, outfitState, revision: `chat-canon:${crypto.randomUUID()}` };
    const target = capturedChatTarget(identityId, candidate.revision, getChatOutfitBinding(outfitState, identityId)?.activeOutfitId || null);
    const pending = { chatId: captured.chatId, groupId: target.groupId, identityId, canonRevision: candidate.revision, revision: outfitState.revision, state: outfitState };
    const settings = extension_settings[extensionName];
    settings.outfit_pending = queueOutfitPending(settings.outfit_pending, pending);
    try {
        await saveSettings();
        const pendingVerification = await verifyPersistedOutfitPending(pending);
        if (pendingVerification.status !== 'confirmed') {
            scheduleOutfitPendingRetry();
            return { status: 'indeterminate', verification: pendingVerification };
        }
    } catch (error) {
        scheduleOutfitPendingRetry();
        return { status: 'indeterminate', error };
    }
    const result = await persistTargetedOutfitMutation({
        captured,
        isCurrent: chatCaptureIsCurrent,
        getState: () => ({ canon: chat_metadata[CHAT_CANON_KEY] }),
        setState: (value) => { chat_metadata[CHAT_CANON_KEY] = value.canon; },
        nextState: { canon: candidate },
        save: (capturedTarget) => saveChatForCapturedTarget(capturedTarget, target),
        verify: () => verifyPersistedChatOutfitState({ target, expectedState: outfitState }),
    });
    if (result.status === 'confirmed') {
        settings.outfit_pending = removeOutfitPending(settings.outfit_pending, pending);
        await saveSettings();
    } else if (result.status === 'confirmed-absent' && chatCaptureIsCurrent(captured) && chat_metadata[CHAT_CANON_KEY]?.outfitState?.revision === outfitState.revision) {
        chat_metadata[CHAT_CANON_KEY] = previous.canon;
        scheduleOutfitPendingRetry();
    } else if (result.status === 'indeterminate') {
        scheduleOutfitPendingRetry();
    }
    renderContinuityShelves();
    return result;
}

async function resumePendingOutfitState() {
    const settings = extension_settings[extensionName];
    const currentChatId = getContext().chatId;
    const pendingState = createOutfitPendingState(settings.outfit_pending);
    if (!Object.keys(splitOutfitPendingByChat(pendingState, currentChatId).active).length) return { status: 'nothing-to-do' };
    const resumed = await resumeOutfitPending(pendingState, async (entry) => {
        const captured = { chatId: currentChatId, epoch: chatLifecycleEpoch.capture() };
        const target = capturedChatTarget(entry.identityId, entry.canonRevision, getChatOutfitBinding(entry.state, entry.identityId)?.activeOutfitId || null);
        const candidate = { ...migrateChatCanon(chat_metadata[CHAT_CANON_KEY]), outfitState: migrateChatOutfitState(entry.state), revision: entry.canonRevision };
        return persistTargetedOutfitMutation({
            captured,
            isCurrent: (value) => chatCaptureIsCurrent(value) && String(value.chatId) === String(entry.chatId),
            getState: () => ({ canon: chat_metadata[CHAT_CANON_KEY] }),
            setState: (value) => { chat_metadata[CHAT_CANON_KEY] = value.canon; },
            nextState: { canon: candidate },
            save: (capturedTarget) => saveChatForCapturedTarget(capturedTarget, target),
            verify: () => verifyPersistedChatOutfitState({ target, expectedState: entry.state }),
        });
    }, { chatId: currentChatId, isCurrent: (entry) => chatCaptureIsCurrent({ chatId: entry.chatId, epoch: chatLifecycleEpoch.capture() }) });
    if (resumed.state !== pendingState) {
        settings.outfit_pending = resumed.state;
        await saveSettings();
    }
    renderContinuityShelves();
    return resumed;
}

async function activateChatOutfit(identityId, requestedOutfitId) {
    const settings = extension_settings[extensionName];
    const catalog = migrateOutfitCatalog(settings.rp_outfits);
    const current = migrateChatOutfitState(chat_metadata[CHAT_CANON_KEY]?.outfitState);
    const binding = getChatOutfitBinding(current, identityId);
    let confirmed = false;
    if (binding?.isLocked && binding.activeOutfitId !== requestedOutfitId) {
        confirmed = await confirmDestructiveAction('Replace the locked outfit for this chat?', 'Activate outfit');
        if (!confirmed) return { status: 'cancelled' };
    }
    const selected = selectChatOutfit(current, identityId, requestedOutfitId, { catalog, confirmed, explicitChange: confirmed });
    if (selected.status !== 'selected') {
        toastr.info(selected.status === 'confirmation-required' ? 'Unlock the outfit or confirm replacement first.' : 'Outfit unavailable.', 'Context Image Generation');
        return selected;
    }
    const result = await persistChatOutfitState(identityId, selected.state);
    if (result.status === 'confirmed') toastr.success(`Using ${selected.outfit.name} for ${identityId}.`, 'Context Image Generation');
    else toastr.info('Outfit selection is pending chat persistence.', 'Context Image Generation');
    return result;
}

async function toggleChatOutfitLock(identityId) {
    const current = migrateChatOutfitState(chat_metadata[CHAT_CANON_KEY]?.outfitState);
    const binding = getChatOutfitBinding(current, identityId);
    if (!binding) return { status: 'outfit-not-selected' };
    const result = await persistChatOutfitState(identityId, setChatOutfitLock(current, identityId, !binding.isLocked));
    if (result.status !== 'confirmed') toastr.info('Outfit lock change is pending chat persistence.', 'Context Image Generation');
    return result;
}

async function createChatOutfit(identityId, name, description) {
    const settings = extension_settings[extensionName];
    const created = createOutfit({ id: `outfit:${identityId}:${crypto.randomUUID()}`, identityId, name, description });
    if (created.status !== 'created') {
        toastr.warning('Enter a name and outfit details first.', 'Context Image Generation');
        return created;
    }
    settings.rp_outfits = { ...migrateOutfitCatalog(settings.rp_outfits), outfits: [...migrateOutfitCatalog(settings.rp_outfits).outfits, created.outfit] };
    await saveSettings();
    renderContinuityShelves();
    return created;
}

function chatCaptureIsCurrent(captured) {
    return getContext().chatId === captured.chatId && chatLifecycleEpoch.isCurrent(captured.epoch);
}

function currentVisibleCanonMedia(target) {
    const message = getContext().chat?.[Number(target?.messageId)];
    const media = message?.extra?.media;
    if (!Array.isArray(media)) return null;
    return media.find((entry) => buildVisibleCanonMediaArtifactId({ messageId: target.messageId, media: entry }) === target.artifactId && entry.url === target.mediaUrl) || null;
}

function visibleCanonCaptureIsCurrent(captured) {
    if (!chatCaptureIsCurrent(captured)) return false;
    return !captured.mediaTarget || Boolean(currentVisibleCanonMedia(captured.mediaTarget));
}

function visibleCanonMediaLinkSnapshot(target) {
    return currentVisibleCanonMedia(target)?.cig_visible_canon || null;
}

function setVisibleCanonMediaLink(target, link) {
    const message = getContext().chat?.[Number(target?.messageId)];
    const media = message?.extra?.media;
    if (!Array.isArray(media)) return false;
    const index = media.findIndex((entry) => buildVisibleCanonMediaArtifactId({ messageId: target.messageId, media: entry }) === target.artifactId && entry.url === target.mediaUrl);
    if (index < 0) return false;
    if (link) media[index] = linkVisibleCanonMediaArtifact(media[index], { messageId: target.messageId, identityId: link.identityId, lookId: link.lookId });
    else {
        const next = { ...media[index] };
        delete next.cig_visible_canon;
        delete next.cig_artifact_id;
        media[index] = next;
    }
    return true;
}

function visibleCanonPendingLink(captured, identityId, lookId, candidate, expectedFingerprint) {
    const target = captured?.mediaTarget;
    return target && {
        ...target,
        chatId: captured.chatId,
        identityId,
        lookId,
        epoch: captured.epoch,
        expectedFingerprint,
        candidate,
    };
}

function saveVisibleCanonChat() {
    return saveChatConditional();
}

function scheduleVisibleCanonPendingSettingsRetry(link) {
    setTimeout(async () => {
        const settings = extension_settings[extensionName];
        settings.visible_canon_pending = queueVisibleCanonPending(createVisibleCanonPendingState({ pending: settings.visible_canon_pending }), link).pending;
        try { await saveSettings(); }
        catch { scheduleVisibleCanonPendingSettingsRetry(link); }
    }, 1500);
}

function scheduleChatCanonReconciliation({ operationId, captured, target, candidate, identityId, expectedCurrentFingerprint, mediaTarget = null }) {
    const retry = () => {
        void reconcilePendingOperation(operationId, async () => {
            if (mediaTarget && visibleCanonCaptureIsCurrent(captured)) {
                chat_metadata[CHAT_CANON_KEY] = candidate;
                setVisibleCanonMediaLink(mediaTarget, { identityId, lookId: mediaTarget.lookId });
                await saveVisibleCanonChat(mediaTarget);
            }
            const bindingVerification = await verifyPersistedChatBinding({ target, fetchImpl: fetch, getHeaders: getRequestHeaders });
            const mediaVerification = mediaTarget
                ? await verifyPersistedChatMediaLink({ target: { ...target, ...mediaTarget }, fetchImpl: fetch, getHeaders: getRequestHeaders })
                : { status: 'confirmed' };
            const verification = bindingVerification.status === 'confirmed' && mediaVerification.status === 'confirmed'
                ? { status: 'confirmed', bindingVerification, mediaVerification }
                : { status: bindingVerification.status === 'indeterminate' || mediaVerification.status === 'indeterminate' ? 'indeterminate' : 'confirmed-absent', bindingVerification, mediaVerification };
            if (verification.status === 'confirmed' && visibleCanonCaptureIsCurrent(captured) && chatCanonRevisionFingerprint(chat_metadata[CHAT_CANON_KEY], identityId) === expectedCurrentFingerprint) {
                chat_metadata[CHAT_CANON_KEY] = candidate;
                if (mediaTarget) setVisibleCanonMediaLink(mediaTarget, { identityId, lookId: mediaTarget.lookId });
                renderAppearanceList();
                refreshVisibleCanonControls();
            }
            return verification;
        }).then((result) => {
            if (result?.status !== 'confirmed') setTimeout(retry, 1500);
        });
    };
    setTimeout(retry, 1500);
}

async function resumePendingAppearanceOperations() {
    const settings = extension_settings[extensionName];
    const library = migrateAppearanceLibrary(settings?.rp_library);
    if (!Object.keys(library.operations || {}).length) return { status: 'nothing-to-do', library };
    if (Object.values(library.operations || {}).some((operation) => ['pending-migration', 'pending-clear'].includes(operation?.status))) {
        return runClearGalleryPreservingLooks({ gallery: settings.gallery || [], io: appearanceMigrationIo(), withinExclusive: true });
    }
    const result = await reconcileAppearanceOperations({
        library,
        verifyRevision: (revision) => verifyPersistedExtensionLibrary({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
        saveLibrary: async (candidate) => { settings.rp_library = candidate; await saveSettings(); },
        verifySaved: (revision) => verifyPersistedExtensionLibrary({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
        deleteFile: (url) => deleteAppearanceAssetFile(url, fetch, getRequestHeaders),
    });
    settings.rp_library = result.library;
    renderAppearanceList();
    return result;
}

function appearanceMigrationIo() {
    const settings = extension_settings[extensionName];
    return {
        runExclusive: (operation) => enqueueLibraryMutation(operation),
        readLibrary: async () => readPersistedExtensionLibrary({ fetchImpl: fetch, getHeaders: getRequestHeaders }),
        saveLibrary: async (library) => { settings.rp_library = library; await saveSettings(); },
        verifyLibrary: (revision) => verifyPersistedExtensionLibrary({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
        readDataUrl: async (item) => {
            if (item.imageData) return `data:${item.mimeType || 'image/png'};base64,${item.imageData}`;
            const response = await fetch(item.url, { method: 'GET', headers: getRequestHeaders() });
            if (!response.ok) throw new Error('The legacy Gallery image could not be read.');
            return getBase64Async(await response.blob());
        },
        saveBase64: (data, folder, filename, extension) => saveBase64AsFile(data, folder, filename, extension),
        targetExists: async (url) => {
            try {
                const response = await fetch(url, { method: 'GET', headers: getRequestHeaders(), cache: 'no-store', redirect: 'error' });
                if (response.ok) return { status: 'confirmed-present' };
                if (response.status === 404) return { status: 'confirmed-absent' };
                return { status: 'indeterminate' };
            } catch (error) { return { status: 'indeterminate', error }; }
        },
        saveClearedState: async ({ library, gallery }) => { settings.rp_library = library; settings.gallery = gallery; await saveSettings(); },
        verifyClearedState: (revision) => verifyPersistedGalleryClear({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
        setLocalState: ({ library, gallery }) => { settings.rp_library = library; settings.gallery = gallery; renderGallery(); renderAppearanceList(); },
        uuid: () => crypto.randomUUID(),
    };
}

async function persistOrphanCleanupRetry(libraryValue, url, { alreadyQueued = true, operationId = `orphan-cleanup:${crypto.randomUUID()}` } = {}) {
    const result = await persistOrphanCleanupRecovery({
        library: libraryValue,
        url,
        operationId,
        readLatest: async () => {
            const latest = await readPersistedExtensionLibrary({ fetchImpl: fetch, getHeaders: getRequestHeaders });
            return latest.status === 'confirmed' ? latest.library : libraryValue;
        },
        saveLibrary: async (candidate) => { extension_settings[extensionName].rp_library = candidate; await saveSettings(); },
        verifySaved: (revision) => verifyPersistedExtensionLibrary({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
        alreadyQueued,
    });
    extension_settings[extensionName].rp_library = result.library;
    if (result.status === 'tracked') {
        scheduleLibraryPromotionReconciliation(operationId, result.library.revision);
    } else {
        scheduleOrphanCleanupPersistenceRetry(result.library, url, operationId);
    }
    return result;
}

function scheduleOrphanCleanupPersistenceRetry(library, url, operationId) {
    setTimeout(() => {
        void persistOrphanCleanupRetry(library, url, { alreadyQueued: false, operationId });
    }, 1500);
}

function scheduleLibraryPromotionReconciliation(operationId, _expectedRevision) {
    setTimeout(() => {
        void reconcilePendingOperation(operationId, async () => {
            return resumePendingAppearanceOperations();
        });
    }, 1500);
}

async function resumePendingVisibleCanonLinks() {
    const canon = migrateChatCanon(chat_metadata[CHAT_CANON_KEY]);
    const settings = extension_settings[extensionName];
    const currentChatId = getContext().chatId;
    const globalPending = createVisibleCanonPendingState({ pending: settings.visible_canon_pending }).pending;
    const globalSplit = splitVisibleCanonPendingByChat({ pending: globalPending }, currentChatId);
    const chatSplit = splitVisibleCanonPendingByChat({ pending: canon.visibleCanonPending }, currentChatId);
    const pendingState = createVisibleCanonPendingState({ pending: { ...globalSplit.active, ...chatSplit.active } });
    if (Object.keys(pendingState.pending).length === 0) return { status: 'nothing-to-do' };
    const pendingLinks = Object.values(pendingState.pending);
    const isCurrent = (link) => getContext().chatId === currentChatId && Boolean(currentVisibleCanonMedia(link));
    let replayedCanon = null;
    let replayIncomplete = false;
    const resumed = await resumeVisibleCanonPending(pendingState, async (link) => {
        if (!link.candidate?.revision || !link.expectedFingerprint) return { status: 'confirmed' };
        if (!currentVisibleCanonMedia(link)) return { status: 'stale' };
        const currentCanon = migrateChatCanon(chat_metadata[CHAT_CANON_KEY]);
        const currentFingerprint = chatCanonRevisionFingerprint(currentCanon, link.identityId);
        if (currentFingerprint !== link.expectedFingerprint && currentCanon.revision !== link.candidate.revision) return { status: 'confirmed' };
        const replayCandidate = { ...link.candidate, visibleCanonPending: pendingState.pending };
        chat_metadata[CHAT_CANON_KEY] = replayCandidate;
        const result = await reconcileVisibleCanonPendingLink(link, {
            isCurrent,
            save: async () => {
                setVisibleCanonMediaLink(link, { identityId: link.identityId, lookId: link.lookId });
                await saveVisibleCanonChat();
            },
            verify: async () => {
                const target = capturedChatTarget(link.identityId, link.candidate.revision, link.lookId, link);
                const binding = await verifyPersistedChatBinding({ target, fetchImpl: fetch, getHeaders: getRequestHeaders });
                const media = await verifyPersistedChatMediaLink({ target, fetchImpl: fetch, getHeaders: getRequestHeaders });
                return binding.status === 'confirmed' && media.status === 'confirmed'
                    ? { status: 'confirmed', binding, media }
                    : { status: binding.status === 'indeterminate' || media.status === 'indeterminate' ? 'indeterminate' : 'confirmed-absent', binding, media };
            },
        });
        if (result?.status === 'confirmed') replayedCanon = replayCandidate;
        else replayIncomplete = true;
        return result;
    }, { isCurrent });
    const activePending = resumed.state.pending;
    const nextGlobalPending = { ...globalSplit.foreign, ...chatSplit.foreign, ...activePending };
    const pendingChanged = JSON.stringify(pendingState.pending) !== JSON.stringify(activePending);
    const chatCleanupNeeded = !replayIncomplete && (Boolean(replayedCanon) || (Object.keys(chatSplit.active).length > 0 && pendingChanged));
    const settingsChanged = JSON.stringify(globalPending) !== JSON.stringify(nextGlobalPending);
    const lifecycleCurrent = pendingLinks.every(isCurrent);
    if (!lifecycleCurrent) return resumed;
    if (chatCleanupNeeded) {
        chat_metadata[CHAT_CANON_KEY] = finalizeVisibleCanonPendingReplay({
            currentCanon: migrateChatCanon(chat_metadata[CHAT_CANON_KEY]),
            replayedCanon,
            activePending,
        });
        await saveVisibleCanonChat();
    }
    if (settingsChanged) {
        settings.visible_canon_pending = nextGlobalPending;
        await saveSettings();
    }
    return resumed;
}

async function persistChatCanonChange({ captured, candidate, identityId, activeLookId, mediaTarget = null }) {
    const target = capturedChatTarget(identityId, candidate.revision, activeLookId, mediaTarget);
    const operationId = `chat-canon:${crypto.randomUUID()}`;
    const expectedCurrentFingerprint = chatCanonRevisionFingerprint(chat_metadata[CHAT_CANON_KEY], identityId);
    const linkedLookId = mediaTarget?.lookId || activeLookId;
    const pendingLink = visibleCanonPendingLink(captured, identityId, linkedLookId, candidate, expectedCurrentFingerprint);
    const candidateWithPending = pendingLink
        ? { ...candidate, visibleCanonPending: queueVisibleCanonPending(createVisibleCanonPendingState({ pending: candidate.visibleCanonPending }), pendingLink).pending }
        : candidate;
    if (pendingLink) {
        const settings = extension_settings[extensionName];
        settings.visible_canon_pending = queueVisibleCanonPending(createVisibleCanonPendingState({ pending: settings.visible_canon_pending }), pendingLink).pending;
        try {
            await saveSettings();
            const pendingVerification = await verifyPersistedVisibleCanonPending({ pending: pendingLink, fetchImpl: fetch, getHeaders: getRequestHeaders });
            if (pendingVerification.status !== 'confirmed') {
                scheduleVisibleCanonPendingSettingsRetry(pendingLink);
                return { status: 'indeterminate', message: 'Pending canon recovery was not confirmed; chat save deferred.' };
            }
        } catch {
            scheduleVisibleCanonPendingSettingsRetry(pendingLink);
            return { status: 'indeterminate', message: 'Pending canon recovery could not be recorded; chat save deferred.' };
        }
    }
    const previousState = () => ({ canon: chat_metadata[CHAT_CANON_KEY], mediaLink: mediaTarget ? visibleCanonMediaLinkSnapshot(mediaTarget) : null });
    return persistVerifiedChatMutation({
        captured,
        isCurrent: visibleCanonCaptureIsCurrent,
        getState: previousState,
        setState: (value) => {
            chat_metadata[CHAT_CANON_KEY] = value.canon;
            if (mediaTarget) setVisibleCanonMediaLink(mediaTarget, value.mediaLink);
        },
        nextState: { canon: candidateWithPending, mediaLink: pendingLink ? { artifactId: pendingLink.artifactId, identityId, lookId: linkedLookId } : previousState().mediaLink },
        getRevision: (value) => value?.canon?.revision,
        saveMetadata: () => saveVisibleCanonChat(mediaTarget),
        verify: async () => {
            const bindingVerification = await verifyPersistedChatBinding({ target, fetchImpl: fetch, getHeaders: getRequestHeaders });
            const mediaVerification = mediaTarget
                ? await verifyPersistedChatMediaLink({ target, fetchImpl: fetch, getHeaders: getRequestHeaders })
                : { status: 'confirmed' };
            if (bindingVerification.status === 'confirmed' && mediaVerification.status === 'confirmed') return { status: 'confirmed', bindingVerification, mediaVerification };
            return { status: bindingVerification.status === 'indeterminate' || mediaVerification.status === 'indeterminate' ? 'indeterminate' : 'confirmed-absent', bindingVerification, mediaVerification };
        },
        scheduleReconcile: () => scheduleChatCanonReconciliation({ operationId, captured, target, candidate: candidateWithPending, identityId, expectedCurrentFingerprint, mediaTarget: pendingLink || mediaTarget }),
        preservePendingState: Boolean(pendingLink),
    });
}

function appearanceFeatureController() {
    return createAppearanceFeatureController({
        isCurrent: chatCaptureIsCurrent,
        getFingerprint: (identityId) => chatCanonRevisionFingerprint(chat_metadata[CHAT_CANON_KEY], identityId),
        persistChat: ({ captured, candidate, identityId, activeLookId, mediaTarget }) => persistChatCanonChange({ captured, candidate, identityId, activeLookId, mediaTarget }),
        promoteLook: async ({ promoted }) => promoted,
        persistLibrary: async () => ({ status: 'confirmed' }),
    });
}

async function persistAppearanceLibraryMutation(mutate) {
    const settings = extension_settings[extensionName];
    const result = await runRebasedLibraryMutation({
        readLatest: async () => {
            const latest = await readPersistedExtensionLibrary({ fetchImpl: fetch, getHeaders: getRequestHeaders });
            return latest.status === 'confirmed' ? latest.library : settings.rp_library;
        },
        mutate: async (latest) => {
            const candidate = migrateAppearanceLibrary(await mutate(latest));
            candidate.revision = `appearance:${crypto.randomUUID()}`;
            return candidate;
        },
        saveLibrary: async (candidate) => { settings.rp_library = candidate; await saveSettings(); },
        verifySaved: (candidate) => verifyPersistedExtensionLibrary({ expectedRevision: candidate.revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
    });
    settings.rp_library = result.status === 'confirmed' ? result.library : result.candidate;
    return result;
}

function scheduleVisibleCanonGalleryLinkRetry({ artifactId, identityId, lookId }) {
    setTimeout(() => {
        void persistVisibleCanonGalleryLink({ artifactId, identityId, lookId, retry: false, notify: false });
    }, 1500);
}

async function persistVisibleCanonGalleryLink({ artifactId, identityId, lookId, retry = true, notify = true } = {}) {
    const settings = extension_settings[extensionName];
    const linkedIndex = (settings.gallery || []).findIndex((entry) => galleryArtifactKey(entry) === artifactId);
    if (linkedIndex < 0) return { status: 'confirmed-absent' };
    settings.gallery[linkedIndex] = linkVisibleCanonGalleryArtifact(settings.gallery[linkedIndex], { identityId, lookId });
    try {
        await saveSettings();
        const verification = await verifyPersistedGalleryArtifact({ artifactId, expectedIdentityId: identityId, expectedLookId: lookId, fetchImpl: fetch, getHeaders: getRequestHeaders });
        if (verification.status !== 'confirmed' && retry) scheduleVisibleCanonGalleryLinkRetry({ artifactId, identityId, lookId });
        if (verification.status !== 'confirmed' && notify) toastr.info('The selected identity link is pending persistence and will be retried shortly.', 'Context Image Generation');
        return verification;
    } catch (error) {
        if (retry) scheduleVisibleCanonGalleryLinkRetry({ artifactId, identityId, lookId });
        if (notify) {
            toastr.info('The selected identity link is pending persistence and will be retried shortly.', 'Context Image Generation');
            console.warn(`[${extensionName}] Gallery identity link verification pending`, error);
        }
        return { status: 'indeterminate', error };
    }
}

async function rememberGalleryAppearance(index, mediaTarget = null) {
    const settings = extension_settings[extensionName];
    const item = settings.gallery?.[index];
    if (!item) return;
    if (!mediaTarget && item.messageId !== null && item.messageId !== undefined) mediaTarget = visibleCanonMediaTarget(item.messageId, item.url);
    const captured = { chatId: getContext().chatId, epoch: chatLifecycleEpoch.capture(), ...(mediaTarget ? { mediaTarget } : {}) };
    const selection = await chooseAppearanceIdentity(item.prompt || 'Saved appearance');
    if (!selection) return;
    const { identity, label } = selection;
    if (getContext().chatId !== captured.chatId || !chatLifecycleEpoch.isCurrent(captured.epoch)) {
        toastr.info('The chat changed before the look was saved. Please try again in the intended chat.', 'Context Image Generation');
        return;
    }

    const activation = await runRememberAppearance({
        captured, identity, label, item,
        io: {
            isCurrent: visibleCanonCaptureIsCurrent,
            runExclusive: (operation) => enqueueLibraryMutation(operation),
            readLibrary: async () => {
                const authoritative = await readPersistedExtensionLibrary({ fetchImpl: fetch, getHeaders: getRequestHeaders });
                if (authoritative.status === 'confirmed') settings.rp_library = migrateAppearanceLibrary(authoritative.library);
                return authoritative;
            },
            readDataUrl: async (galleryItem) => {
                if (galleryItem.imageData) return `data:${galleryItem.mimeType || 'image/png'};base64,${galleryItem.imageData}`;
                const response = await fetch(galleryItem.url);
                if (!response.ok) throw new Error('The Gallery image could not be read.');
                if (!chatCaptureIsCurrent(captured)) throw new Error('The chat changed before the Gallery image could be promoted.');
                const blob = await response.blob();
                if (!chatCaptureIsCurrent(captured)) throw new Error('The chat changed before the Gallery image could be promoted.');
                return getBase64Async(blob);
            },
            saveBase64: (data, folder, filename, extension) => saveBase64AsFile(data, folder, filename, extension),
            saveLibrary: async (library) => { settings.rp_library = library; await saveSettings(); },
            verifyLibrary: (revision) => verifyPersistedExtensionLibrary({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
            deleteAppearanceFile: (url) => deleteAppearanceAssetFile(url, fetch, getRequestHeaders),
            persistOrphanCleanup: ({ library, url }) => persistOrphanCleanupRetry(library, url),
            setLocalLibrary: (library) => { settings.rp_library = library; },
            scheduleLibraryReconciliation: ({ operationId, revision }) => scheduleLibraryPromotionReconciliation(operationId, revision),
            getChatCanon: () => chat_metadata[CHAT_CANON_KEY],
            persistChat: ({ candidate, activeLookId }) => persistChatCanonChange({ captured, candidate, identityId: identity.id, activeLookId, mediaTarget: captured.mediaTarget }),
            uuid: () => crypto.randomUUID(),
            now: () => Date.now(),
        },
    });
    if (!mediaTarget && activation.promoted?.look?.id && ['confirmed', 'alternate'].includes(activation.status)) {
        const artifactId = galleryArtifactKey(item);
        await persistVisibleCanonGalleryLink({ artifactId, identityId: identity.id, lookId: activation.promoted.look.id });
    }
    renderAppearanceList();
    refreshVisibleCanonControls();
    if (activation.status === 'confirmed' || activation.status === 'alternate') toastr.success(activation.message, 'Context Image Generation');
    else if (activation.status === 'confirmed-absent') toastr.warning(activation.message, 'Context Image Generation');
    else toastr.info(activation.message, 'Context Image Generation');
    return { activation, identityId: identity.id, lookId: activation.promoted?.look?.id || null };
}

function renderAppearanceList(lifecycleView = null) {
    const settings = extension_settings[extensionName] || {};
    const list = $('#cig_appearance_list').empty();
    const empty = $('#cig_appearance_empty');
    const library = migrateAppearanceLibrary(settings.rp_library);
    const materialized = materializeAppearanceAssets(library, settings.gallery || []);
    const available = new Set(Object.keys(materialized.assets));
    const currentChatId = lifecycleView?.chatId ?? getContext().chatId;
    const chatState = lifecycleView && Object.hasOwn(lifecycleView, 'chatState')
        ? lifecycleView.chatState
        : chat_metadata[CHAT_CANON_KEY];
    const entries = listVisibleAppearanceEntries(library, { currentChatId });
    const canon = migrateChatCanon(chatState);
    empty.toggle(entries.length === 0);
    for (const { identity, look } of entries) {
        const binding = getChatBinding(canon, identity.id);
        const effectiveLookId = binding?.activeLookId || identity.activeLookId;
        const active = effectiveLookId === look.id;
        const actionState = projectAppearanceLookActionState(library, look.id, available.has(look.assetId));
        const isAvailable = actionState.available;
        const row = $('<div class="cig_appearance_item" role="listitem"></div>')
            .attr('data-identity-id', identity.id)
            .attr('data-look-id', look.id);
        const text = $('<div class="cig_appearance_item_text"></div>');
        $('<span>').text(`${identity.label}: ${look.label}`).appendTo(text);
        if (active) {
            $('<small class="cig_appearance_active">Active in this chat</small>').appendTo(text);
            if (binding?.isLocked) $('<small class="cig_appearance_locked">Locked for this chat</small>').appendTo(text);
        }
        if (!isAvailable) $('<small>').text(actionState.deleting ? 'Saved look deletion in progress' : 'Saved look unavailable').appendTo(text);
        if (!active && isAvailable) {
            const useLabel = `Use ${look.label} for ${identity.label}`;
            $('<button type="button" class="menu_button cig_appearance_use" title="Use this appearance" aria-label="Use this appearance">')
                .text('Use in this chat')
                .attr({ title: useLabel, 'aria-label': useLabel })
                .appendTo(row);
        } else if (active && isAvailable) {
            const lockLabel = binding?.isLocked ? 'Unlock' : 'Lock for this chat';
            $('<button type="button" class="menu_button cig_appearance_lock">')
                .text(lockLabel)
                .attr({ 'aria-pressed': binding?.isLocked ? 'true' : 'false', 'aria-label': lockLabel })
                .appendTo(row);
            if (binding) {
                $('<button type="button" class="menu_button cig_appearance_stop">')
                    .text('Stop using in this chat')
                    .attr({ title: `Stop using ${look.label} in this chat`, 'aria-label': `Stop using ${look.label} in this chat` })
                    .appendTo(row);
            }
        }
        if (isAvailable) {
            const deleteLabel = `Delete ${look.label} everywhere for ${identity.label}`;
            $('<button type="button" class="menu_button cig_appearance_delete_everywhere">')
                .text('Delete saved look everywhere…')
                .attr({ title: deleteLabel, 'aria-label': deleteLabel })
                .appendTo(row);
        }
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
            $('#cig_preview_container').prop('hidden', false);
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

    const attached = await attachGeneratedImageSafely({
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
        appendMedia: ({ result, storedIterationArtifact, filePath: savedPath, prompt: sourcePrompt, message: currentMessage }) => {
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
                cig_owner: extensionName,
                ...(result.__cigContinuitySnapshot ? { cig_continuity_snapshot: cloneSnapshot(result.__cigContinuitySnapshot) } : {}),
                ...(result.__cigSceneMetadata ? { cig_scene_inspection: cloneSnapshot(result.__cigSceneMetadata) } : {}),
                ...(result.__cigIterationArtifact ? { cig_iteration_artifact: storedIterationArtifact || sanitizeIterationArtifactForStorage(result.__cigIterationArtifact) } : {}),
            });
            currentMessage.extra.media_index = currentMessage.extra.media.length - 1;
            currentMessage.extra.inline_image = true;
            appendMediaToMessage(currentMessage, currentMessageElement, SCROLL_BEHAVIOR.KEEP);
            renderContinuityShelf(currentMessageElement, currentMessage);
            renderSceneInspection(currentMessageElement, currentMessage);
            renderVisibleCanonControls(currentMessageElement, currentMessage);
            scheduleImageArrowConfiguration({
                schedule: (callback) => setTimeout(callback, 0),
                reconfigure: () => configureCigImageArrows(currentMessageElement),
            });
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
                renderContinuityShelf(currentMessageElement, currentMessage);
                renderSceneInspection(currentMessageElement, currentMessage);
                scheduleImageArrowConfiguration({
                    schedule: (callback) => setTimeout(callback, 0),
                    reconfigure: () => configureCigImageArrows(currentMessageElement),
                });
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

            // Persist the reconciled scene state in the same captured chat. The
            // scene helper saves the metadata, verifies it, and retains a
            // chat-scoped pending entry when the readback is indeterminate.
            const sceneSave = await persistSceneStateForAttachment(result, effectiveTarget, saveEpoch);
            if (sceneSave.saved === false) return sceneSave;
            if (!chatLifecycleEpoch.isCurrent(saveEpoch)) return { saved: false, reason: 'chat-changed' };
            const afterSaveContext = getContext();
            const afterSave = validateMessageTarget({
                target: effectiveTarget,
                currentChatId: afterSaveContext.chatId,
                currentChat: afterSaveContext.chat,
            });
            return afterSave.safe ? { saved: true, sceneStateStatus: sceneSave.sceneStateStatus } : afterSave;
        },
        addToGallery,
        notify: (messageText) => toastr.info(messageText, 'Context Image Generation'),
        rollbackMedia: (rollback) => rollback?.(),
    });
    refreshVisibleCanonControls();
    return attached;
}

function isCigOwnedMedia(media) {
    return media?.cig_owner === extensionName
        || (typeof media?.url === 'string' && media.url.includes(extensionName));
}

function activeMediaForMessage(message) {
    const media = message?.extra?.media;
    if (!Array.isArray(media) || media.length === 0) return null;
    const rawIndex = Number(message.extra.media_index);
    const index = Number.isInteger(rawIndex)
        ? Math.max(0, Math.min(rawIndex, media.length - 1))
        : media.length - 1;
    return { media, index, item: media[index] };
}

function iterationSourceArtifact(message, activeMedia) {
    const item = activeMedia?.item || {};
    if (item.cig_iteration_artifact?.artifactId) return { ...cloneSnapshot(item.cig_iteration_artifact), mediaUrl: item.url || null };
    const legacy = createIterationArtifact({
        artifactId: `artifact:legacy:${activeMedia?.index ?? 0}`,
        sourcePassage: { text: item.title || '' },
        effectivePrompt: item.title || '',
        references: [], model: {}, route: {}, options: {}, canonSnapshot: {},
    });
    return { ...legacy, mediaUrl: item.url || null, target: { chatId: getContext().chatId, messageId: Number(message?.mesid ?? activeMedia?.item?.messageId ?? 0) }, sender: visibleCanonMessageSender(message) };
}

function iterationGenerationPlan(sourceArtifact) {
    return sourceArtifact?.generationPlan || null;
}

function iterationArtifactForStorage(artifact, plan) {
    return sanitizeIterationArtifactForStorage({ ...artifact, generationPlan: plan?.generationPlan || artifact?.generationPlan });
}

async function persistIterationArtifact({ artifact, originalArtifact, plan }) {
    const target = originalArtifact?.target || artifact?.target;
    const currentContext = getContext();
    const messageId = Number(target?.messageId);
    const message = currentContext.chat?.[messageId];
    if (!target?.chatId || !Number.isInteger(messageId) || !message || currentContext.chatId !== target.chatId || !artifact?.imageData) return { status: 'confirmed-absent' };
    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (!messageElement.length) return { status: 'confirmed-absent' };
    const filePath = await saveBase64AsFile(artifact.imageData, extensionName, `cig_iteration_${Date.now()}`, 'png');
    const previousExtra = cloneSnapshot(message.extra);
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    if (!Array.isArray(message.extra.media)) message.extra.media = [];
    message.extra.media.push({
        url: filePath,
        type: MEDIA_TYPE.IMAGE,
        title: String(artifact.effectivePrompt || '').slice(0, 100),
        source: MEDIA_SOURCE.GENERATED,
        cig_owner: extensionName,
        cig_iteration_artifact: iterationArtifactForStorage(artifact, plan),
        cig_iteration_persistence: { planId: plan.planId, invocationId: plan.invocationId },
    });
    message.extra.media_index = message.extra.media.length - 1;
    message.extra.inline_image = true;
    appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
    const captured = { chatId: target.chatId, epoch: chatLifecycleEpoch.capture() };
    const saved = await saveChatForCapturedTarget(captured, target);
    if (!saved?.saved) {
        message.extra = previousExtra;
        appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
        return saved;
    }
    await addToGallery(artifact.imageData, artifact.effectivePrompt || '', messageId, filePath, {
        iterationArtifact: iterationArtifactForStorage(artifact, plan),
        source: 'iteration', chatId: target.chatId, messageId,
    });
    renderIterationActionSurface(messageElement, message);
    return { status: 'confirmed', artifactId: artifact.artifactId, planId: plan.planId, invocationId: plan.invocationId };
}

function iterationDispatchCoordinator(sourceArtifact) {
    return {
        enqueue(iterationPlan, execute) {
            const captured = iterationGenerationPlan(sourceArtifact) || {};
            const base = captured.generationPlan || captured;
            const coordinatorPlan = {
                ...cloneSnapshot(base),
                id: `iteration:${iterationPlan.planId}`,
                idempotencyKey: `iteration:${iterationPlan.planId}`,
                target: cloneSnapshot(sourceArtifact.target),
            };
            return generationCoordinator.enqueue(coordinatorPlan, execute);
        },
    };
}

async function dispatchIterationPlan(plan, signal) {
    const source = plan.sourceArtifact;
    const artifact = plan.artifacts?.[0] || source;
    const target = source.target;
    const sourceMessage = artifact.effectivePrompt || artifact.sourcePassage?.text;
    const generated = await generateImageFromPromptInternal(sourceMessage, source.sender || null, target?.messageId ?? null, null, target, 'wand', null, artifact, null, signal);
    if (!generated?.imageData) throw new Error('Iteration generation returned no image.');
    return {
        status: 'completed',
        planId: plan.planId,
        invocationId: plan.invocationId,
        outputCount: 1,
        artifacts: [{ ...plan.artifacts[0], imageData: generated.imageData }],
        signal,
    };
}

async function persistIterationCanonicalRoles({ sourceArtifact, mutation }) {
    const roles = mutation?.roles || {};
    if (Object.keys(roles).some((role) => role !== 'activeLook') || !roles.activeLook?.identityId) throw new Error('Only the active character look can be promoted from an iteration image.');
    if (!sourceArtifact.mediaUrl) throw new Error('The current image cannot be read for canonical promotion.');
    const identity = getAppearanceIdentityChoices().find((entry) => entry.id === roles.activeLook.identityId);
    if (!identity) throw new Error('The selected canonical identity is unavailable.');
    const captured = { chatId: sourceArtifact.target?.chatId, epoch: chatLifecycleEpoch.capture() };
    const item = { id: sourceArtifact.artifactId, url: sourceArtifact.mediaUrl, prompt: sourceArtifact.effectivePrompt || 'Saved appearance' };
    const activation = await runRememberAppearance({
        captured, identity, label: 'Canonical look', item,
        io: {
            isCurrent: visibleCanonCaptureIsCurrent,
            runExclusive: (operation) => enqueueLibraryMutation(operation),
            readLibrary: async () => {
                const authoritative = await readPersistedExtensionLibrary({ fetchImpl: fetch, getHeaders: getRequestHeaders });
                if (authoritative.status === 'confirmed') extension_settings[extensionName].rp_library = migrateAppearanceLibrary(authoritative.library);
                return authoritative;
            },
            readDataUrl: async (galleryItem) => {
                const response = await fetch(galleryItem.url);
                if (!response.ok) throw new Error('The current image could not be read.');
                const blob = await response.blob();
                return getBase64Async(blob);
            },
            saveBase64: (data, folder, filename, extension) => saveBase64AsFile(data, folder, filename, extension),
            saveLibrary: async (library) => { extension_settings[extensionName].rp_library = library; await saveSettings(); },
            verifyLibrary: (revision) => verifyPersistedExtensionLibrary({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
            deleteAppearanceFile: (url) => deleteAppearanceAssetFile(url, fetch, getRequestHeaders),
            persistOrphanCleanup: ({ library, url }) => persistOrphanCleanupRetry(library, url),
            setLocalLibrary: (library) => { extension_settings[extensionName].rp_library = library; },
            scheduleLibraryReconciliation: ({ operationId, revision }) => scheduleLibraryPromotionReconciliation(operationId, revision),
            getChatCanon: () => chat_metadata[CHAT_CANON_KEY],
            persistChat: ({ candidate, activeLookId }) => persistChatCanonChange({ captured, candidate, identityId: identity.id, activeLookId }),
            uuid: () => crypto.randomUUID(),
            now: () => Date.now(),
        },
    });
    if (activation.status !== 'confirmed') throw new Error(activation.message || 'Canonical look promotion was not confirmed.');
    return { status: 'confirmed', lookId: activation.promoted?.look?.id || null, identityId: identity.id, activation };
}

async function verifyIterationCanonicalRoles({ sourceArtifact, plan, mutation, persisted }) {
    const identityId = mutation?.roles?.activeLook?.identityId;
    if (!identityId || !persisted?.lookId) return { status: 'confirmed-absent', mutation: cloneSnapshot(mutation), planId: plan.planId, invocationId: plan.invocationId };
    const result = await verifyPersistedChatBinding({
        target: { chatId: sourceArtifact.target?.chatId, identityId, activeLookId: persisted.lookId, expectedRevision: chat_metadata[CHAT_CANON_KEY]?.revision },
        fetchImpl: fetch,
        getHeaders: getRequestHeaders,
    });
    return { status: result.status, mutation: cloneSnapshot(mutation), role: 'activeLook', identityId, lookId: persisted.lookId, planId: plan.planId, invocationId: plan.invocationId };
}

function renderIterationActionSurface(messageElement, messageOverride = null) {
    if (!messageElement?.length) return;
    const messageId = Number(messageElement.attr('mesid'));
    const message = messageOverride || getContext().chat?.[messageId];
    const activeMedia = activeMediaForMessage(message);
    const key = `${getContext().chatId || 'unknown-chat'}:${messageId}`;
    const previous = iterationSurfaceMounts.get(key);
    previous?.destroy?.();
    iterationSurfaceMounts.delete(key);
    messageElement.find('.cig_iteration_entry').remove();
    if (!activeMedia || !isCigOwnedMedia(activeMedia.item)) return;
    const root = $('<section class="cig_iteration_entry" aria-label="Improve generated image"></section>');
    const button = $('<button type="button" class="menu_button cig_iteration_improve" data-cig-iteration-open="true" data-cig-iteration-improve="true" style="min-height:44px"></button>')
        .text('Improve')
        .attr({ title: 'Improve this generated image', 'aria-label': 'Improve this generated image', 'data-message-id': String(messageId) });
    const host = $('<div class="cig_iteration_host" data-cig-iteration-host hidden></div>');
    root.append(button, host);
    const anchor = messageElement.find('.mes_img_container, .mes_media_container').last();
    if (anchor.length) anchor.after(root); else messageElement.append(root);
    button.on('click', () => {
        host.prop('hidden', false);
        if (iterationSurfaceMounts.has(key)) return;
        const sourceArtifact = iterationSourceArtifact(message, activeMedia);
        const generationPlan = iterationGenerationPlan(sourceArtifact);
        const controller = createIterationSurfaceController({
            sourceArtifact,
            generationPlan,
            twoUpAvailable: false,
            allowUnquotedSingle: true,
            supportedCanonicalRoles: ['activeLook'],
            reserveInvocation: (invocationId) => { if (iterationInvocations.has(invocationId)) return false; iterationInvocations.add(invocationId); return true; },
            verifyGenerationPlan: (candidate) => candidate.planId === generationPlan?.planId && candidate.revision === generationPlan?.revision && generationPlan?.routeConfirmationAccepted === true
                ? { status: 'verified', planId: candidate.planId, revision: candidate.revision, authorityToken: generationPlan.planId, routeResolved: true, capabilities: generationPlan.capabilities || {} } : { status: 'unverified' },
            dispatchCoordinator: iterationDispatchCoordinator(sourceArtifact),
            dispatchExecutor: dispatchIterationPlan,
            persistArtifact: persistIterationArtifact,
            readbackArtifact: ({ artifact, plan }) => verifyPersistedIterationArtifact({ target: sourceArtifact.target, artifactId: artifact.artifactId, planId: plan.planId, invocationId: plan.invocationId, fetchImpl: fetch, getHeaders: getRequestHeaders }),
            readbackOriginalArtifact: async ({ originalArtifact, plan }) => {
                const result = await verifyPersistedIterationArtifact({ target: sourceArtifact.target, artifactId: originalArtifact.artifactId, fetchImpl: fetch, getHeaders: getRequestHeaders });
                return { ...result, planId: plan.planId, invocationId: plan.invocationId };
            },
            verifyCanonicalEligibility: ({ artifactId, roles }) => ({ status: artifactId === sourceArtifact.artifactId && Object.keys(roles || {}).length === 1 && Object.prototype.hasOwnProperty.call(roles || {}, 'activeLook') && sourceArtifact.mediaUrl ? 'eligible' : 'ineligible', artifactId, authorityToken: 'captured-artifact' }),
            mutateCanonical: ({ mutation }) => persistIterationCanonicalRoles({ sourceArtifact, mutation }),
            readbackCanonical: ({ plan, mutation, persisted }) => verifyIterationCanonicalRoles({ sourceArtifact, plan, mutation, persisted }),
        });
        iterationSurfaceMounts.set(key, { controller, destroy: () => mount?.destroy?.() });
        const mount = mountIterationSurface(host[0], controller);
        iterationSurfaceMounts.set(key, { controller, destroy: mount.destroy });
    });
    installIterationSurfaceStyles(document);
}

function destroyIterationSurfaceMounts() {
    for (const mount of iterationSurfaceMounts.values()) mount?.destroy?.();
    iterationSurfaceMounts.clear();
}

function imageNavigationContext(messageElement) {
    const messageId = Number(messageElement?.attr('mesid'));
    const context = getContext();
    const message = context.chat?.[messageId];
    const activeMedia = activeMediaForMessage(message);
    if (!Number.isInteger(messageId) || !activeMedia || !isCigOwnedMedia(activeMedia.item)) return null;
    return { context, message, messageId, messageElement, ...activeMedia };
}

function imageGenerationKey({ context, messageId }) {
    return `${context.chatId || 'unknown-chat'}:${messageId}`;
}

function cigImageArrows(messageElement) {
    return messageElement.find('.mes_img_swipe_left, .mes_img_swipe_right');
}

function configureCigImageArrows(messageElement) {
    if (!imageNavigationContext(messageElement)) return;
    renderVisibleCanonControls(messageElement);
    renderIterationActionSurface(messageElement);
    messageElement.find('.mes_img_swipe_left')
        .attr({ tabindex: '0', role: 'button', title: 'Previous image', 'aria-label': 'Previous image' })
        .addClass('cig_image_navigation');
    messageElement.find('.mes_img_swipe_right')
        .attr({ tabindex: '0', role: 'button', title: 'Next image', 'aria-label': 'Next image' })
        .addClass('cig_image_navigation');
}

function setCigImageArrowBusy(messageElement, busy) {
    setBusyState(cigImageArrows(messageElement), busy, { busyClass: 'cig_busy', busyTitle: 'Generating image…' });
}

function stopImageNavigationEvent(event) {
    event.preventDefault();
    event.stopPropagation();
}

function resolveCigImageGestureContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest('.mes_img');
    const mediaContainer = image?.closest('.mes_img_container, .mes_media_container');
    const messageElement = mediaContainer ? $(mediaContainer).closest('.mes') : $();
    if (!messageElement.length) return null;
    return imageNavigationContext(messageElement);
}

function onCigImageGesture(event) {
    const navigation = resolveCigImageGestureContext(event);
    if (!navigation) return;
    configureCigImageArrows(navigation.messageElement);
    handleImageGesture({
        event,
        gesturesEnabled: power_user.gestures !== false,
        resolveArrow: (direction) => navigation.messageElement.find(direction === 'next'
            ? '.mes_img_swipe_right'
            : '.mes_img_swipe_left')[0],
    });
}

async function generatePastLastImage(navigation) {
    const key = imageGenerationKey(navigation);
    if (activeImageBoundaryGenerations.has(key)) return;

    activeImageBoundaryGenerations.add(key);
    setCigImageArrowBusy(navigation.messageElement, true);
    const messageMedia = navigation.messageElement.find('.mes_img, .mes_video');
    const charName = navigation.context.name2 || 'Character';
    const userName = name1 || 'User';
    const sender = navigation.message.is_user ? `{{user}} (${userName})` : `{{char}} (${charName})`;

    try {
        messageMedia.addClass('fa-fade');
        await attachGeneratedImage(
            navigation.message,
            navigation.messageElement,
            navigation.message.mes,
            sender,
            navigation.messageId,
            null,
            null,
            'swipe',
        );
    } catch (error) {
        showGenerationError(error, 'Image regeneration');
    } finally {
        messageMedia.removeClass('fa-fade');
        activeImageBoundaryGenerations.delete(key);
        setCigImageArrowBusy(navigation.messageElement, false);
        configureCigImageArrows(navigation.messageElement);
    }
}

function onCigImageArrowClick(event) {
    const target = event.target instanceof Element ? event.target.closest('.mes_img_swipe_left, .mes_img_swipe_right') : null;
    if (!target) return;
    const messageElement = $(target).closest('.mes');
    const navigation = imageNavigationContext(messageElement);
    if (!navigation) return;

    configureCigImageArrows(messageElement);
    const key = imageGenerationKey(navigation);
    if (activeImageBoundaryGenerations.has(key)) {
        stopImageNavigationEvent(event);
        return;
    }
    handleImageArrowNavigation({
        owned: true,
        event,
        direction: target.classList.contains('mes_img_swipe_right') ? 'next' : 'previous',
        currentIndex: navigation.index,
        mediaLength: navigation.media.length,
        generatePastLast: Boolean(extension_settings[extensionName]?.regenerate_on_swipe),
        generationActive: false,
        schedule: (callback) => setTimeout(callback, 0),
        reconfigure: () => configureCigImageArrows(messageElement),
        generate: () => { void generatePastLastImage(navigation); },
    });
}

function onCigImageArrowKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target.closest('.cig_image_navigation') : null;
    if (!target) return;
    stopImageNavigationEvent(event);
    target.click();
}

function configureAllCigImageArrows() {
    $('.mes').each(function () {
        configureCigImageArrows($(this));
    });
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
            $('#cig_preview_container').prop('hidden', false);
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

    renderVisibleCanonControls(messageElement);

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

function visibleCanonMessageSender(message) {
    if (message?.is_user) return `{{user}} (${message.name || name1 || 'User'})`;
    const context = getContext();
    return `{{char}} (${message?.name || context.name2 || 'Character'})`;
}

function createVisibleCanonButton(className, label, attributes = {}) {
    return $('<button type="button"></button>')
        .addClass(`menu_button ${className}`)
        .text(label)
        .attr({ ...attributes, 'aria-label': attributes['aria-label'] || label, title: attributes.title || label });
}

function renderContinuityShelf(messageElement, messageOverride = null) {
    messageElement?.find('.cig_continuity_shelf').remove();
    if (!messageElement?.length) return;
    const messageId = Number(messageElement.attr('mesid'));
    const context = getContext();
    const message = messageOverride || context.chat?.[messageId];
    const activeMedia = activeMediaForMessage(message);
    const continuitySurface = activeMedia?.item?.cig_continuity_snapshot;
    if (!continuitySurface?.referencePlan?.identities?.length) return;
    const settings = extension_settings[extensionName] || {};
    const catalog = migrateOutfitCatalog(settings.rp_outfits);
    const outfitState = migrateChatOutfitState(chat_metadata[CHAT_CANON_KEY]?.outfitState);
    const shelf = {
        ...continuitySurface.referencePlan,
        identities: continuitySurface.referencePlan.identities.map((entry) => {
            const outfitResult = resolveActiveChatOutfit(outfitState, entry.identityId, catalog);
            return {
                ...entry,
                activeOutfit: outfitResult?.outfit ? {
                    id: outfitResult.outfit.id,
                    name: outfitResult.outfit.name,
                    items: cloneSnapshot(outfitResult.outfit.items || []),
                    description: outfitResult.outfit.description || null,
                    isLocked: outfitResult.binding?.isLocked === true,
                } : null,
                outfits: catalog.outfits.filter((outfit) => outfit.identityId === entry.identityId).map((outfit) => ({ id: outfit.id, name: outfit.name, items: cloneSnapshot(outfit.items), description: outfit.description })),
            };
        }),
    };
    const root = $('<details class="cig_continuity_shelf"></details>')
        .attr({ 'data-message-id': String(messageId), 'aria-label': 'Visual continuity shelf' });
    const summary = $('<summary class="cig_continuity_shelf_summary"></summary>')
        .text(`Continuity · ${shelf.identities.map((entry) => entry.identityLabel).join(' + ')}`)
        .appendTo(root);
    summary.attr('title', 'Show continuity sources and outfit controls');
    $('<small class="cig_continuity_shelf_limit" role="status"></small>')
        .text(shelf.modelLimit.maxReferences === null ? 'Reference limit unknown; image references are held.' : `${shelf.modelLimit.used}/${shelf.modelLimit.maxReferences} image references selected.`)
        .appendTo(root);
    for (const entry of shelf.identities) {
        const row = $('<article class="cig_continuity_identity"></article>').attr('data-identity-id', entry.identityId);
        const heading = $('<div class="cig_continuity_identity_heading"></div>').appendTo(row);
        if (entry.thumbnail) $('<img class="cig_continuity_thumbnail" alt=""></img>').attr('src', entry.thumbnail).appendTo(heading);
        $('<strong></strong>').text(entry.identityLabel).appendTo(heading);
        $('<span class="cig_continuity_source"></span>').text(`Source: ${entry.sourceType}`).appendTo(heading);
        if (entry.description) $('<details class="cig_continuity_description"><summary>Written details</summary><p></p></details>').find('p').text(entry.description).end().appendTo(row);
        const refs = $('<small class="cig_continuity_refs"></small>');
        if (entry.selected.length) refs.append($('<span></span>').text(`Selected: ${entry.selected.map((ref) => ref.sourceType).join(', ')}`));
        if (entry.omitted.length) refs.append($('<span></span>').text(` Omitted: ${entry.omitted.map((ref) => `${ref.sourceType} (${ref.reason})`).join(', ')}`));
        refs.appendTo(row);
        const outfitLabel = $('<label class="cig_continuity_outfit_label"></label>').text('Outfit');
        const outfitSelect = $('<select class="text_pole cig_continuity_outfit_select"></select>').attr({ 'aria-label': `Choose outfit for ${entry.identityLabel}` });
        $('<option value="">No active outfit</option>').appendTo(outfitSelect);
        for (const outfit of entry.outfits) $('<option></option>').attr('value', outfit.id).text(outfit.name).prop('selected', outfit.id === entry.activeOutfit?.id).appendTo(outfitSelect);
        outfitLabel.append(outfitSelect).appendTo(row);
        if (entry.outfits.length) {
            $('<button type="button" class="menu_button cig_continuity_outfit_activate">Activate</button>').attr({ 'aria-label': `Activate selected outfit for ${entry.identityLabel}` }).appendTo(row);
            if (entry.activeOutfit) $('<button type="button" class="menu_button cig_continuity_outfit_lock"></button>').text(entry.activeOutfit.isLocked ? 'Unlock outfit' : 'Lock outfit').attr({ 'aria-pressed': String(entry.activeOutfit.isLocked), 'aria-label': `${entry.activeOutfit.isLocked ? 'Unlock' : 'Lock'} outfit for ${entry.identityLabel}` }).appendTo(row);
        }
        $('<input type="text" class="text_pole cig_continuity_outfit_name" maxlength="80" placeholder="New outfit name">').attr('aria-label', `New outfit name for ${entry.identityLabel}`).appendTo(row);
        $('<input type="text" class="text_pole cig_continuity_outfit_details" maxlength="240" placeholder="Outfit details">').attr('aria-label', `New outfit details for ${entry.identityLabel}`).appendTo(row);
        $('<button type="button" class="menu_button cig_continuity_outfit_create">Create outfit</button>').attr('aria-label', `Create outfit for ${entry.identityLabel}`).appendTo(row);
        row.appendTo(root);
    }
    const mediaContainer = messageElement.find('.mes_img_container, .mes_media_container').last();
    if (mediaContainer.length) mediaContainer.after(root);
    else messageElement.find('.mes_text').after(root);
}

function renderContinuityShelves() {
    $('.mes').each(function () { renderContinuityShelf($(this)); });
}

function renderSceneInspection(messageElement, messageOverride = null) {
    messageElement?.find('.cig_scene_inspection').remove();
    const messageId = Number(messageElement?.attr('mesid'));
    const message = messageOverride || getContext().chat?.[messageId];
    const artifactInspection = activeMediaForMessage(message)?.item?.cig_scene_inspection;
    const inspection = artifactInspection?.inspection || artifactInspection;
    if (!inspection || !Array.isArray(inspection.lines)) return;

    const confidence = String(inspection.confidence || 'low');
    const root = $('<details class="cig_scene_inspection"></details>')
        .attr({ 'data-message-id': String(messageId), 'aria-label': 'Scene interpretation inspection' });
    $('<summary class="cig_scene_inspection_summary"></summary>')
        .text(`Scene interpretation · ${confidence} confidence`)
        .appendTo(root);
    const lines = $('<ul class="cig_scene_inspection_lines"></ul>').appendTo(root);
    for (const line of inspection.lines.slice(0, 8)) $('<li></li>').text(String(line)).appendTo(lines);
    for (const warning of Array.isArray(inspection.warnings) ? inspection.warnings.slice(0, 4) : []) {
        $('<p class="cig_scene_inspection_warning" role="note"></p>').text(`Note: ${String(warning)}`).appendTo(root);
    }
    messageElement?.find('.mes_text, .mes_img_container, .mes_media_container').last().after(root);
}

function renderVisibleCanonControls(messageElement, messageOverride = null) {
    const messageId = Number(messageElement?.attr('mesid'));
    const context = getContext();
    const message = messageOverride || context.chat?.[messageId];
    const activeMedia = activeMediaForMessage(message);
    const controls = messageElement?.find('.cig_visible_canon');
    controls?.remove();
    if (!messageElement?.length || !activeMedia || !isCigOwnedMedia(activeMedia.item)) return;

    const settings = extension_settings[extensionName] || {};
    const library = migrateAppearanceLibrary(settings.rp_library);
    const materialized = materializeAppearanceAssets(library, settings.gallery || []);
    const fallbackIdentityId = getStableSpeakerIdentityId(visibleCanonMessageSender(message));
    const identityId = resolveVisibleCanonIdentityId({
        fallbackIdentityId,
        media: activeMedia.item,
        messageId,
        gallery: settings.gallery,
    });
    const projection = projectVisibleCanon({
        library,
        chatState: chat_metadata[CHAT_CANON_KEY],
        identityId,
        availableAssetIds: Object.keys(materialized.assets),
    });
    const root = $('<section class="cig_visible_canon" aria-label="Visual canon controls"></section>')
        .attr({
            'data-message-id': String(messageId),
            'data-media-url': activeMedia.item.url || '',
            'data-identity-id': projection.identityId,
        });
    $('<span class="cig_visible_canon_status" role="status" aria-live="polite"></span>')
        .text(visibleCanonStatus(projection))
        .appendTo(root);

    const remember = createVisibleCanonButton('cig_visible_canon_remember', 'Remember character look', {
        'data-message-id': String(messageId),
        'data-media-url': activeMedia.item.url || '',
    });
    remember.appendTo(root);

    if (projection.looks.length > 0) {
        const selectId = `cig_visible_canon_select_${messageId}`;
        const label = $('<label class="cig_visible_canon_select_label"></label>')
            .attr('for', selectId)
            .text('Saved look');
        const select = $('<select class="text_pole cig_visible_canon_select"></select>')
            .attr({ id: selectId, 'aria-label': `Choose a saved look for ${projection.identityLabel}` });
        for (const look of projection.looks) {
            $('<option></option>').attr('value', look.id).text(look.label).prop('selected', look.id === projection.activeLookId).appendTo(select);
        }
        label.append(select).appendTo(root);
        createVisibleCanonButton('cig_visible_canon_change', 'Change look', {
            'data-message-id': String(messageId),
            'data-media-url': activeMedia.item.url || '',
            'data-identity-id': projection.identityId,
        }).appendTo(root);
    }

    if (projection.active) {
        createVisibleCanonButton('cig_visible_canon_lock', projection.locked ? 'Unlock look' : 'Lock look', {
            'data-message-id': String(messageId),
            'data-media-url': activeMedia.item.url || '',
            'data-identity-id': projection.identityId,
            'data-look-id': projection.activeLookId,
            'aria-pressed': projection.locked ? 'true' : 'false',
        }).appendTo(root);
        createVisibleCanonButton('cig_visible_canon_stop', 'Stop using look', {
            'data-message-id': String(messageId),
            'data-media-url': activeMedia.item.url || '',
            'data-identity-id': projection.identityId,
            'data-look-id': projection.activeLookId,
        }).appendTo(root);
    }

    const mediaContainer = messageElement.find('.mes_img_container, .mes_media_container').last();
    if (mediaContainer.length) mediaContainer.after(root);
    else messageElement.append(root);
}

function refreshVisibleCanonControls() {
    $('.mes').each(function () {
        renderVisibleCanonControls($(this));
    });
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
    const settings = extension_settings[extensionName];
    if (!await confirmDestructiveAction('Clear Gallery history? Remembered appearances will remain saved.', 'Clear Gallery')) return;
    const result = await runClearGalleryPreservingLooks({ gallery: settings.gallery || [], io: appearanceMigrationIo() });
    if (result.status !== 'confirmed') {
        toastr.info(result.message, 'Context Image Generation');
        return;
    }
    toastr.success(result.message, 'Context Image Generation');
}

function viewGalleryImage(index) {
    const settings = extension_settings[extensionName];
    const item = settings.gallery[index];
    if (!item) return;
    const opener = document.activeElement;

    const popup = $(`
        <div class="cig_popup_overlay">
            <div class="cig_popup" role="dialog" aria-modal="true" aria-labelledby="cig_popup_title">
                <div class="cig_popup_header">
                    <h2 id="cig_popup_title"></h2>
                    <button type="button" class="cig_popup_close" aria-label="Close image preview"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </div>
                <img />
                <div class="cig_popup_prompt"></div>
            </div>
        </div>
    `);

    // Set text/attributes via jQuery so the prompt is escaped, never injected.
    popup.find('.cig_popup_header h2').text(`Image preview — ${new Date(item.timestamp).toLocaleString()}`);
    popup.find('.cig_popup img').attr({ src: galleryItemSrc(item), alt: item.prompt ? `Generated image: ${item.prompt}` : 'Generated image' });
    popup.find('.cig_popup_prompt').text(item.prompt || '');
    const controller = createAccessibleDialogController({
        dialog: popup.find('.cig_popup')[0],
        opener,
        onDismiss: () => popup.remove(),
    });

    popup.on('click', '.cig_popup_close', function () {
        controller.dismiss();
    });
    popup.on('click', '.cig_popup_overlay', function (e) {
        if (e.target === this) controller.dismiss();
    });

    $('body').append(popup);
    controller.open();
}

async function confirmDestructiveAction(message, confirmLabel) {
    const popup = new Popup(message, POPUP_TYPE.CONFIRM, null, {
        okButton: confirmLabel,
        cancelButton: 'Cancel',
        animation: 'fast',
    });
    return (await popup.show()) === POPUP_RESULT.AFFIRMATIVE;
}

async function deleteGalleryImage(index) {
    const settings = extension_settings[extensionName];
    const targetItem = settings.gallery[index];
    if (!targetItem) return;
    const targetArtifactId = galleryArtifactKey(targetItem);
    const protectedIds = getProtectedGalleryArtifactIds(settings.rp_library);
    const decision = applyGalleryImageDeletion({ gallery: settings.gallery, targetArtifactId, targetItem, protectedIds, confirmed: false });
    if (decision.decision === 'protected') {
        toastr.info('This image is remembered as an appearance. Remove that appearance first.', 'Context Image Generation');
        return;
    }
    if (decision.decision !== 'cancelled' || !await confirmDestructiveAction('Delete this generated image? This cannot be undone.', 'Delete image')) return;
    const currentProtectedIds = getProtectedGalleryArtifactIds(settings.rp_library);
    const confirmed = applyGalleryImageDeletion({ gallery: settings.gallery, targetArtifactId, targetItem, protectedIds: currentProtectedIds, confirmed: true });
    if (confirmed.decision !== 'deleted') return;
    settings.gallery = confirmed.gallery;
    saveSettingsDebounced();
    renderGallery();
    renderAppearanceList();
}

async function useAppearanceLook(identityId, lookId, mediaTarget = null) {
    const settings = extension_settings[extensionName];
    const identity = migrateAppearanceLibrary(settings.rp_library).identities[identityId];
    const look = identity?.looks.find((entry) => entry.id === lookId);
    const materialized = materializeAppearanceAssets(settings.rp_library, settings.gallery || []);
    if (!look || !projectAppearanceLookActionState(settings.rp_library, lookId, !!materialized.assets[look.assetId]).available) {
        toastr.info('Saved look unavailable.', 'Context Image Generation');
        return;
    }
    const canon = migrateChatCanon(chat_metadata[CHAT_CANON_KEY]);
    const captured = { chatId: getContext().chatId, epoch: chatLifecycleEpoch.capture(), fingerprint: chatCanonRevisionFingerprint(canon, identityId), ...(mediaTarget ? { mediaTarget } : {}) };
    const current = getChatBinding(canon, identityId);
    let confirmed = false;
    if (current?.isLocked && current.activeLookId !== lookId) {
        confirmed = await confirmDestructiveAction('Replace the locked look for this chat?', 'Use in this chat');
        if (!confirmed) return;
    }
    const action = await appearanceFeatureController().use({
        captured, identityId, activeLookId: look.id, baselineFingerprint: captured.fingerprint, mediaTarget,
        buildCandidate: () => {
            const selected = selectLookForChat(canon, identityId, { activeLookId: look.id, expectedAssetId: look.assetId, selectedAt: Date.now(), confirmed, expectedLookId: current?.activeLookId });
            return selected.status === 'selected' ? { ...selected.state, revision: `chat-canon:${crypto.randomUUID()}` } : null;
        },
    });
    if (action.status === 'confirmed') {
        renderAppearanceList();
        refreshVisibleCanonControls();
        toastr.success(action.message, 'Context Image Generation');
    } else toastr.info(action.message, 'Context Image Generation');
}

async function toggleAppearanceLookLock(identityId, lookId, mediaTarget = null) {
    const settings = extension_settings[extensionName];
    const identity = migrateAppearanceLibrary(settings.rp_library).identities[identityId];
    const look = identity?.looks.find((entry) => entry.id === lookId);
    const materialized = materializeAppearanceAssets(settings.rp_library, settings.gallery || []);
    if (!look || !projectAppearanceLookActionState(settings.rp_library, lookId, !!materialized.assets[look.assetId]).available) {
        toastr.info('Saved look unavailable.', 'Context Image Generation');
        return;
    }
    const canon = migrateChatCanon(chat_metadata[CHAT_CANON_KEY]);
    const captured = { chatId: getContext().chatId, epoch: chatLifecycleEpoch.capture(), fingerprint: chatCanonRevisionFingerprint(canon, identityId), ...(mediaTarget ? { mediaTarget } : {}) };
    const binding = getChatBinding(canon, identityId);
    const actionName = binding?.isLocked ? 'unlock' : 'lock';
    const action = await appearanceFeatureController()[actionName]({
        captured, identityId, activeLookId: look.id, baselineFingerprint: captured.fingerprint, mediaTarget,
        buildCandidate: () => ({ ...(binding ? setChatLock(canon, identityId, !binding.isLocked) : setChatBinding(canon, identityId, { activeLookId: look.id, expectedAssetId: look.assetId, isLocked: true, selectedAt: Date.now() })), revision: `chat-canon:${crypto.randomUUID()}` }),
    });
    if (action.status === 'confirmed') {
        renderAppearanceList();
        refreshVisibleCanonControls();
        toastr.success(action.message, 'Context Image Generation');
    } else toastr.info(action.message, 'Context Image Generation');
}

async function stopAppearanceLook(identityId, lookId, mediaTarget = null) {
    const settings = extension_settings[extensionName];
    const identity = migrateAppearanceLibrary(settings.rp_library).identities[identityId];
    const look = identity?.looks.find((entry) => entry.id === lookId);
    const actionState = projectAppearanceLookActionState(settings.rp_library, lookId, !!look && !!materializeAppearanceAssets(settings.rp_library, settings.gallery || []).assets[look?.assetId]);
    if (!actionState.available) {
        toastr.info('Saved look unavailable.', 'Context Image Generation');
        return;
    }
    const canon = migrateChatCanon(chat_metadata[CHAT_CANON_KEY]);
    const captured = { chatId: getContext().chatId, epoch: chatLifecycleEpoch.capture(), ...(mediaTarget ? { mediaTarget } : {}) };
    const result = await runStopUsingInChat({
        captured, identityId, canon,
        io: {
            isCurrent: chatCaptureIsCurrent,
            persistChat: ({ candidate }) => persistChatCanonChange({ captured, candidate, identityId, activeLookId: null, mediaTarget }),
            uuid: () => crypto.randomUUID(),
        },
    });
    if (result.status === 'confirmed') {
        renderAppearanceList();
        refreshVisibleCanonControls();
        toastr.success(result.message, 'Context Image Generation');
    } else toastr.info(result.message, 'Context Image Generation');
}

async function rememberVisibleCanonImage(messageId, mediaUrl) {
    const settings = extension_settings[extensionName];
    const index = (settings.gallery || []).findIndex((item) => item.url === mediaUrl && String(item.messageId) === String(messageId));
    if (index < 0) {
        toastr.info('This image is not available in the Gallery yet.', 'Context Image Generation');
        return;
    }
    await rememberGalleryAppearance(index, visibleCanonMediaTarget(messageId, mediaUrl));
    refreshVisibleCanonControls();
}

function visibleCanonMediaTarget(messageId, mediaUrl) {
    const message = getContext().chat?.[Number(messageId)];
    const media = message?.extra?.media;
    if (!Array.isArray(media)) return null;
    const item = media.find((entry) => entry?.url === mediaUrl);
    if (!item) return null;
    return { messageId: Number(messageId), mediaUrl, artifactId: buildVisibleCanonMediaArtifactId({ messageId, media: item }) };
}

function visibleCanonActionController() {
    return createVisibleCanonActionController({
        actions: {
            remember: ({ messageId, mediaUrl }) => rememberVisibleCanonImage(messageId, mediaUrl),
            change: ({ identityId, lookId, messageId, mediaUrl }) => useAppearanceLook(identityId, lookId, visibleCanonMediaTarget(messageId, mediaUrl) && { ...visibleCanonMediaTarget(messageId, mediaUrl), lookId }),
            lock: ({ identityId, lookId, messageId, mediaUrl }) => toggleAppearanceLookLock(identityId, lookId, visibleCanonMediaTarget(messageId, mediaUrl) && { ...visibleCanonMediaTarget(messageId, mediaUrl), lookId }),
            stop: ({ identityId, lookId, messageId, mediaUrl }) => stopAppearanceLook(identityId, lookId, visibleCanonMediaTarget(messageId, mediaUrl) && { ...visibleCanonMediaTarget(messageId, mediaUrl), lookId }),
        },
        refresh: refreshVisibleCanonControls,
    });
}

function visibleCanonDomController() {
    return createVisibleCanonDomController({ dispatch: (action, payload) => visibleCanonActionController().run(action, payload) });
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

    $('#cig_settings [data-cig-tab]').on('click', function () {
        activateSettingsTab($(this).attr('data-cig-tab'));
        this.focus();
    }).on('keydown', function (event) {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const tabs = $('#cig_settings [data-cig-tab]');
        const currentIndex = tabs.index(this);
        const nextIndex = event.key === 'Home' ? 0
            : event.key === 'End' ? tabs.length - 1
                : (currentIndex + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
        const nextTab = tabs.eq(nextIndex);
        activateSettingsTab(nextTab.attr('data-cig-tab'));
        nextTab.trigger('focus');
    });

    $('#cig_provider').on('change', function () {
        const settings = extension_settings[extensionName];
        const previousProvider = settings.provider || 'makersuite';
        cancelModelDiscovery(previousProvider);
        clearExperimentalPreflightForProvider(settings, previousProvider);
        settings.provider = $(this).val();
        clearSetupRuntimeIssue();
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
        if (projectSelectedProviderUi(settings, provider, settings.model)?.requiresApiKey) {
            setProviderApiKey(settings, provider, $(this).val());
            clearSetupRuntimeIssue();
            renderSetupReadiness(settings);
            saveSettingsDebounced();
        }
    });

    $('#cig_cancel_generation').on('click', function () {
        if (currentGenerationRunId) generationCoordinator.cancel(currentGenerationRunId);
    });
    $('#cig_show_preflight').on('click', renderAdvancedPlanInspector);
    $('#cig_export_diagnostics').on('click', exportDiagnostics);

    $('#cig_custom_connection_list').on('change', function () {
        const settings = extension_settings[extensionName];
        settings.custom_connection_editor_id = $(this).val() || '';
        customConnectionDraftId = settings.custom_connection_editor_id;
        renderCustomConnectionEditor();
    });
    $('#cig_custom_connection_add').on('click', function () {
        const settings = extension_settings[extensionName];
        customConnectionDraftId = createCustomConnectionId();
        settings.custom_connection_editor_id = '';
        renderCustomConnectionEditor();
    });
    $('#cig_custom_connection_auth').on('change', function () {
        const enabled = $(this).val() !== 'none';
        $('#cig_custom_connection_key').prop('disabled', !enabled);
    });
    $('#cig_custom_connection_protocol').on('change', function () {
        const gemini = $(this).val() === 'gemini-compatible';
        $('#cig_custom_connection_generation_path').toggle(!gemini);
        $('#cig_custom_connection_generation_path_label').toggle(!gemini);
        if ($('#cig_custom_connection_auth').val() !== 'none') $('#cig_custom_connection_auth').val(gemini ? 'gemini-api-key' : 'bearer');
    });
    $('#cig_custom_connection_save').on('click', function () {
        try {
            saveCustomConnectionFromEditor();
            toastr.success('Custom connection saved. No network request was made.', 'Context Image Generation');
        } catch (error) {
            toastr.warning(error.message, 'Context Image Generation');
        }
    });
    $('#cig_custom_connection_test').on('click', testCustomConnectionFromEditor);
    $('#cig_custom_connection_delete').on('click', deleteSelectedCustomConnection);

    $('#cig_model_refresh').on('click', fetchManagedProviderModels);
    $('#cig_model_search').on('input', updateModelDropdown);
    $('#cig_managed_model_list').on('change', function () {
        const selectedId = $(this).val() || '';
        $('#cig_managed_model_id').val(selectedId);
        const settings = extension_settings[extensionName];
        const providerId = settings.provider || 'makersuite';
        $('#cig_remove_model').prop('disabled', !getProviderModelEntries(settings, providerId).some((entry) => entry.id === selectedId));
        renderExperimentalPreflight(settings, selectedId);
    });
    $('#cig_experimental_preflight_checkbox').on('change', function () {
        const settings = extension_settings[extensionName];
        const route = getSelectedModelRoute(settings, $('#cig_managed_model_list').val() || settings.model);
        if (!modelNeedsExperimentalPreflight(route.model)) {
            $(this).prop('checked', false);
            return;
        }
        setExperimentalPreflight(settings, route, $(this).prop('checked'));
        clearSetupRuntimeIssue();
        renderSetupReadiness(settings);
        saveSettingsDebounced();
        renderExperimentalPreflight(settings, route.modelId);
    });
    $('#cig_managed_model_transport').on('change', function () {
        const settings = extension_settings[extensionName];
        const providerId = settings.provider || 'makersuite';
        const selectedId = $('#cig_managed_model_list').val() || settings.model;
        const previousEntry = getProviderModelEntries(settings, providerId).find((entry) => entry.id === selectedId);
        const previousTransport = previousEntry?.transportId || previousEntry?.transport || getProviderDefinition(providerId)?.models?.find((model) => model.id === selectedId)?.transport || '';
        clearExperimentalPreflightForRoute(settings, { providerId, modelId: selectedId, transportId: previousTransport });
        clearExperimentalPreflightForRoute(settings, { providerId, modelId: selectedId, transportId: $(this).val() || '' });
        clearSetupRuntimeIssue();
        renderModelManager();
        saveSettingsDebounced();
    });
    $('#cig_add_model').on('click', () => saveManagedModel('add'));
    $('#cig_save_model').on('click', () => saveManagedModel('save'));
    $('#cig_remove_model').on('click', removeManagedModel);

    $('#cig_model').on('change', function () {
        const settings = extension_settings[extensionName];
        const previousProvider = settings.provider || 'makersuite';
        const previousRoute = getSelectedModelRoute(settings, settings.model);
        cancelModelDiscovery(previousProvider);
        clearExperimentalPreflightForRoute(settings, previousRoute);
        settings.model = $(this).val();
        clearSetupRuntimeIssue();
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

    $('#cig_framing_preference').on('change', function () {
        extension_settings[extensionName].framing_preference = $(this).val() || 'auto';
        saveSettingsDebounced();
    });

    $('#cig_continuity_strength').on('change', function () {
        extension_settings[extensionName].continuity_strength = $(this).val() || 'balanced';
        saveSettingsDebounced();
    });

    $('#cig_custom_visual_instruction').on('input', function () {
        extension_settings[extensionName].custom_visual_instruction = String($(this).val() || '').slice(0, 4000);
        saveSettingsDebounced();
    });

    $('#cig_system_instruction').on('input', function () {
        extension_settings[extensionName].system_instruction = $(this).val();
        saveSettingsDebounced();
    });

    $('#cig_generate_btn').on('click', generateImage);
    $('#cig_clear_gallery').on('click', clearGallery);

    $(document).on('click', '.cig_gallery_preview', function () {
        const index = $(this).data('index');
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

    $(document).on('click', '.cig_gallery_delete', async function (e) {
        e.stopPropagation();
        const index = $(this).data('index');
        await deleteGalleryImage(index);
    });

    $(document).on('click', '.cig_appearance_stop', async function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_appearance_item');
        await stopAppearanceLook(row.attr('data-identity-id'), row.attr('data-look-id'));
    });

    $(document).on('click', '.cig_appearance_delete_everywhere', async function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_appearance_item');
        const settings = extension_settings[extensionName];
        const identityId = row.data('identity-id');
        const lookId = row.data('look-id');
        const identity = migrateAppearanceLibrary(settings.rp_library).identities[identityId];
        const look = identity?.looks.find((entry) => entry.id === lookId);
        const actionState = projectAppearanceLookActionState(settings.rp_library, lookId, !!look && !!materializeAppearanceAssets(settings.rp_library, settings.gallery || []).assets[look?.assetId]);
        if (!actionState.available) { toastr.info('Saved look unavailable.', 'Context Image Generation'); return; }
        const plan = planGlobalLookDeletion(settings.rp_library, lookId);
        if (plan.decision === 'not-found') return;
        const warning = 'Delete this saved look everywhere? Other chats may use it. Affected chats will fall back to their avatar or description. This cannot be undone.';
        if (!await confirmDestructiveAction(warning, 'Delete saved look everywhere')) return;
        const operationId = `deletion:${crypto.randomUUID()}`;
        const result = await runGlobalLookDeletion({ lookId, operationId, io: {
            runExclusive: (operation) => enqueueLibraryMutation(operation),
            readLibrary: async () => readPersistedExtensionLibrary({ fetchImpl: fetch, getHeaders: getRequestHeaders }),
            saveLibrary: async (library) => { settings.rp_library = library; await saveSettings(); },
            verifyLibrary: (revision) => verifyPersistedExtensionLibrary({ expectedRevision: revision, fetchImpl: fetch, getHeaders: getRequestHeaders }),
            setLocalLibrary: (library) => { settings.rp_library = library; renderAppearanceList(); },
            deleteFile: (url) => deleteAppearanceFile({ url, fetchImpl: fetch, getHeaders: getRequestHeaders }),
            uuid: () => crypto.randomUUID(),
        } });
        if (result.status === 'confirmed') {
            renderAppearanceList();
            toastr.success(plan.sharedReferenceCount ? `Saved look deleted. ${plan.sharedReferenceCount} other saved look still uses the same file.` : result.message, 'Context Image Generation');
        } else {
            toastr.info(result.message || 'Saved look deletion will retry.', 'Context Image Generation');
        }
    });

    $(document).on('click', '.cig_appearance_use', async function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_appearance_item');
        await useAppearanceLook(row.attr('data-identity-id'), row.attr('data-look-id'));
    });

    $(document).on('click', '.cig_appearance_lock', async function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_appearance_item');
        await toggleAppearanceLookLock(row.attr('data-identity-id'), row.attr('data-look-id'));
    });

    $(document).on('click', '.cig_continuity_outfit_activate', async function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_continuity_identity');
        const outfitId = row.find('.cig_continuity_outfit_select').val();
        if (!outfitId) return;
        try { await activateChatOutfit(row.attr('data-identity-id'), outfitId); }
        catch (error) { showGenerationError(error, 'Activate outfit'); }
    });

    $(document).on('click', '.cig_continuity_outfit_lock', async function (e) {
        e.stopPropagation();
        try { await toggleChatOutfitLock($(this).closest('.cig_continuity_identity').attr('data-identity-id')); }
        catch (error) { showGenerationError(error, 'Change outfit lock'); }
    });

    $(document).on('click', '.cig_continuity_outfit_create', async function (e) {
        e.stopPropagation();
        const row = $(this).closest('.cig_continuity_identity');
        try {
            await createChatOutfit(row.attr('data-identity-id'), row.find('.cig_continuity_outfit_name').val(), row.find('.cig_continuity_outfit_details').val());
        } catch (error) { showGenerationError(error, 'Create outfit'); }
    });

    $(document).on('click', '.cig_visible_canon_remember', async function (e) {
        e.stopPropagation();
        try {
            await visibleCanonDomController().activate(this, e);
        } catch (error) {
            showGenerationError(error, 'Remember character look');
        }
    });

    $(document).on('click', '.cig_visible_canon_change', async function (e) {
        e.stopPropagation();
        const root = $(this).closest('.cig_visible_canon');
        const lookId = root.find('.cig_visible_canon_select').val();
        if (lookId) {
            this.dataset.lookId = lookId;
            await visibleCanonDomController().activate(this, e);
        }
    });

    $(document).on('click', '.cig_visible_canon_lock', async function (e) {
        e.stopPropagation();
        await visibleCanonDomController().activate(this, e);
    });

    $(document).on('click', '.cig_visible_canon_stop', async function (e) {
        e.stopPropagation();
        await visibleCanonDomController().activate(this, e);
    });

    $(document).on('click', '.cig_message_gen', function (e) {
        cigMessageButton($(e.currentTarget));
    });

    document.addEventListener('swiped-left', onCigImageGesture, true);
    document.addEventListener('swiped-right', onCigImageGesture, true);
    document.addEventListener('click', onCigImageArrowClick, true);
    document.addEventListener('keydown', onCigImageArrowKeydown, true);

    bindAppearanceLifecycle({
        eventSource,
        eventTypes: event_types,
        lifecycle: chatLifecycleEpoch,
        readActiveContext: async () => ({
            chatId: getContext().chatId,
            chatMetadata: { [CHAT_CANON_KEY]: chat_metadata[CHAT_CANON_KEY] },
        }),
        render: (view) => { renderAppearanceList(view); refreshVisibleCanonControls(); },
    });

    function onCigMessageRendered(messageId) {
        injectMessageButton(messageId);
        const messageElement = $(`.mes[mesid="${messageId}"]`);
        renderContinuityShelf(messageElement);
        renderSceneInspection(messageElement);
        renderIterationActionSurface(messageElement);
        scheduleImageArrowConfiguration({
            schedule: (callback) => setTimeout(callback, 0),
            reconfigure: () => configureCigImageArrows(messageElement),
        });
    }

    eventSource.on(event_types.CHAT_CHANGED, () => {
        destroyIterationSurfaceMounts();
        setTimeout(() => {
            injectAllMessageButtons();
            renderContinuityShelves();
            $('.mes').each(function () { renderSceneInspection($(this)); });
            $('.mes').each(function () { renderIterationActionSurface($(this)); });
            configureAllCigImageArrows();
            void resumePendingVisibleCanonLinks();
            void resumePendingOutfitState();
            void resumePendingSceneState();
        }, 100);
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        onCigMessageRendered(messageId);
        autoGenerateForMessage(messageId);
    });

    eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
        onCigMessageRendered(messageId);
        autoGenerateForMessage(messageId);
    });

    eventSource.on(event_types.CHAT_CREATED, () => {
        destroyIterationSurfaceMounts();
        setTimeout(() => { injectAllMessageButtons(); renderContinuityShelves(); $('.mes').each(function () { renderSceneInspection($(this)); renderIterationActionSurface($(this)); }); }, 100);
    });

    setTimeout(() => {
        injectAllMessageButtons();
        renderContinuityShelves();
        $('.mes').each(function () { renderSceneInspection($(this)); });
        $('.mes').each(function () { renderIterationActionSurface($(this)); });
        configureAllCigImageArrows();
    }, 500);

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

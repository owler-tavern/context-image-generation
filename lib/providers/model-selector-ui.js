import { projectModelSelectorLists } from './ui-projection.js';
import { rememberImageModel } from '../setup-connection-state.js';

export function setControlBusyState($, control, busy, { busyClass = 'generating', busyTitle = 'Working…' } = {}) {
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

export function cancelModelRefreshUi($, { providerId, cancelDiscovery } = {}) {
    const cancelled = cancelDiscovery?.(providerId) === true;
    setControlBusyState($, $('#cig_model_refresh'), false);
    return cancelled;
}

function appendOptions($, selector, models, selectedModelId, labelForModel) {
    const control = $(selector).empty();
    if (selector === '#cig_model') control.append($('<option>').val('').text('Choose an image model'));
    for (const model of models) {
        control.append($('<option>').val(model.id).text(labelForModel(model)));
    }
    control.val(selectedModelId || '');
    return models;
}

export function renderSetupModelSelector($, { models = [], selectedModelId = '' } = {}) {
    const { setup } = projectModelSelectorLists({ models });
    return appendOptions($, '#cig_model', setup, selectedModelId, (model) => model.label || model.id);
}

export function renderManagedModelSelector($, {
    models = [], selectedModelId = '', search = '', labelForModel = (model) => model.label || model.id,
} = {}) {
    const { managed } = projectModelSelectorLists({ models, managedSearch: search });
    return appendOptions($, '#cig_managed_model_list', managed, selectedModelId, labelForModel);
}

export function bindModelSelectorUi($, { onRefresh, onManagedSearch, onModelChange } = {}) {
    $('#cig_model_refresh').on('click', function (event) {
        return onRefresh?.(event);
    });
    $('#cig_model_search').on('input', function (event) {
        return onManagedSearch?.(event);
    });
    $('#cig_model').on('change', function (event) {
        return onModelChange?.($(this).val() || '', event);
    });
}

/** Own the primary selector state transition and its production UI side effects. */
export function createModelSelectorController($, {
    getSettings,
    getModelContext,
    getSelectedRoute,
    cancelDiscovery,
    clearPreflight,
    clearRuntimeIssue,
    renderCapabilityUi,
    renderReadinessUi,
    renderModelManagerUi,
    renderAppearanceUi,
    persistSettings,
} = {}) {
    const updateModelDropdown = () => {
        const settings = getSettings?.();
        const context = getModelContext?.(settings);
        if (!settings || !context || !Array.isArray(context.models)) return context;
        settings.model = context.selectedModelId || settings.model || '';
        renderSetupModelSelector($, { models: context.models, selectedModelId: settings.model });
        renderCapabilityUi?.(settings, context);
        renderReadinessUi?.(settings, context);
        return { ...context, settings };
    };

    const selectSetupModel = (modelId) => {
        const settings = getSettings?.();
        if (!settings) return;
        const providerId = settings.provider || 'makersuite';
        const previousRoute = getSelectedRoute?.(settings, settings.model);
        cancelDiscovery?.(providerId);
        clearPreflight?.(previousRoute);
        rememberImageModel(settings, modelId);
        clearRuntimeIssue?.();
        renderCapabilityUi?.(settings);
        renderReadinessUi?.(settings);
        renderModelManagerUi?.();
        renderAppearanceUi?.();
        persistSettings?.();
    };

    const bind = ({ onRefresh } = {}) => bindModelSelectorUi($, {
        onRefresh,
        onManagedSearch: renderModelManagerUi,
        onModelChange: selectSetupModel,
    });

    return Object.freeze({ bind, selectSetupModel, updateModelDropdown });
}

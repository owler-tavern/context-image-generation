import { projectModelSelectorLists } from './ui-projection.js';

function appendOptions($, selector, models, selectedModelId, labelForModel) {
    const control = $(selector).empty();
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

/** Only deliberate activation changes the provider used by the next generation. */
export function activateImageConnection(settings, providerId) {
    if (!providerId || typeof providerId !== 'string') return;
    const choices = { ...(settings.connection_models || {}) };
    if (settings.provider) choices[settings.provider] = settings.model || '';
    settings.connection_models = choices;
    settings.provider = providerId;
    settings.model = Object.hasOwn(choices, providerId) ? choices[providerId] : '';
}

export function rememberImageModel(settings, modelId) {
    settings.model = typeof modelId === 'string' ? modelId : '';
    settings.connection_models = { ...(settings.connection_models || {}), [settings.provider]: settings.model };
}

/** Unclassified catalogs remain browsable; filtering never loses the active ID. */
export function projectSetupModels(models, { selectedModelId = '', query = '', showAll = false } = {}) {
    const all = Array.isArray(models) ? models.filter(model => model?.id) : [];
    const known = all.filter(model => model.knownImage === true);
    const visible = showAll || !known.length ? all : all.filter(model => model.knownImage || model.id === selectedModelId);
    const search = String(query).trim().toLowerCase();
    return visible.filter(model => model.id === selectedModelId || !search || `${model.id} ${model.label || ''}`.toLowerCase().includes(search));
}

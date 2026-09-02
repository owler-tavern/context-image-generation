function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function equivalentValue(current, migrated) {
    if (Object.is(current, migrated)) return true;
    if (Array.isArray(current) || Array.isArray(migrated)) {
        return Array.isArray(current)
            && Array.isArray(migrated)
            && current.length === migrated.length
            && current.every((value, index) => equivalentValue(value, migrated[index]));
    }
    if (!isRecord(current) || !isRecord(migrated)) return false;
    const currentKeys = Object.keys(current);
    const migratedKeys = Object.keys(migrated);
    return currentKeys.length === migratedKeys.length
        && currentKeys.every((key, index) => key === migratedKeys[index] && equivalentValue(current[key], migrated[key]));
}

function equivalentKnownRecord(current, migrated, keys) {
    if (!isRecord(current) || !isRecord(migrated)) return false;
    const allowed = new Set(keys);
    const currentKeys = Object.keys(current);
    const migratedKeys = Object.keys(migrated);
    return currentKeys.length === migratedKeys.length
        && currentKeys.every((key, index) => allowed.has(key) && key === migratedKeys[index] && equivalentValue(current[key], migrated[key]));
}

export function replaceWhenChanged(current, migrate, equivalent) {
    const migrated = migrate(current);
    return equivalent(current, migrated)
        ? { value: current, changed: false }
        : { value: migrated, changed: true };
}

/**
 * Applies extension defaults without interpreting or cloning persisted fields.
 * Unknown legacy values therefore keep their exact JSON structure on an
 * unrelated load/save round trip.
 */
export function loadExtensionSettings(defaults, stored) {
    const settings = isRecord(stored) ? stored : {};
    let changed = !isRecord(stored);
    for (const [key, value] of Object.entries(isRecord(defaults) ? defaults : {})) {
        if (settings[key] === undefined) {
            settings[key] = value;
            changed = true;
        }
    }
    return { settings, changed };
}

/** Uses the extension's actual save callback while leaving opaque fields inert. */
export async function persistExtensionSettings(settings, save) {
    if (!isRecord(settings) || typeof save !== 'function') throw new TypeError('Extension settings and a save callback are required.');
    await save(settings);
    return settings;
}

export function providerSettingsEquivalent(current, migrated) {
    return current?.provider_contracts_version === migrated?.provider_contracts_version
        && equivalentValue(current, migrated);
}

export function extraStoryToolsEquivalent(current, migrated) {
    return equivalentKnownRecord(current, migrated, [
        'enabled',
        'storyMemory',
        'appearanceMemory',
        'cinematic',
        'iteration',
        'gallery',
    ]);
}

export function appearanceLibraryEquivalent(current, migrated) {
    return current?.schema === migrated?.schema
        && equivalentKnownRecord(current, migrated, [
            'schema',
            'identities',
            'assets',
            'preferences',
            'operations',
            'revision',
        ]);
}

export function outfitCatalogEquivalent(current, migrated) {
    return current?.schema === migrated?.schema
        && equivalentKnownRecord(current, migrated, ['schema', 'outfits']);
}

export function outfitPendingStateEquivalent(current, migrated) {
    return current?.schema === migrated?.schema
        && equivalentKnownRecord(current, migrated, ['schema', 'pending']);
}

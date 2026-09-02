export const GENERATION_SOURCES = Object.freeze(['wand', 'slash']);
export const DELIVERY_DESTINATIONS = Object.freeze(['message', 'preview-gallery']);

export function normalizeGenerationRequest(value = {}) {
    const source = String(value.source || '');
    const destination = String(value.destination || '');
    const prompt = String(value.prompt || '').trim();
    if (!GENERATION_SOURCES.includes(source)) throw new Error(`Unsupported generation source: ${source || 'missing'}`);
    if (!DELIVERY_DESTINATIONS.includes(destination)) throw new Error(`Unsupported delivery destination: ${destination || 'missing'}`);
    if (!prompt) throw new Error('Generation prompt is required');
    if (source === 'wand' && destination !== 'message') throw new Error('Wand generation requires message delivery');
    if (source === 'slash' && destination !== 'preview-gallery') throw new Error('Slash generation requires preview-gallery delivery');
    return Object.freeze({ ...value, source, destination, prompt });
}

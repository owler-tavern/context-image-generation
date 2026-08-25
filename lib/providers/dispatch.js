import { buildGeminiProxyRequest } from './gemini-proxy.js';

/**
 * Dispatch a resolved declarative provider route through its transport handler.
 * Request functions are injected by the SillyTavern integration layer so this
 * module remains deterministic and independently testable.
 */
export async function dispatchProviderRoute({
    route,
    modelId,
    messages,
    prompt,
    apiKey,
    aspectRatio,
    imageSize,
    isFlash2,
    thinkingLevel,
    useGoogleSearch,
    mapAspectRatioToSize,
    requestOpenAiImages,
    requestSillyTavernImage,
}) {
    const { provider, model, transport } = route;

    if (transport === 'sillyTavernGeminiProxy') {
        return await requestSillyTavernImage(buildGeminiProxyRequest({
            model: modelId,
            messages,
            apiKey,
            baseUrl: provider.transports.sillyTavernGeminiProxy.baseUrl,
            aspectRatio,
            imageSize,
            isFlash2,
            thinkingLevel,
            useGoogleSearch,
        }));
    }

    if (transport === 'openAiImages') {
        return await requestOpenAiImages({
            apiKey,
            model: modelId,
            prompt,
            size: model.supportsSize ? mapAspectRatioToSize(aspectRatio) : undefined,
            baseUrl: provider.transports.openAiImages.baseUrl,
        });
    }

    throw new Error(`No ${provider.id} handler is configured for transport: ${transport}`);
}
import { normalizeGenerationRequest } from './contracts.js';

/**
 * Create the shared generation transaction.
 *
 * Task 4 composes these dependencies from the current production seams:
 * - capture: captureGenerationSnapshot
 * - collectReferences: materializeSnapshotAssets and optional contributors
 * - createPlan: GenerationPlan/message construction currently involving buildMessages
 * - dispatch: the provider-dispatch adapter
 * - coordinate: generationCoordinator.enqueue
 *
 * This module intentionally contains no host/UI knowledge and does not map legacy
 * invocation names into the two ADR-002 sources.
 */
export function createSceneGenerationKernel(dependencies) {
    const {
        capture,
        collectReferences,
        createPlan,
        coordinate,
        dispatch,
        generationKey,
        normalizeError = (error) => error,
    } = dependencies;

    return Object.freeze({
        async generate(value) {
            try {
                const request = normalizeGenerationRequest(value);
                const snapshot = await capture(request);
                const references = await collectReferences(snapshot, request);
                const plan = createPlan({ snapshot, references, request });
                const artifact = await coordinate(generationKey(request, snapshot), (signal) => dispatch(plan, signal), plan);
                return Object.freeze({ artifact, plan, request });
            } catch (error) {
                throw normalizeError(error, 'scene-generation');
            }
        },
    });
}

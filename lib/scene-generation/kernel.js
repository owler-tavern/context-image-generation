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
        coordinateEarly,
        dispatch,
        generationKey,
        createCoordinationPlan = ({ snapshot }) => snapshot?.planInput,
        normalizeError = (error) => error,
    } = dependencies;

    return Object.freeze({
        async generate(value, { deliver } = {}) {
            try {
                const request = normalizeGenerationRequest(value);
                const snapshot = await capture(request);
                const coordinationPlan = createCoordinationPlan({ snapshot, request });
                let plan;
                let execution;
                const execute = async (signal, context = {}) => {
                    execution = context;
                    const dependencyContext = Object.freeze({ signal, runId: context.runId, telemetry: context.telemetry });
                    const references = await collectReferences(snapshot, request, dependencyContext);
                    plan = createPlan({ snapshot, references, request });
                    const artifact = await dispatch(plan, signal, dependencyContext);
                    if (typeof deliver === 'function') context.beginCommit?.();
                    const deliveryResult = typeof deliver === 'function'
                        ? await deliver({ artifact, plan, request, signal, telemetry: context.telemetry })
                        : undefined;
                    return { artifact, deliveryResult, stale: deliveryResult === false };
                };
                let outcome;
                if (typeof coordinateEarly === 'function') {
                    outcome = await coordinateEarly(
                        generationKey(request, snapshot),
                        execute,
                        coordinationPlan,
                    );
                } else {
                    // Compatibility path: coordinate(key, run, finalPlan) retains its
                    // established final-plan third argument for external consumers.
                    const references = await collectReferences(snapshot, request);
                    plan = createPlan({ snapshot, references, request });
                    outcome = await coordinate(generationKey(request, snapshot), async (signal, context = {}) => {
                        execution = context;
                        const dependencyContext = Object.freeze({ signal, runId: context.runId, telemetry: context.telemetry });
                        const artifact = await dispatch(plan, signal, dependencyContext);
                        if (typeof deliver === 'function') context.beginCommit?.();
                        const deliveryResult = typeof deliver === 'function'
                            ? await deliver({ artifact, plan, request, signal, telemetry: context.telemetry })
                            : undefined;
                        return { artifact, deliveryResult, stale: deliveryResult === false };
                    }, plan);
                }
                return Object.freeze({ artifact: outcome?.artifact, plan, request, telemetry: execution?.telemetry, deliveryResult: outcome?.deliveryResult });
            } catch (error) {
                throw normalizeError(error, 'scene-generation');
            }
        },
    });
}

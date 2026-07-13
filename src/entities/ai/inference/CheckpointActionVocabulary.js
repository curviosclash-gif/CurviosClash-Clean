import { HYBRID_INTENT_TYPES } from '../hybrid/HybridDecisionArchitecture.js';

const CHECKPOINT_ACTION_TEMPLATE = Object.freeze({
    yawLeft: false,
    yawRight: false,
    pitchUp: false,
    pitchDown: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    shootMG: false,
    shootItem: false,
    shootItemIndex: -1,
    useItem: -1,
    dropItem: false,
    nextItem: false,
});

function createCheckpointAction(overrides = {}) {
    return {
        ...CHECKPOINT_ACTION_TEMPLATE,
        ...overrides,
    };
}

function createCheckpointTemplate(intent, action) {
    return Object.freeze({
        intent,
        action: createCheckpointAction(action),
    });
}

function toCheckpointActionCount(checkpoint = {}) {
    const directCount = Number(checkpoint?.actionCount);
    if (Number.isInteger(directCount) && directCount > 0) {
        return directCount;
    }
    const outputSize = Number(checkpoint?.online?.outputSize);
    if (Number.isInteger(outputSize) && outputSize > 0) {
        return outputSize;
    }
    return 0;
}

export function resolveRuntimePlanarMode(runtimeContext = {}, fallback = false) {
    if (typeof runtimeContext?.rules?.planarMode === 'boolean') return runtimeContext.rules.planarMode;
    if (typeof runtimeContext?.planarMode === 'boolean') return runtimeContext.planarMode;
    return fallback;
}

export function resolveRuntimeDomainId(runtimeContext = {}) {
    const domainId = runtimeContext?.rules?.domainId ?? runtimeContext?.domainId;
    return typeof domainId === 'string' && domainId.trim() ? domainId.trim() : null;
}

export function createCheckpointActionVocabulary(checkpoint = {}) {
    const maxItemIndexRaw = Number(checkpoint?.maxItemIndex);
    const maxItemIndex = Number.isInteger(maxItemIndexRaw) && maxItemIndexRaw >= 0
        ? maxItemIndexRaw
        : 0;
    const checkpointPlanarMode = checkpoint?.planarMode === true;
    const templates = [
        createCheckpointTemplate(HYBRID_INTENT_TYPES.STABILIZE, {}),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.EVADE, { yawLeft: true }),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.EVADE, { yawRight: true }),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.CHASE, { yawLeft: true, boost: true }),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.CHASE, { yawRight: true, boost: true }),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.CHASE, { boost: true }),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.COMBAT, { shootMG: true }),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.COMBAT, { yawLeft: true, shootMG: true }),
        createCheckpointTemplate(HYBRID_INTENT_TYPES.COMBAT, { yawRight: true, shootMG: true }),
    ];

    if (!checkpointPlanarMode) {
        templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.EVADE, { pitchUp: true }));
        templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.EVADE, { pitchDown: true }));
        templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.CHASE, { pitchUp: true, boost: true }));
        templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.CHASE, { pitchDown: true, boost: true }));
    }

    for (let i = 0; i <= maxItemIndex; i += 1) {
        templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.COMBAT, { shootItem: true, shootItemIndex: i }));
    }
    for (let i = 0; i <= maxItemIndex; i += 1) {
        templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.ITEM_USE, { useItem: i }));
    }
    templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.ITEM_USE, { nextItem: true }));
    templates.push(createCheckpointTemplate(HYBRID_INTENT_TYPES.ITEM_USE, { dropItem: true }));

    const actionCount = toCheckpointActionCount(checkpoint);
    if (actionCount > 0 && actionCount !== templates.length) {
        return null;
    }

    return {
        decodeWithMetadata(index, context = {}) {
            const normalizedIndex = Number.isInteger(index)
                ? Math.max(0, Math.min(templates.length - 1, index))
                : 0;
            const template = templates[normalizedIndex] || templates[0];
            const planarMode = typeof context?.planarMode === 'boolean'
                ? context.planarMode
                : checkpointPlanarMode;
            const action = !planarMode
                ? { ...template.action }
                : {
                    ...template.action,
                    pitchUp: false,
                    pitchDown: false,
                    rollLeft: false,
                    rollRight: false,
                };
            return {
                action,
                metadata: {
                    intent: template.intent,
                    templateIndex: normalizedIndex,
                },
            };
        },
        decode(index, context = {}) {
            return this.decodeWithMetadata(index, context).action;
        },
    };
}

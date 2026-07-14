import {
    DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
    liftObservationWithRuntimeNearContext,
} from '../observation/RuntimeNearObservationAdapter.js';
import { OBSERVATION_SCHEMA_VERSION_V2 } from '../observation/ObservationSchemaV2.js';
import { toFiniteNumber } from '../../../utils/MathOps.js';

export const RUNTIME_INFERENCE_DOMAIN_VERSION = 'mode-planar-control-v2';

function cloneObservation(observation) {
    if (!observation || typeof observation.length !== 'number') return null;
    const length = Math.max(0, Math.trunc(observation.length));
    const cloned = new Array(length);
    for (let index = 0; index < length; index += 1) {
        cloned[index] = toFiniteNumber(observation[index], 0);
    }
    return cloned;
}

function normalizeMode(mode) {
    const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
    if (normalized === 'hunt' || normalized === 'fight') return normalized;
    return 'classic';
}

function resolvePlanarMode(runtimeContext = {}) {
    if (runtimeContext?.rules && typeof runtimeContext.rules === 'object') {
        return runtimeContext.rules.planarMode === true;
    }
    return runtimeContext.planarMode === true;
}

function resolveControlProfileId(runtimeContext, mode, dimension) {
    const direct = typeof runtimeContext?.controlProfileId === 'string'
        ? runtimeContext.controlProfileId.trim().toLowerCase()
        : '';
    if (direct) return direct;
    const rulesValue = typeof runtimeContext?.rules?.controlProfileId === 'string'
        ? runtimeContext.rules.controlProfileId.trim().toLowerCase()
        : '';
    return rulesValue || `legacy-v1:${mode === 'fight' ? 'hunt' : mode}-${dimension}`;
}

function buildPlayerPayload(player) {
    if (!player || typeof player !== 'object') return null;
    return {
        index: Number.isInteger(player.index) ? player.index : -1,
        hp: toFiniteNumber(player.hp, 0),
        maxHp: toFiniteNumber(player.maxHp, 0),
        shieldHp: toFiniteNumber(player.shieldHP, 0),
        maxShieldHp: toFiniteNumber(player.maxShieldHp, 0),
        inventoryLength: Array.isArray(player.inventory)
            ? player.inventory.length
            : Math.max(0, Math.trunc(toFiniteNumber(player.inventoryLength, 0))),
    };
}

export function buildRuntimeInferenceObservationPayload(runtimeContext = {}, player = null) {
    const mode = normalizeMode(runtimeContext?.mode);
    const planarMode = resolvePlanarMode(runtimeContext);
    const dimension = planarMode ? '2d' : '3d';
    const controlProfileId = resolveControlProfileId(runtimeContext, mode, dimension);
    const lifted = liftObservationWithRuntimeNearContext(runtimeContext?.observation, {
        expectedLength: DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
        environmentProfile: runtimeContext?.environmentProfile || undefined,
        metadata: runtimeContext?.observationContext,
        player,
    });

    return {
        mode,
        planarMode,
        controlProfileId,
        domainId: `${mode}-${dimension}`,
        domainVersion: RUNTIME_INFERENCE_DOMAIN_VERSION,
        dt: toFiniteNumber(runtimeContext?.dt, 0),
        observationSchemaVersion: OBSERVATION_SCHEMA_VERSION_V2,
        observationLength: DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH,
        observation: cloneObservation(lifted.observation),
        observationContext: lifted.details,
        player: buildPlayerPayload(player),
    };
}

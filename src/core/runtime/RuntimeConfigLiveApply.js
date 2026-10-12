import { CONFIG_BASE } from '../Config.js';
import { applyRuntimeConfigCompatibility } from '../RuntimeConfig.js';
import { createEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { applyRuntimeSettingsState } from './GameRuntimeBundle.js';

/**
 * Swaps the runtime config of a running match without a restart: compatibility config,
 * session state and the live entity config all follow the new snapshot. Arcade sector
 * changes and live map balancing both go through here.
 * @param {any} runtimeBundle
 * @param {any} runtimeState
 * @param {any} nextRuntimeConfig
 * @returns {any} nextRuntimeConfig
 */
export function applyRuntimeConfigLive(runtimeBundle, runtimeState, nextRuntimeConfig) {
    const session = nextRuntimeConfig?.session || {};
    const nextCompatibilityConfig = applyRuntimeConfigCompatibility(nextRuntimeConfig, CONFIG_BASE);
    applyRuntimeSettingsState(runtimeBundle, {
        runtimeConfig: nextRuntimeConfig,
        config: nextCompatibilityConfig,
        session: {
            mapKey: session.mapKey,
            numBots: session.numBots,
            numHumans: session.numHumans,
            winsNeeded: session.winsNeeded,
            activeGameMode: session.activeGameMode,
        },
    });
    const entityManager = runtimeState?.entityManager;
    entityManager?.applyLiveRuntimeConfig?.(
        createEntityRuntimeConfig(nextRuntimeConfig, nextCompatibilityConfig),
        nextRuntimeConfig
    );
    entityManager?.setBotDifficulty?.(nextRuntimeConfig?.bot?.activeDifficulty);
    return nextRuntimeConfig;
}

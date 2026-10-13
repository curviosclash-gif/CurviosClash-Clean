// Sync of the Arcade run state into the mode strategy (modifier, sector type, upgrades, rewards,
// sudden death), moved out of ArcadeRunRuntime unchanged. `runtime` is the ArcadeRunRuntime.
import { ARCADE_RUN_PHASES } from '../../state/arcade/ArcadeRunState.js';
import { resolveArcadeRunStrategyUpgradeBonuses } from './ArcadeRunVehicleRewardOps.js';
import { syncArcadeRunRewardEffects } from './ArcadeIntermissionEffects.js';

export function setArcadeRunStrategy(runtime, strategy, humanPlayers = null) {
    runtime._strategy = strategy || null;
    if (!runtime._strategy) return;
    try { runtime._strategy.setActiveModifier?.(runtime._activeModifierId); } catch { /* no-op */ }
    try { runtime._strategy.setSectorType?.(runtime._currentSectorType); } catch { /* no-op */ }
    try { runtime._strategy.setScenarioId?.(runtime._getEncounterSectorEntry(runtime._state?.sectorIndex)?.scenarioId || null); } catch { /* no-op */ }
    const profile = runtime.getVehicleProfile();
    try {
        runtime._strategy.applyVehicleUpgrades?.(resolveArcadeRunStrategyUpgradeBonuses(
            runtime,
            humanPlayers,
            runtime._getVehicleBonuses(profile),
            !runtime._usesProfileBuild()
        ));
    } catch { /* no-op */ }
    syncArcadeRunRewardEffects(runtime._state, runtime._strategy);
    if (runtime._state?.phase === ARCADE_RUN_PHASES.SUDDEN_DEATH) {
        runtime._restoreSuddenDeath();
    }
}

export function resetArcadeRunStrategyState(runtime) {
    const strategy = runtime._strategy;
    if (!strategy || typeof strategy !== 'object') return;
    try { strategy.exitSuddenDeath?.(); } catch { /* no-op */ }
    try { strategy.setActiveModifier?.(null); } catch { /* no-op */ }
    try { strategy.setSectorType?.(null); } catch { /* no-op */ }
    try { strategy.setScenarioId?.(null); } catch { /* no-op */ }
    try { strategy.applyVehicleUpgrades?.(null); } catch { /* no-op */ }
    syncArcadeRunRewardEffects(null, strategy);
}

export function restoreArcadeSuddenDeath(runtime) {
    runtime._strategy?.enterSuddenDeath?.();
    runtime._strategy?.tickSuddenDeath?.(Math.max(0, (runtime._state.gameplayTimeMs - runtime._state.suddenDeathStartedAtMs) / 1000));
}

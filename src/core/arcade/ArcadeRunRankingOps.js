import { loadVehicleProfiles, getArcadeRunVehicleBonuses } from '../../state/arcade/ArcadeVehicleProfile.js';
import { createArcadeRankContext, loadArcadeDifficultyProgress, resolveArcadeRunTier } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { ARCADE_RUN_KINDS, resolveArcadeRuntimeKind } from '../../shared/contracts/ArcadeRunTypeDispatchContract.js';
import { createArcadeVehicleUpgradeBonusMap } from './ArcadeRunVehicleRewardOps.js';
import { createArcadeColorProgress } from '../../shared/contracts/ArcadeColorProgressContract.js';

function runFor(support, state, kind) {
    if (kind === ARCADE_RUN_KINDS.ENDLESS_PARCOURS) return support._getEndlessRuntime?.(state);
    if (kind === ARCADE_RUN_KINDS.ARENA_WAVES) return support.arenaWavesRuntime;
    if (kind === ARCADE_RUN_KINDS.FIVE_PORTALS) return support.fivePortalsRuntime;
    return support.arcadeRunRuntime;
}

/** Resolve only once per run; session rebuilds use the same vehicle, level and effective build. */
export function prepareArcadeRunRanking(support, state, config, runActive, playerBonuses) {
    if (!config?.arcade?.enabled) return null;
    const kind = resolveArcadeRuntimeKind(config);
    if (kind === ARCADE_RUN_KINDS.WEAPON_RACE || kind === ARCADE_RUN_KINDS.DEMOLITION) return null;
    const runtime = runFor(support, state, kind);
    if (!runtime) return null;
    const strategy = state?.entityManager?.gameModeStrategy;
    if (!runActive || !runtime.rankContext) {
        const bindings = support.arcadeRunRuntime;
        const fallbackStore = support.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
        const store = bindings._playerStoresByIndex?.[0] || fallbackStore;
        const effectiveBonuses = playerBonuses || createArcadeVehicleUpgradeBonusMap(loadVehicleProfiles(store),
            state?.entityManager?.humanPlayers, { store, buildOnly: true });
        const vehicleId = String(config.player?.vehicles?.PLAYER_1 || 'ship5');
        const profile = bindings._playerProfilesByIndex?.[0]?.[vehicleId] || loadVehicleProfiles(store)[vehicleId];
        const progress = loadArcadeDifficultyProgress(store);
        const runType = config.arcade.runType || kind;
        const tierId = resolveArcadeRunTier(config.arcade.difficultyTierId, progress.progress, { runType, dailyChallenge: config.arcade.dailyChallenge });
        runtime.rankContext = createArcadeRankContext({ runId: `${Date.now()}-${config.arcade.seed || 0}`, runType,
            vehicleId, profile, stoneSteps: playerBonuses?.byPlayerIndex?.[0]?.build?.stoneSteps || getArcadeRunVehicleBonuses(profile, store)?.build?.stoneSteps,
            tierId, dailyChallenge: config.arcade.dailyChallenge });
        runtime._rankingStore = store;
        const humans = state?.entityManager?.humanPlayers || [];
        runtime._colorProgress = createArcadeColorProgress({ runType, tierId, dailyChallenge: config.arcade.dailyChallenge,
            humanIndices: humans.filter(player => !player.isBot).map(player => player.index),
            storesByIndex: Object.fromEntries(humans.map(player => [player.index, bindings._playerStoresByIndex?.[player.index] || store])) });
        runtime._frozenPlayerBuildBonuses = effectiveBonuses ? structuredClone(effectiveBonuses) : null;
    }
    if (runtime.rankContext.ranked || runtime.rankContext.runType === 'hangar_test') {
        if (strategy) strategy._botRankBonuses = Object.freeze({ turningBonusPct: 0, speedBonusPct: 0, maxHpBonus: 0, botStrength: runtime.rankContext.botStrength });
        if (strategy) strategy._frozenArcadeBuildBonuses = runtime._frozenPlayerBuildBonuses;
        if (runtime._frozenPlayerBuildBonuses) strategy?.applyVehicleUpgrades?.(runtime._frozenPlayerBuildBonuses);
    }
    return runtime.rankContext;
}

import { PLAYER_LABEL_STYLES, formatPlayerDisplayLabel } from '../../shared/contracts/PlayerDisplayLabelContract.js';
import { isWeaponRaceConfig } from '../../shared/contracts/WeaponRaceContract.js';
import { resolveObjectiveTargetIndex } from '../../entities/systems/ObjectiveTargetMarkerOps.js';
import { doesArcadeObjectiveHoldRound } from '../../state/arcade/ArcadeObjectiveState.js';
import { buildArcadeSectorPlan } from '../../entities/directors/ArcadeEncounterCatalog.js';
import { getRuntimeMapCatalog } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { prepareArcadePlayerProfileBindings } from '../arcade/ArcadePlayerProfileBindings.js';
import { applyArcadeRuntimeCosmetics } from '../arcade/ArcadeRuntimeCosmeticOps.js';
import { shouldBindLocalArcadePlayerProfiles } from './GameRuntimeArcadeRunDispatch.js';
import { ARCADE_RUN_KINDS, resolveArcadeRuntimeKind } from '../../shared/contracts/ArcadeRunTypeDispatchContract.js';
import { prepareArcadeRunRanking } from '../arcade/ArcadeRunRankingOps.js';
import { loadArcadeDifficultyProgress, resolveArcadeRunTier } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { resolvePlayerRecordStorePortForIndex } from './PlayerProfileRuntimeAccess.js';
import { resolveActiveArcadeCompanionCount } from '../../shared/contracts/ArcadeCompanionContract.js';

export function resolveArcadeP1RecordStore(support, config) {
    const id = String(config?.arcade?.playerProfileIds?.[0] || '').trim();
    return id ? resolvePlayerRecordStorePortForIndex(support.game?.playerProfileManager, 0, id)
        : support.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
}

/**
 * Hands the live arcade objective to the entity layer, which must not read arcade state itself:
 * the bounty target for the marker and whether the objective holds the round open.
 */
export function syncArcadeObjectiveIntoEntities(entityManager, objectiveState) {
    entityManager?._roundOutcomeSystem?.setObjectiveHold?.(doesArcadeObjectiveHoldRound(objectiveState));
    const markerSystem = entityManager?._objectiveTargetMarkerSystem || null;
    return markerSystem ? markerSystem.setTarget(resolveObjectiveTargetIndex(objectiveState)) : null;
}

export function configureArcadeRunRuntime(runtime, runtimeConfig) {
    if (runtimeConfig?.arcade?.runType === 'hangar_test') return runtime.configure({ ...runtimeConfig, arcade: { ...runtimeConfig.arcade, replayHooksEnabled: false, ghostDuelMode: 'off' } });
    if (!isWeaponRaceConfig(runtimeConfig)) return runtime.configure(runtimeConfig);
    return runtime.configure({
        ...runtimeConfig,
        arcade: { ...runtimeConfig.arcade, ghostDuelMode: 'self_best_time_ghost', ghostTrailCollisionEnabled: false },
    });
}

export function bindLocalArcadeProfilesAndApplyCosmetics(support, runtimeState, runtimeConfig) {
    const kind = resolveArcadeRuntimeKind(runtimeConfig);
    const arcadeRuntime = support.arcadeRunRuntime;
    const endlessRuntime = kind === ARCADE_RUN_KINDS.ENDLESS_PARCOURS
        ? support._getEndlessRuntime?.(runtimeState)
        : null;
    const runtimeForKind = kind === ARCADE_RUN_KINDS.FIVE_PORTALS
        ? support.fivePortalsRuntime
        : kind === ARCADE_RUN_KINDS.ARENA_WAVES
            ? support.arenaWavesRuntime
            : kind === ARCADE_RUN_KINDS.WEAPON_RACE
                ? support.weaponRaceRuntime
                : null;
    const runActive = kind === ARCADE_RUN_KINDS.GAUNTLET
        ? Boolean(arcadeRuntime?._state && !arcadeRuntime._state.finishedAtIso)
        : kind === ARCADE_RUN_KINDS.ENDLESS_PARCOURS
            ? Boolean(endlessRuntime?.startProfile && endlessRuntime?._finalized !== true)
            : Boolean(runtimeForKind
                && runtimeForKind.phase !== 'idle'
                && runtimeForKind.phase !== 'finished');
    prepareArcadePlayerProfileBindings(
        arcadeRuntime,
        runtimeState?.entityManager?.humanPlayers,
        runtimeConfig?.arcade?.playerProfileIds,
        shouldBindLocalArcadePlayerProfiles(runtimeConfig),
        runActive,
    );
    const playerBuildBonuses = applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig);
    prepareArcadeRunRanking(support, runtimeState, runtimeConfig, runActive, playerBuildBonuses);
    return { playerBuildBonuses };
}

/** Plane of a local human by player index; bots have no PLAYER_n slot and get null. */
export function resolveLocalPlayerVehicleId(runtimeState, playerIndex) {
    return runtimeState?.runtimeConfig?.player?.vehicles?.[`PLAYER_${(Number(playerIndex) || 0) + 1}`] || null;
}

export function resolveActiveArcadeVehicleId(runtimeConfig, settings) {
    return String(runtimeConfig?.player?.vehicles?.PLAYER_1 || settings?.vehicles?.PLAYER_1 || 'ship5').trim() || 'ship5';
}

export function resolveArenaStartMachineGunId(context, runtimeState) {
    const human = runtimeState?.entityManager?.humanPlayers?.[0];
    return context?.playerBuildBonuses?.byPlayerIndex?.[human?.index]?.build?.selectedMachineGunId
        || context?.playerBuildBonuses?.byVehicleId?.[human?.vehicleId]?.build?.selectedMachineGunId
        || human?.fightLoadout?.machineGunId;
}

export function buildArcadeEncounterPlan(runtimeConfig, store = null) {
    const tierId = resolveArcadeRunTier(runtimeConfig?.arcade?.difficultyTierId, loadArcadeDifficultyProgress(store).progress, {
        runType: runtimeConfig?.arcade?.runType || 'gauntlet', dailyChallenge: runtimeConfig?.arcade?.dailyChallenge === true,
    });
    const plan = buildArcadeSectorPlan({
        seed: runtimeConfig?.arcade?.seed,
        sectorCount: runtimeConfig?.arcade?.sectorCount,
        difficulty: tierId === 'any' ? 'normal' : tierId,
        dailyChallenge: runtimeConfig?.arcade?.dailyChallenge === true,
    });
    return { ...lockSelectedMapToFirstSector(plan, runtimeConfig, getRuntimeMapCatalog()), tierId };
}

export function handleWeaponRaceLeaderboard(support, runtimeState, data) {
    if (data?.type === 'round_outcome') return support.weaponRaceRuntime.getRoundOutcome(data.now);
    const humanIndexes = runtimeState?.entityManager?.humanPlayers?.map((player) => player?.index) || [];
    if (data?.type === 'finish' && !humanIndexes.includes(data?.playerIndex)) return null;
    const result = support.arcadeRunRuntime.applyParcoursLeaderboardEvent(
        data?.type === 'finish' ? { ...data, awardBestXp: false } : data
    );
    if (data?.type === 'finish' && result?.isBestTime) support.weaponRaceRuntime.handleNewBest(data.playerIndex);
    return result;
}

export function lockSelectedMapToFirstSector(plan, runtimeConfig, mapCatalog) {
    if (!plan || !Array.isArray(plan.sequence) || plan.sequence.length === 0) return plan;
    if (runtimeConfig?.arcade?.dailyChallenge === true) return plan;
    if (runtimeConfig?.arcade?.runType === 'hangar_test') return { ...plan, sequence: [{ ...plan.sequence[0], templateId: 'sector_intro', squadId: 'hunter_pack', objectiveId: 'clean_sector', modifierId: null, mapKey: 'parcours_assault', mapKeyLocked: true, isBoss: false, bossMultiplier: 1, parcoursEnabled: false }] };
    const selectedMapKey = String(runtimeConfig?.session?.mapKey || '').trim();
    const selectedMap = selectedMapKey ? mapCatalog?.[selectedMapKey] : null;
    if (!selectedMap) return plan;
    const firstSector = plan.sequence[0] && typeof plan.sequence[0] === 'object' ? plan.sequence[0] : {};
    const selectedFirstSector = selectedMap?.parcours?.enabled === true
        ? {
            ...firstSector,
            templateId: 'sector_parcours',
            squadId: null,
            objectiveId: 'parcours_run',
            modifierId: null,
            scoreBonus: 0,
            pressure: 0,
            mapKey: selectedMapKey,
            mapKeyLocked: true,
            isBoss: false,
            bossMultiplier: 1,
            parcoursEnabled: true,
        }
        : { ...firstSector, mapKey: selectedMapKey, mapKeyLocked: true };
    return { ...plan, sequence: [selectedFirstSector, ...plan.sequence.slice(1)] };
}

export function buildObjectiveParticipants(entityManager) {
    return (Array.isArray(entityManager?.players) ? entityManager.players : []).map((player) => ({
        playerIndex: Math.max(0, Number(player?.index) || 0),
        label: formatPlayerDisplayLabel(player, { style: PLAYER_LABEL_STYLES.LONG }),
        isBot: player?.isBot === true,
        alive: player?.alive !== false,
    }));
}

export function requestObjectiveRoundEnd(entityManager, request) {
    if (request?.allowNoWinner === true) {
        return entityManager?.requestRoundEnd?.({ ...request, winner: null, allowNoWinner: true }) === true;
    }
    const winner = (Array.isArray(entityManager?.humanPlayers) ? entityManager.humanPlayers : [])
        .find((player) => player && player.alive !== false) || null;
    return winner ? entityManager.requestRoundEnd?.({ ...request, winner }) === true : false;
}

/**
 * Adds the companions flying in this sector; botCount stays the squad size and
 * sessionBotCount is what the match session spawns (squad plus companions).
 */
export function withArcadeCompanions(profile, runtimeConfig) {
    const botCount = Math.max(0, Math.trunc(Number(profile?.botCount) || 0));
    const companionCount = resolveActiveArcadeCompanionCount(runtimeConfig?.arcade, {
        humanCount: runtimeConfig?.session?.numHumans ?? 1,
        enemyCount: botCount,
    });
    return { ...profile, botCount, companionCount, sessionBotCount: botCount + companionCount };
}

/**
 * The next sector rebuilds the match when its map, bot total or weapons profile (read once,
 * when the session builds its mode strategy) differ - and always with companions, so a
 * companion lost in the last sector flies again.
 */
export function resolveArcadeSectorTransition(transition, runtimeConfig, currentMapKey) {
    const currentBotCount = Math.max(0, Math.trunc(Number(runtimeConfig?.session?.numBots) || 0));
    const nextMapKey = String(transition.toMap || transition.mapKey || currentMapKey).trim() || currentMapKey;
    const next = withArcadeCompanions(transition, runtimeConfig);
    const requiresSessionRebuild = currentMapKey !== nextMapKey || currentBotCount !== next.sessionBotCount
        || next.companionCount > 0
        || String(runtimeConfig?.arcade?.combatProfile || '') !== String(transition.combatProfile || '');
    return { ...next, mapKey: nextMapKey, toMap: nextMapKey, requiresSessionRebuild };
}

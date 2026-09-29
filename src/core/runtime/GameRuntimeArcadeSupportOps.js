import { PLAYER_LABEL_STYLES, formatPlayerDisplayLabel } from '../../shared/contracts/PlayerDisplayLabelContract.js';
import { isWeaponRaceConfig } from '../../shared/contracts/WeaponRaceContract.js';
import { resolveObjectiveTargetIndex } from '../../entities/systems/ObjectiveTargetMarkerOps.js';
import { doesArcadeObjectiveHoldRound } from '../../state/arcade/ArcadeObjectiveState.js';

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
    if (!isWeaponRaceConfig(runtimeConfig)) return runtime.configure(runtimeConfig);
    return runtime.configure({
        ...runtimeConfig,
        arcade: { ...runtimeConfig.arcade, ghostDuelMode: 'self_best_time_ghost', ghostTrailCollisionEnabled: false },
    });
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
    const winner = (Array.isArray(entityManager?.humanPlayers) ? entityManager.humanPlayers : [])
        .find((player) => player && player.alive !== false) || null;
    return winner ? entityManager.requestRoundEnd?.({ ...request, winner }) === true : false;
}

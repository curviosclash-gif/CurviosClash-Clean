import { expect, test } from './helpers.desktop.js';
import { formatDuration } from '../src/ui/postmatch/PostMatchFormat.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';
import { runK19TargetWithCpuProfile } from './helpers/k19-cpu-profile.mjs';
import { installK19SegmentTimeoutObserver } from './helpers/k19-segment-timeout-observer.mjs';
import {
    createPortalSafeCheckpointEntryCandidate,
    createWallSafeCheckpointEntryCandidates,
    shouldSelectPortalSafeCheckpointEntryCandidate,
} from './helpers/k19-checkpoint-entry.mjs';
import {
    crossedWaypointArrivalBand,
    getWaypointIncomingStart,
    measureWaypointPolyline,
    portalPathConflictsWithTurnEnvelope,
    remainingWaypointPolylineDistance,
    selectK19RouteCandidate,
    turnIntervalReachesTarget,
    maximumOrientationDeviationEnvelope,
    resolveCollinearDepartureSweep,
    createK19RoutePreflightPlan,
    shouldObserveK19SegmentTimeout,
    failOnK19SegmentTimeout,
    K19_NEON_CP05_ROUTE_ID,
    K19_NEON_CP05_ROUTE_WAYPOINTS,
    K19_NEON_CP05_ENTRY_POSITION,
    K19_NEON_CP06_ROUTE_ID,
    K19_NEON_CP06_ROUTE_WAYPOINTS,
    K19_FROZEN_CP06_WAYPOINTS,
    K19_FROZEN_CP07_WAYPOINTS,
    K19_FROZEN_CP09_ENTRY_POSITION,
    K19_SKY_CP07_ENTRY_POSITION,
    K19_CHRONO_CHECKPOINT_WAYPOINTS,
    resolveK19CheckpointEntryOverride,
} from './helpers/k19-waypoint-transition.mjs';
import { PORTAL_CHAINS } from '../src/shared/contracts/PortalChainContract.js';
import { FIVE_PORTALS_RECORD_KEY } from '../src/shared/contracts/FivePortalsContract.js';
import { ARCADE_RANKED_STORAGE_KEY, resolveArcadeRankKey } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { ARCADE_HITBOX_MIN_THICKNESS, ARCADE_SWEEP_MAX_STEPS } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { ALTITUDE_SPEED_MAX_MULTIPLIER } from '../src/shared/contracts/AltitudeSpeedContract.js';
import { PICKUP_REGISTRY } from '../src/shared/contracts/PickupRegistryContract.js';

const CHAIN_ID = 'portal_chain_k19';
const CHAIN = PORTAL_CHAINS[CHAIN_ID];
const K19_CHECKPOINT_ENTRY_SOURCE = createPortalSafeCheckpointEntryCandidate.toString();
const K19_WALL_CHECKPOINT_ENTRY_SOURCE = createWallSafeCheckpointEntryCandidates.toString();
const K19_CHECKPOINT_ENTRY_ELIGIBILITY_SOURCE = shouldSelectPortalSafeCheckpointEntryCandidate.toString();
const K19_WAYPOINT_TRANSITION_SOURCE = crossedWaypointArrivalBand.toString();
const K19_CP05_ENTRY_OVERRIDE_SOURCE = resolveK19CheckpointEntryOverride.toString();
const K19_WAYPOINT_INCOMING_START_SOURCE = getWaypointIncomingStart.toString();
const K19_WAYPOINT_POLYLINE_LENGTH_SOURCE = measureWaypointPolyline.toString();
const K19_WAYPOINT_POLYLINE_REMAINING_SOURCE = remainingWaypointPolylineDistance.toString();
const K19_TURN_INTERVAL_REACHES_TARGET_SOURCE = turnIntervalReachesTarget.toString();
const K19_ROUTE_CANDIDATE_SELECTION_SOURCE = selectK19RouteCandidate.toString();
const K19_NEON_CP04_ROUTE_ID = 'neon-cp04-east-overpass-v5';
const K19_NEON_CP04_ROUTE_WAYPOINTS = [
    { x: 120, y: 127.5, z: -150 },
    { x: 180, y: 127.5, z: -150 },
];
const K19_COLLINEAR_DEPARTURE_SOURCE = resolveCollinearDepartureSweep.toString();
const K19_MAX_ORIENTATION_DEVIATION_SOURCE = maximumOrientationDeviationEnvelope.toString();
const K19_ROUTE_PREFLIGHT_PLAN_SOURCE = createK19RoutePreflightPlan.toString();
const K19_TIMEOUT_OBSERVER_ELIGIBILITY_SOURCE = shouldObserveK19SegmentTimeout.toString();
const K19_FAIL_ON_SEGMENT_TIMEOUT_SOURCE = failOnK19SegmentTimeout.toString();
const K19_PORTAL_TURN_ENVELOPE_SOURCE = portalPathConflictsWithTurnEnvelope.toString();
const K19_SEGMENT_TIMEOUT_OBSERVER_SOURCE = installK19SegmentTimeoutObserver.toString();

async function captureLegacyRecords(page) {
    return page.evaluate(({ rankedStorageKey, legacyKey }) => {
        const store = window.GAME_INSTANCE.settingsManager.getPlayerRecordStorePort();
        const leaderboard = store.loadJsonRecord(rankedStorageKey, null);
        const legacyBoardKey = 'five_portals:any:1-5';
        const hasLegacyBoard = Object.hasOwn(leaderboard?.boards || {}, legacyBoardKey);
        return {
            local: store.loadJsonRecord(legacyKey, null),
            hasBoard: hasLegacyBoard,
            board: hasLegacyBoard ? leaderboard.boards[legacyBoardKey] : undefined,
        };
    }, { rankedStorageKey: ARCADE_RANKED_STORAGE_KEY, legacyKey: FIVE_PORTALS_RECORD_KEY });
}

async function driveAuthoredParcoursTarget(page, testInfo, { mapKey, mapIndex, checkpointId, targetKind, diagnosticTargetOrdinal }) {
    const isNeonCp04DiagnosticTarget = mapKey === 'neon_circuit' && checkpointId === 'CP04' && targetKind === 'checkpoint';
    const isNeonCp05DiagnosticTarget = mapKey === 'neon_circuit' && checkpointId === 'CP05' && targetKind === 'checkpoint';
    const effectiveDiagnosticTargetOrdinal = isNeonCp04DiagnosticTarget ? 4
        : (isNeonCp05DiagnosticTarget ? 5 : diagnosticTargetOrdinal);
    const diagnosticCapture = (Number.isInteger(effectiveDiagnosticTargetOrdinal)
        && effectiveDiagnosticTargetOrdinal >= 1 && effectiveDiagnosticTargetOrdinal <= 3)
        || isNeonCp04DiagnosticTarget || isNeonCp05DiagnosticTarget
        || (mapKey === 'frozen_helix' && checkpointId === 'CP05');
    if (diagnosticCapture) {
        const snapshot = await page.evaluate(({ checkpointId, targetKind, ordinal }) => {
            const game = window.GAME_INSTANCE;
            const player = game?.entityManager?.players?.[0];
            const route = game?.entityManager?.getParcoursRouteSnapshot?.();
            const runtime = game?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime;
            const gameLoop = game?.runtimeFacade?.getRuntimeHandle?.('gameLoop');
            const timing = gameLoop?.getRenderTiming?.();
            return {
                mapKey: game?.arena?.currentMapKey,
                phase: runtime?.phase,
                mapIndex: runtime?.mapIndex,
                hud: runtime?.getHudState?.(),
                routeId: route?.routeId,
                target: targetKind === 'finish' ? route?.finish : route?.checkpoints?.find((entry) => entry.id === checkpointId),
                position: player ? { x: player.position.x, y: player.position.y, z: player.position.z } : null,
                speed: Number(player?.speed) || 0,
                hitboxRadius: Number(player?.hitboxRadius) || 0,
                visibility: document.visibilityState,
                focused: document.hasFocus(),
                renderTiming: timing ? {
                    frameId: timing.frameId, rawDt: timing.rawDt, stabilizedDt: timing.stabilizedDt,
                    reset: timing.reset, resetReason: timing.resetReason, timestampMs: timing.timestampMs,
                } : null,
                perfBaseline: ordinal === 1
                    ? window.GAME_DEBUG?.getRuntimePerformanceSnapshot?.({ windowSize: 60, spikeEventsLimit: 4 })?.performance || null
                    : null,
            };
        }, { checkpointId, targetKind, ordinal: effectiveDiagnosticTargetOrdinal });
        console.info(`K19_TARGET_DIAGNOSTIC ${JSON.stringify({ phase: 'snapshot', ordinal: effectiveDiagnosticTargetOrdinal, mapKey, mapIndex, checkpointId: checkpointId || null, targetKind, snapshot })}`);
    }
    try {
        const runTarget = () => page.evaluate(async ({ expectedMapKey, expectedMapIndex, expectedCheckpointId, kind, minThickness, maxSweepSteps, altitudeSpeedMax, speedUpMultiplier, speedEffectDefinitions, diagnosticTargetOrdinal, checkpointEntrySource, wallCheckpointEntrySource, checkpointEntryEligibilitySource, cp05EntryOverrideSource, arrivalTransitionSource, waypointIncomingStartSource, waypointPolylineLengthSource, waypointPolylineRemainingSource, turnIntervalReachesTargetSource, routeCandidateSelectionSource, maxOrientationDeviationSource, collinearDepartureSource, routePreflightPlanSource, timeoutObserverEligibilitySource, failOnSegmentTimeoutSource, portalTurnEnvelopeSource, segmentTimeoutObserverSource, requiredRouteId, requiredRouteWaypoints, frozenCp06Waypoints, frozenCp07Waypoints, chronoWaypoints }) => {
        // Serialize the exact pure transition helper also exercised by the focused contract tests.
        const hasCrossedWaypointArrivalBand = new Function(`return (${arrivalTransitionSource});`)();
        const getIncomingStart = new Function(`return (${waypointIncomingStartSource});`)();
        const measurePolyline = new Function(`return (${waypointPolylineLengthSource});`)();
        const measureRemainingPolyline = new Function(`return (${waypointPolylineRemainingSource});`)();
        const doesTurnIntervalReachTarget = new Function(`return (${turnIntervalReachesTargetSource});`)();
        const chooseRouteCandidate = new Function(`return (${routeCandidateSelectionSource});`)();
        const getMaximumOrientationDeviation = new Function(`return (${maxOrientationDeviationSource});`)();
        const resolveCollinearDeparture = new Function(`return (${collinearDepartureSource});`)();
        const makeRoutePreflightPlan = new Function(`return (${routePreflightPlanSource});`)();
        const shouldObserveSegmentTimeout = new Function(`return (${timeoutObserverEligibilitySource});`)();
        const failIfSegmentTimeout = new Function(`return (${failOnSegmentTimeoutSource});`)();
        const hasPortalTurnEnvelopeConflict = new Function(`return (${portalTurnEnvelopeSource});`)();
        const makeCheckpointEntryCandidate = new Function(`return (${checkpointEntrySource});`)();
        const shouldSelectCheckpointEntryCandidate = new Function(`return (${checkpointEntryEligibilitySource});`)();
        const resolveCp05EntryOverride = new Function(`return (${cp05EntryOverrideSource});`)();
        const makeWallEntryCandidates = new Function(`return (${wallCheckpointEntrySource});`)();
        const game = window.GAME_INSTANCE;
        const entityManager = game?.entityManager;
        const arena = game?.arena;
        const runtime = game?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime;
        const player = entityManager?.players?.[0];
        const route = entityManager?.getParcoursRouteSnapshot?.();
        const progressSystem = entityManager?._parcoursProgressSystem;
        const initialHud = runtime?.getHudState?.();
        if (!player || !route || !progressSystem || arena?.currentMapKey !== expectedMapKey
            || runtime?.phase !== 'racing' || initialHud?.chainId !== 'portal_chain_k19'
            || initialHud?.mapIndex !== expectedMapIndex || initialHud?.currentMapKey !== expectedMapKey) {
            throw new Error(`K19 route steering unavailable on ${expectedMapKey}`);
        }
        const target = kind === 'finish'
            ? route.finish
            : route.checkpoints.find((entry) => entry.id === expectedCheckpointId);
        if (!target?.pos || !Array.isArray(target.pos) || target.pos.length !== 3) {
            throw new Error(`Missing authored ${kind} target ${expectedCheckpointId || 'finish'} on ${expectedMapKey}`);
        }
        const isRequiredNeonCp04 = expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
            && expectedCheckpointId === 'CP04';
        const isRequiredNeonCp05 = expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
            && expectedCheckpointId === 'CP05';
        const isRequiredNeonCp06 = expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
            && expectedCheckpointId === 'CP06';
        const isRequiredNeonPinnedRoute = isRequiredNeonCp04 || isRequiredNeonCp05 || isRequiredNeonCp06;
        const isFrozenCp09Entry = expectedMapKey === 'frozen_helix' && kind === 'checkpoint'
            && expectedCheckpointId === 'CP09' && target.routeIndex === 8;
        const isSkyCp07Entry = expectedMapKey === 'sky_islands' && kind === 'checkpoint'
            && expectedCheckpointId === 'CP07' && target.routeIndex === 6;
        if (isRequiredNeonCp04 && target.routeIndex !== 3) {
            throw new Error(`Required Neon CP04 route has unexpected routeIndex=${target.routeIndex}`);
        }
        if (isRequiredNeonCp05 && target.routeIndex !== 4) {
            throw new Error(`Required Neon CP05 route has unexpected routeIndex=${target.routeIndex}`);
        }
        if (isRequiredNeonCp06 && target.routeIndex !== 5) {
            throw new Error(`Required Neon CP06 route has unexpected routeIndex=${target.routeIndex}`);
        }
        if (isRequiredNeonPinnedRoute && (route.rules?.maxSegmentTimeMs !== 16_000
            || progressSystem._route?.rules?.maxSegmentTimeMs !== 16_000)) {
            throw new Error(`Neon ${expectedCheckpointId} live segment limit must remain 16000ms; snapshot=${route.rules?.maxSegmentTimeMs} live=${progressSystem._route?.rules?.maxSegmentTimeMs}`);
        }
        const radius = Number(player.hitboxRadius);
        const wallShape = player.arcadeHitbox?.wall;
        const modelScale = Number(player.modelScale) > 0 ? Number(player.modelScale) : 1;
        if (!Number.isFinite(radius) || radius <= 0 || typeof player.setLookAtWorld !== 'function') {
            throw new Error(`Invalid live player hull/steering on ${expectedMapKey}: radius=${radius}`);
        }
        if (!wallShape || !Number.isInteger(wallShape.count) || wallShape.count < 1
            || !(wallShape.boxes instanceof Float64Array) || !(wallShape.boxReach instanceof Float64Array)
            || !(wallShape.probes instanceof Float64Array) || !(wallShape.probeStart instanceof Int32Array)
            || !Number.isFinite(wallShape.boundRadius) || wallShape.boundRadius <= 0) {
            throw new Error(`Missing actual Arcade wall probe shape on ${expectedMapKey}; vehicle=${player.vehicleId}`);
        }
        const diagnosticCapture = (Number.isInteger(diagnosticTargetOrdinal)
            && diagnosticTargetOrdinal >= 1 && diagnosticTargetOrdinal <= 3)
            || (expectedMapKey === 'neon_circuit'
                && (expectedCheckpointId === 'CP04' || expectedCheckpointId === 'CP05'))
            || (expectedMapKey === 'frozen_helix' && expectedCheckpointId === 'CP05');
        const diagnosticStartedAt = performance.now();
        const preflightDiagnostics = { sweepCalls: 0, requestedSamples: 0, sweptSamples: 0, broadQueries: 0, probeQueries: 0 };
        const emitDiagnostic = (phase, details = {}) => {
            if (!diagnosticCapture) return;
            console.info(`K19_TARGET_DIAGNOSTIC ${JSON.stringify({
                phase, ordinal: diagnosticTargetOrdinal, mapKey: expectedMapKey, checkpointId: expectedCheckpointId || null,
                elapsedMs: Math.round((performance.now() - diagnosticStartedAt) * 100) / 100,
                preflight: { ...preflightDiagnostics, samplesRemaining: 65_536 - preflightDiagnostics.sweptSamples },
                ...details,
            })}`);
        };
        const queryBroad = (...args) => {
            if (diagnosticCapture) preflightDiagnostics.broadQueries += 1;
            return arena.checkCollisionBroad(...args);
        };
        const queryProbe = (...args) => {
            if (diagnosticCapture) preflightDiagnostics.probeQueries += 1;
            return arena.getCollisionInfo(...args);
        };
        const start = { x: player.position.x, y: player.position.y, z: player.position.z };
        let end = { x: target.pos[0], y: target.pos[1], z: target.pos[2] };
        const currentProgress = progressSystem.getPlayerProgressSnapshot(0);
        if (!Number.isInteger(currentProgress?.nextCheckpointIndex)) {
            throw new Error(`Missing live route progress on ${expectedMapKey}`);
        }
        const startIdentity = { game, entityManager, arena, runtime, player, progressSystem };
        const failIfRunChanged = (progress, phase = 'racing') => {
            const hud = runtime?.getHudState?.();
            const livePlayer = entityManager?.players?.[0];
            if (window.GAME_INSTANCE !== startIdentity.game || game.entityManager !== startIdentity.entityManager
                || game.arena !== startIdentity.arena || game.runtimeFacade?._arcadeSupport?.fivePortalsRuntime !== startIdentity.runtime
                || entityManager.players?.[0] !== startIdentity.player || entityManager._parcoursProgressSystem !== startIdentity.progressSystem
                || arena.currentMapKey !== expectedMapKey || runtime?.phase !== phase
                || hud?.chainId !== 'portal_chain_k19' || hud?.mapIndex !== expectedMapIndex
                || hud?.currentMapKey !== expectedMapKey || livePlayer?.alive === false || Number(livePlayer?.hp) <= 0
                || progress?.resetCount !== currentProgress.resetCount
                || progress?.checkpointRespawnsUsed !== currentProgress.checkpointRespawnsUsed
                || progress?.nextCheckpointIndex < currentProgress.nextCheckpointIndex) {
                throw new Error(`K19 run identity/progress changed on ${expectedMapKey}; phase=${runtime?.phase} `
                    + `death=${livePlayer?.lastDeathCause || 'none'} hp=${livePlayer?.hp} alive=${livePlayer?.alive} `
                    + `progress=${progress?.nextCheckpointIndex}/${route.totalCheckpoints} `
                    + `reset=${progress?.resetCount}/${currentProgress.resetCount} respawns=${progress?.checkpointRespawnsUsed}/${currentProgress.checkpointRespawnsUsed}`);
            }
        };
        let distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
        const speed = Math.max(3, Number(player.speed) || 0);
        const stalledFrames = 180;
        const progressDistance = Math.max(0.5, radius * 0.25);
        const pointToSegmentDistance = (point, from, to) => {
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dz = to.z - from.z;
            const lengthSq = dx * dx + dy * dy + dz * dz;
            const amount = lengthSq > 0
                ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / lengthSq))
                : 0;
            return Math.hypot(
                point.x - (from.x + dx * amount),
                point.y - (from.y + dy * amount),
                point.z - (from.z + dz * amount),
            );
        };
        const portalRadius = Math.max(0, Number(entityManager.entityRuntimeConfig?.PORTAL?.RADIUS) || 4);
        const portalClearance = portalRadius + radius + 1;
        const portalEndpoints = arena.portalsEnabled === false
            ? []
            : (arena.portals || []).flatMap((portal) => {
                if (portal.secret === true && portal.active !== true) return [];
                return [
                    { position: portal.posA, endpointSide: 'A' },
                    { position: portal.posB, endpointSide: 'B' },
                ]
                    .filter(({ position }) => position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z))
                    .map(({ position, endpointSide }) => ({
                        x: position.x,
                        y: position.y,
                        z: position.z,
                        pairIndex: portal.pairIndex,
                        endpointSide,
                        portalId: portal.id ?? portal.portalId ?? null,
                    }));
            });
        const gameLoop = game.runtimeFacade?.getRuntimeHandle?.('gameLoop');
        const loopStep = Number(gameLoop?.fixedStep);
        const loopMaxSubSteps = Number(gameLoop?.maxSubSteps);
        const loopTimeScale = Number(gameLoop?.timeScale);
        if (!Number.isFinite(loopStep) || loopStep <= 0 || !Number.isInteger(loopMaxSubSteps) || loopMaxSubSteps < 1
            || !Number.isFinite(loopTimeScale) || loopTimeScale <= 0 || loopTimeScale > 1) {
            throw new Error(`K19 cannot bound live GameLoop timing on ${expectedMapKey}; step=${loopStep} maxSubSteps=${loopMaxSubSteps} timeScale=${loopTimeScale}`);
        }
        const compensatesMotionClock = (player.manualSlowMoActive === true && player.isBot !== true)
            || (player.hasSlowTime === true && player.slowTimeExemptsOwner === true);
        const motionTimeScale = compensatesMotionClock ? 1 / Math.max(0.05, loopTimeScale) : 1;
        // GameLoop._loop clamps dt to 0.05, scales it, and can carry less than one fixed step.
        const maximumTicksPerFrame = Math.min(loopMaxSubSteps, Math.ceil((0.05 * loopTimeScale) / loopStep));
        const maximumMotionSecondsPerFrame = maximumTicksPerFrame * loopStep * motionTimeScale;
        const modeType = String(entityManager.gameModeStrategy?.getPickupModeType?.()
            || entityManager.gameModeStrategy?.modeType || 'ARCADE').trim().toUpperCase();
        let activeSpeedMultiplier = 1;
        const activeEffects = Array.isArray(player.activeEffects) ? player.activeEffects : [];
        for (let i = activeEffects.length - 1; i >= 0; i -= 1) {
            const type = activeEffects[i]?.type;
            if (type !== 'SPEED_UP' && type !== 'SLOW_DOWN') continue;
            const definition = speedEffectDefinitions[type];
            if (!definition?.allowedModes?.includes(modeType)) continue;
            const multiplier = Number(definition.multiplier);
            if (Number.isFinite(multiplier) && multiplier > 0) activeSpeedMultiplier = multiplier;
            break;
        }
        const currentSpeedBase = Math.max(0, Number(player.baseSpeed) || 0);
        const permanentSpeedBase = currentSpeedBase / activeSpeedMultiplier;
        const maximumSpeedBase = Math.max(currentSpeedBase, permanentSpeedBase * speedUpMultiplier);
        let boostActive = player.manualBoostActive === true || Number(player.boostPortalTimer) > 0;
        const gameplayBoostMultiplier = Math.max(1, Number(player.gameplayConfig?.PLAYER?.BOOST_MULTIPLIER) || 1);
        let boostImpulse = Number(player.boostPortalTimer) > 0
            ? Math.abs(Number(player.boostPortalParams?.forwardImpulse) || 40) : 0;
        let boostBonusSpeed = Number(player.boostPortalTimer) > 0
            ? Math.max(0, Number(player.boostPortalParams?.bonusSpeed) || 50) : 0;
        let slingshotImpulse = Number(player.slingshotTimer) > 0
            ? Math.abs(Number(player.slingshotParams?.forwardImpulse) || 25)
                + Math.abs(Number(player.slingshotParams?.liftImpulse) || 5) : 0;
        for (const gate of arena.specialGates || []) {
            if (gate.type === 'boost') {
                boostActive = true;
                boostImpulse = Math.max(boostImpulse, Math.abs(Number(gate.params?.forwardImpulse) || 40));
                boostBonusSpeed = Math.max(boostBonusSpeed, Math.max(0, Number(gate.params?.bonusSpeed) || 50));
            } else if (gate.type === 'slingshot') {
                slingshotImpulse = Math.max(slingshotImpulse,
                    Math.abs(Number(gate.params?.forwardImpulse) || 25) + Math.abs(Number(gate.params?.liftImpulse) || 5));
            }
        }
        const waterSystem = entityManager._waterZoneSystem;
        const waterBuoyancyLimit = waterSystem?.zone || waterSystem?.permanentZones?.length
            ? Math.max(0, Number(waterSystem.zone?.effects?.buoyancy) || 0,
                ...(waterSystem.permanentZones || []).map((zone) => Number(zone?.effects?.buoyancy) || 0))
            : Math.max(0, Number(player.waterBuoyancy) || 0);
        const maximumTurnSpeed = Math.max(
            Number(player.speed) || 0,
            maximumSpeedBase * (boostActive ? gameplayBoostMultiplier : 1) * altitudeSpeedMax,
            boostBonusSpeed,
        ) + boostImpulse + slingshotImpulse + waterBuoyancyLimit;
        const maximumTurnDisplacement = maximumTurnSpeed * maximumMotionSecondsPerFrame;
        if (!Number.isFinite(maximumTurnDisplacement) || maximumTurnDisplacement < 0) {
            throw new Error(`K19 cannot bound live turn movement on ${expectedMapKey}; speed=${maximumTurnSpeed} frameSeconds=${maximumMotionSecondsPerFrame}`);
        }
        let portalApproach = null;
        let checkpointEntryOverride = null;
        if (kind === 'checkpoint' && route.rules?.bidirectionalCheckpoints === true
            && !isRequiredNeonCp05 && !isFrozenCp09Entry && !isSkyCp07Entry) {
            const contactRadius = target.radius + radius;
            const centerBlockedPortal = portalEndpoints
                .map((endpoint) => ({
                    endpoint,
                    distance: Math.hypot(
                        endpoint.x - end.x,
                        endpoint.y - end.y,
                        endpoint.z - end.z,
                    ),
                }))
                .filter((entry) => entry.distance <= portalClearance)
                .sort((left, right) => left.distance - right.distance)[0];
            if (centerBlockedPortal) {
                // Parcours progress is scored before portal traversal, so enter the real ring sphere
                // while remaining outside the portal's live clearance and let the normal consumer fire.
                const startDistance = Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z);
                const penetrationMargin = Math.max(0.5, radius * 0.5);
                const entryDistance = contactRadius - penetrationMargin;
                if (!(startDistance > 0) || !(entryDistance > portalClearance)) {
                    throw new Error(
                        `No portal-safe physical entry point for ${expectedCheckpointId} on ${expectedMapKey}; `
                        + `contactRadius=${contactRadius} portalClearance=${portalClearance} `
                        + `startDistance=${startDistance} target=${JSON.stringify(end)} `
                        + `portal=${JSON.stringify(centerBlockedPortal.endpoint)}`
                    );
                }
                const towardStart = {
                    x: (start.x - end.x) / startDistance,
                    y: (start.y - end.y) / startDistance,
                    z: (start.z - end.z) / startDistance,
                };
                const entry = {
                    x: end.x + towardStart.x * entryDistance,
                    y: end.y + towardStart.y * entryDistance,
                    z: end.z + towardStart.z * entryDistance,
                };
                const entryPortalConflict = portalEndpoints.find((endpoint) => Math.hypot(
                    endpoint.x - entry.x,
                    endpoint.y - entry.y,
                    endpoint.z - entry.z,
                ) <= portalClearance);
                if (entryPortalConflict) {
                    throw new Error(
                        `No portal-safe physical entry point for ${expectedCheckpointId} on ${expectedMapKey}; `
                        + `entry=${JSON.stringify(entry)} portalClearance=${portalClearance} `
                        + `contactRadius=${contactRadius} portal=${JSON.stringify(entryPortalConflict)}`
                    );
                }
                end.x = entry.x;
                end.y = entry.y;
                end.z = entry.z;
                portalApproach = {
                    pairIndex: centerBlockedPortal.endpoint.pairIndex,
                    center: { x: target.pos[0], y: target.pos[1], z: target.pos[2] },
                    entry,
                    contactRadius,
                    entryDistance,
                    portalClearance,
                    penetrationMargin,
                };
            }
        }
        if (isSkyCp07Entry || isFrozenCp09Entry || isRequiredNeonCp05 || (expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
            && expectedCheckpointId === 'CP09' && target.routeIndex === 8)) {
            checkpointEntryOverride = resolveCp05EntryOverride({
                mapKey: expectedMapKey,
                checkpointId: expectedCheckpointId,
                target,
                playerRadius: radius,
                portalEndpoints,
                portalClearance,
            });
            if (!(route.rules?.bidirectionalCheckpoints === true && checkpointEntryOverride?.accepted === true)) {
                throw new Error(`Invalid K19 ${expectedCheckpointId} physical entry override; geometry=${JSON.stringify(checkpointEntryOverride)} `
                    + `bidirectionalCheckpoints=${route.rules?.bidirectionalCheckpoints}`);
            }
            end.x = checkpointEntryOverride.position.x;
            end.y = checkpointEntryOverride.position.y;
            end.z = checkpointEntryOverride.position.z;
        }
        distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
        let reachableFrames = Math.min(1200, Math.max(240, Math.ceil((distance / speed) * 60 * 3)));
        let closestDistance = distance;
        let closestFrame = 0;
        const pathIntersectsPortal = (from, to, extraClearance = 0) => portalEndpoints.some((endpoint) => (
            pointToSegmentDistance(endpoint, from, to) <= portalClearance + extraClearance
        ));
        const describePortalClearanceRejection = (points, waypoints, turnGeometry = []) => {
            const conflicts = [];
            for (const endpoint of portalEndpoints) {
                for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
                    const from = points[segmentIndex - 1];
                    const to = points[segmentIndex];
                    const dx = to.x - from.x;
                    const dy = to.y - from.y;
                    const dz = to.z - from.z;
                    const lengthSq = dx * dx + dy * dy + dz * dz;
                    const projectFraction = lengthSq > 0
                        ? Math.max(0, Math.min(1, ((endpoint.x - from.x) * dx + (endpoint.y - from.y) * dy + (endpoint.z - from.z) * dz) / lengthSq))
                        : 0;
                    const closestPoint = {
                        x: from.x + dx * projectFraction,
                        y: from.y + dy * projectFraction,
                        z: from.z + dz * projectFraction,
                    };
                    const distance = Math.hypot(
                        endpoint.x - closestPoint.x,
                        endpoint.y - closestPoint.y,
                        endpoint.z - closestPoint.z,
                    );
                    if (distance > portalClearance) continue;
                    conflicts.push({
                        pairIndex: endpoint.pairIndex,
                        endpointSide: endpoint.endpointSide,
                        portalId: endpoint.portalId,
                        endpoint: { x: endpoint.x, y: endpoint.y, z: endpoint.z },
                        segmentIndex: segmentIndex - 1,
                        segmentFrom: { x: from.x, y: from.y, z: from.z },
                        segmentTo: { x: to.x, y: to.y, z: to.z },
                        closestPoint,
                        projectFraction,
                        distance,
                        portalRadius,
                        playerRadius: radius,
                        portalScale: arena?._portalGateSystem?.layoutBuilder?._mapScale ?? null,
                        portalClearance,
                        turnDisplacementBound: maximumTurnDisplacement,
                        envelope: 'centerline',
                        rejectionThreshold: portalClearance,
                    });
                }
                for (let turnIndex = 1; turnIndex < points.length - 1; turnIndex += 1) {
                    const turnPoint = points[turnIndex];
                    const distance = Math.hypot(endpoint.x - turnPoint.x, endpoint.y - turnPoint.y, endpoint.z - turnPoint.z);
                    const threshold = portalClearance + maximumTurnDisplacement;
                    if (distance > threshold) continue;
                    conflicts.push({
                        pairIndex: endpoint.pairIndex,
                        endpointSide: endpoint.endpointSide,
                        portalId: endpoint.portalId,
                        endpoint: { x: endpoint.x, y: endpoint.y, z: endpoint.z },
                        turnIndex,
                        turnPoint: { x: turnPoint.x, y: turnPoint.y, z: turnPoint.z },
                        distance,
                        portalRadius,
                        playerRadius: radius,
                        portalScale: arena?._portalGateSystem?.layoutBuilder?._mapScale ?? null,
                        portalClearance,
                        turnDisplacementBound: maximumTurnDisplacement,
                        envelope: 'turn-displacement',
                        rejectionThreshold: threshold,
                    });
                }
            }
            for (const turn of turnGeometry) {
                const turnSegments = [
                    { from: turn.switchPoint, to: turn.turnEnd, envelope: 'turn-motion', extraClearance: 0 },
                    { from: turn.turnMidpoint, to: waypoints[turnGeometry.indexOf(turn) + 1], envelope: 'turn-departure', extraClearance: turn.departureEnvelope },
                ];
                for (const segment of turnSegments) {
                    const threshold = portalClearance + segment.extraClearance;
                    for (const endpoint of portalEndpoints) {
                        const distance = pointToSegmentDistance(endpoint, segment.from, segment.to);
                        if (distance > threshold) continue;
                        conflicts.push({
                            pairIndex: endpoint.pairIndex,
                            endpointSide: endpoint.endpointSide,
                            portalId: endpoint.portalId,
                            endpoint: { x: endpoint.x, y: endpoint.y, z: endpoint.z },
                            segmentFrom: segment.from,
                            segmentTo: segment.to,
                            distance,
                            portalRadius,
                            playerRadius: radius,
                            portalScale: arena?._portalGateSystem?.layoutBuilder?._mapScale ?? null,
                            portalClearance,
                            turnDisplacementBound: maximumTurnDisplacement,
                            departureEnvelope: turn.departureEnvelope,
                            envelope: segment.envelope,
                            rejectionThreshold: threshold,
                        });
                    }
                }
            }
            const playerPortalState = arena.getTraversalSignalForEntity?.(player.index) ?? null;
            return {
                start: { x: start.x, y: start.y, z: start.z },
                end: { x: end.x, y: end.y, z: end.z },
                waypoints: waypoints.map((waypoint) => ({ x: waypoint.x, y: waypoint.y, z: waypoint.z })),
                pathPoints: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
                turnGeometry,
                turnDisplacementBound: maximumTurnDisplacement,
                portalClearance,
                rejectionThreshold: portalClearance,
                portalScale: arena?._portalGateSystem?.layoutBuilder?._mapScale ?? null,
                playerIndex: player.index,
                playerPortalState: playerPortalState ? {
                    portalsEnabled: playerPortalState.portalsEnabled,
                    portalCooldownRemaining: playerPortalState.portalCooldownRemaining,
                    postPortalActive: playerPortalState.postPortalActive,
                    postPortalRemainingSeconds: playerPortalState.postPortalRemainingSeconds,
                    lastPortalTravelAtMs: playerPortalState.lastPortalTravelAtMs,
                } : null,
                conflicts,
            };
        };
        const passedCheckpointIds = new Set(currentProgress.passedCheckpointIds || []);
        const pathHasUnorderedCheckpoint = (from, to, extraClearance = 0) => kind === 'checkpoint'
            && route.checkpoints.some((entry) => {
                if (entry.id === expectedCheckpointId) return false;
                const passedBeforeTarget = entry.routeIndex < target.routeIndex
                    && (passedCheckpointIds.has(entry.id)
                    || (route.rules?.ordered === true && entry.routeIndex < currentProgress.nextCheckpointIndex));
                return !passedBeforeTarget
                    && pointToSegmentDistance({ x: entry.pos[0], y: entry.pos[1], z: entry.pos[2] }, from, to)
                        <= entry.radius + radius + extraClearance;
            });
        const vectorAt = (value) => player.position.clone().set(value.x, value.y, value.z);
        const facing = (from, to) => {
            const direction = vectorAt(to).sub(vectorAt(from)).normalize();
            return player.quaternion.clone().setFromUnitVectors(vectorAt(from).set(0, 0, -1), direction);
        };
        const writeWorldPoint = (position, quaternion, scale, x, y, z) => {
            const vx = x * scale; const vy = y * scale; const vz = z * scale;
            const qx = quaternion.x; const qy = quaternion.y; const qz = quaternion.z; const qw = quaternion.w;
            const ix = qw * vx + qy * vz - qz * vy;
            const iy = qw * vy + qz * vx - qx * vz;
            const iz = qw * vz + qx * vy - qy * vx;
            const iw = -qx * vx - qy * vy - qz * vz;
            return {
                x: position.x + ix * qw + iw * -qx + iy * -qz - iz * -qy,
                y: position.y + iy * qw + iw * -qy + iz * -qx - ix * -qz,
                z: position.z + iz * qw + iw * -qz + ix * -qy - iy * -qx,
            };
        };
        const probeShapeAt = (position, quaternion, envelopeRadius = 0) => {
            if (!queryBroad(position, wallShape.boundRadius * modelScale + envelopeRadius)) return null;
            for (let boxIndex = 0; boxIndex < wallShape.count; boxIndex += 1) {
                const boxOffset = boxIndex * 6;
                const boxCenter = writeWorldPoint(position, quaternion, modelScale,
                    wallShape.boxes[boxOffset], wallShape.boxes[boxOffset + 1], wallShape.boxes[boxOffset + 2]);
                if (!queryBroad(boxCenter, wallShape.boxReach[boxIndex] * modelScale + envelopeRadius)) continue;
                for (let probeIndex = wallShape.probeStart[boxIndex]; probeIndex < wallShape.probeStart[boxIndex + 1]; probeIndex += 1) {
                    const probeOffset = probeIndex * 4;
                    const point = writeWorldPoint(position, quaternion, modelScale,
                        wallShape.probes[probeOffset], wallShape.probes[probeOffset + 1], wallShape.probes[probeOffset + 2]);
                    const probeRadius = wallShape.probes[probeOffset + 3] * modelScale;
                    const info = queryProbe(point, probeRadius + envelopeRadius);
                    if (info) {
                        const box = info.obstacle?.box;
                        return {
                            point, probeRadius, sourceName: info.sourceName,
                            obstacleBox: box ? {
                                min: { x: box.min.x, y: box.min.y, z: box.min.z },
                                max: { x: box.max.x, y: box.max.y, z: box.max.z },
                            } : null,
                        };
                    }
                }
            }
            return null;
        };
        const maxPreflightSamples = 65_536;
        let preflightSamplesLeft = maxPreflightSamples;
        const routePreflightPlan = makeRoutePreflightPlan({
            requiredRoute: isRequiredNeonPinnedRoute,
            samplesRemaining: preflightSamplesLeft,
            maxSamples: maxPreflightSamples,
        });
        if (!routePreflightPlan) throw new Error(`Invalid K19 route preflight budget on ${expectedMapKey}`);
        preflightSamplesLeft = routePreflightPlan.sampleBudget;
        const sweepShapeMotion = (from, to, startQuaternion, endQuaternion, envelopeRadius = 0, orientationAtPosition = null, orientationTarget = null) => {
            if (diagnosticCapture) preflightDiagnostics.sweepCalls += 1;
            const fromVector = vectorAt(from); const toVector = vectorAt(to);
            const travelled = fromVector.distanceTo(toVector);
            const reach = wallShape.boundRadius * modelScale + envelopeRadius;
            let angularTravelBound = startQuaternion.angleTo(endQuaternion);
            if (orientationAtPosition) {
                if (!orientationTarget) throw new Error(`Actual look-at sweep has no fixed target on ${expectedMapKey}`);
                const nearestTargetDistance = pointToSegmentDistance(orientationTarget, from, to);
                if (!(Number.isFinite(nearestTargetDistance) && nearestTargetDistance > 0)) {
                    throw new Error(`Cannot bound actual look-at rotation on ${expectedMapKey}; target intersects sweep`);
                }
                // For a fixed target, angular travel is bounded by path length / minimum
                // target distance. The factor two covers the quaternion look-at mapping.
                angularTravelBound = Math.max(angularTravelBound,
                    Math.min(Math.PI * 2, 2 * travelled / nearestTargetDistance));
            }
            const requestedSteps = Math.max(1, Math.ceil(
                (travelled + angularTravelBound * reach) / Math.max(1e-6, minThickness * modelScale),
            ));
            if (diagnosticCapture) preflightDiagnostics.requestedSamples += requestedSteps;
            if (requestedSteps > preflightSamplesLeft) {
                throw new Error(`Actual wall-shape preflight exceeds ${maxPreflightSamples} pose samples on ${expectedMapKey}; `
                    + `requested=${requestedSteps} remaining=${preflightSamplesLeft}`);
            }
            let completedSteps = 0;
            while (completedSteps < requestedSteps) {
                const chunkSteps = Math.min(maxSweepSteps, requestedSteps - completedSteps);
                const t0 = completedSteps / requestedSteps;
                const t1 = (completedSteps + chunkSteps) / requestedSteps;
                const chunkStart = fromVector.clone().lerp(toVector, t0);
                const chunkEnd = fromVector.clone().lerp(toVector, t1);
                const chunkStartQuat = orientationAtPosition
                    ? orientationAtPosition(chunkStart)
                    : startQuaternion.clone().slerp(endQuaternion, t0);
                const chunkEndQuat = orientationAtPosition
                    ? orientationAtPosition(chunkEnd)
                    : startQuaternion.clone().slerp(endQuaternion, t1);
                const chunkDistance = chunkStart.distanceTo(chunkEnd);
                const midpoint = chunkStart.clone().lerp(chunkEnd, 0.5);
                if (queryBroad(midpoint, chunkDistance / 2 + reach)) {
                    const samplePosition = chunkStart.clone(); const sampleQuaternion = chunkStartQuat.clone();
                    for (let step = 1; step <= chunkSteps; step += 1) {
                        const localAmount = step / chunkSteps;
                        samplePosition.lerpVectors(chunkStart, chunkEnd, localAmount);
                        if (orientationAtPosition) sampleQuaternion.copy(orientationAtPosition(samplePosition));
                        else sampleQuaternion.slerpQuaternions(chunkStartQuat, chunkEndQuat, localAmount);
                        preflightSamplesLeft -= 1;
                        if (diagnosticCapture) preflightDiagnostics.sweptSamples += 1;
                        const contact = probeShapeAt(samplePosition, sampleQuaternion, envelopeRadius);
                        if (contact) return { clear: false, sample: { x: samplePosition.x, y: samplePosition.y, z: samplePosition.z }, step: completedSteps + step, samples: requestedSteps, ...contact };
                    }
                } else {
                    preflightSamplesLeft -= chunkSteps;
                    if (diagnosticCapture) preflightDiagnostics.sweptSamples += chunkSteps;
                }
                completedSteps += chunkSteps;
            }
            return { clear: true };
        };
        const facingAtThreshold = (segmentStart, waypoint, nextTarget) => {
            const fromWaypoint = vectorAt(segmentStart).sub(vectorAt(waypoint));
            const distance = fromWaypoint.length();
            const threshold = radius * 2;
            if (distance <= threshold) return null;
            const switchPointVector = vectorAt(waypoint).add(fromWaypoint.multiplyScalar(threshold / distance));
            const switchPoint = { x: switchPointVector.x, y: switchPointVector.y, z: switchPointVector.z };
            const approachDirection = vectorAt(waypoint).sub(vectorAt(segmentStart)).normalize();
            const turnEnd = {
                x: switchPoint.x + approachDirection.x * maximumTurnDisplacement,
                y: switchPoint.y + approachDirection.y * maximumTurnDisplacement,
                z: switchPoint.z + approachDirection.z * maximumTurnDisplacement,
            };
            const turnMidpoint = {
                x: (switchPoint.x + turnEnd.x) / 2,
                y: (switchPoint.y + turnEnd.y) / 2,
                z: (switchPoint.z + turnEnd.z) / 2,
            };
            const turnToStart = facing(switchPoint, nextTarget);
            const turnToEnd = facing(turnEnd, nextTarget);
            const turnToMiddle = facing(turnMidpoint, nextTarget);
            const rotationalEnvelope = getMaximumOrientationDeviation(
                wallShape.boundRadius * modelScale,
                switchPoint,
                turnEnd,
                nextTarget,
            );
            if (!Number.isFinite(rotationalEnvelope)) return null;
            const departureEnvelope = maximumTurnDisplacement / 2
                + rotationalEnvelope;
            return {
                switchPoint, turnEnd, turnMidpoint, turnFrom: facing(segmentStart, waypoint),
                turnToStart, turnToEnd, turnToMiddle, departureEnvelope,
            };
        };
        const evaluateDriverPath = (waypoints) => {
            if (!Array.isArray(waypoints) || waypoints.length < 1 || waypoints.length > 5
                || waypoints.some((point) => !point || ![point.x, point.y, point.z].every(Number.isFinite))) {
                return { clear: false, contact: { sourceName: 'Invalid or unbounded K19 waypoint route' }, points: [start, end],
                    turnGeometry: [], thresholdPresent: false, rejectionReason: 'invalid-waypoint-route' };
            }
            const points = [start, ...waypoints];
            const turns = [];
            if (waypoints.length === 1) {
                const orientation = facing(start, waypoints[0]);
                // setLookAtWorld runs before the next rAF; Player.update then captures that new
                // quaternion as _renderPrevQuaternion. Check the actual first-frame pose, not a
                // turn smeared across the authored leg from the earlier frame's orientation.
                const initialPose = sweepShapeMotion(start, start, orientation, orientation);
                if (!initialPose.clear) return {
                    clear: false, contact: initialPose, points: [start, end], thresholdPresent: false,
                    rejectionReason: 'wall-sweep:initial-pose',
                };
                const translation = sweepShapeMotion(start, waypoints[0], orientation, orientation);
                return {
                    clear: translation.clear, contact: translation.clear ? null : translation, points, turnGeometry: turns,
                    thresholdPresent: false, rejectionReason: translation.clear ? null : 'wall-sweep:translation',
                };
            }
            const firstDirection = facing(start, waypoints[0]);
            const initialPose = sweepShapeMotion(start, start, firstDirection, firstDirection);
            if (!initialPose.clear) return {
                clear: false, contact: initialPose, points, turnGeometry: turns, thresholdPresent: true,
                rejectionReason: 'wall-sweep:initial-pose',
            };
            for (let index = 0; index < waypoints.length - 1; index += 1) {
                const segmentStart = index === 0 ? start : waypoints[index - 1];
                const waypoint = waypoints[index];
                const nextTarget = waypoints[index + 1];
                const threshold = facingAtThreshold(segmentStart, waypoint, nextTarget);
                const turnTargetDistance = threshold
                    ? pointToSegmentDistance(nextTarget, threshold.switchPoint, threshold.turnEnd)
                    : null;
                const turnTargetConflict = threshold
                    && doesTurnIntervalReachTarget(nextTarget, threshold.switchPoint, threshold.turnEnd, radius);
                if (!threshold || turnTargetConflict) {
                    const segmentDistance = Math.hypot(
                        waypoint.x - segmentStart.x, waypoint.y - segmentStart.y, waypoint.z - segmentStart.z,
                    );
                    return {
                        clear: false,
                        contact: { sourceName: !threshold
                            ? 'Steering threshold unavailable; see transition rejection details'
                            : 'GameLoop turn interval reaches the steering target' },
                        points, turnGeometry: turns, thresholdPresent: true,
                        rejectionReason: 'steering-threshold-reaches-target',
                        rejectionDetails: {
                            transitionIndex: index,
                            failure: !threshold
                                ? (segmentDistance <= radius * 2 ? 'incoming-leg-inside-arrival-band' : 'look-at-or-departure-envelope-unbounded')
                                : 'next-target-intersects-turn-arrival-band',
                            segmentStart, waypoint, nextTarget,
                            segmentDistance,
                            arrivalBandRadius: radius * 2,
                            switchPoint: threshold?.switchPoint || null,
                            turnEnd: threshold?.turnEnd || null,
                            nextTargetDistanceToTurnInterval: turnTargetDistance,
                        },
                    };
                }
                const approach = sweepShapeMotion(segmentStart, threshold.turnEnd, threshold.turnFrom, threshold.turnFrom);
                if (!approach.clear) return {
                    clear: false, contact: approach, points, turnGeometry: turns, thresholdPresent: true,
                    rejectionReason: 'wall-sweep:approach',
                };
                // A render callback may follow several fixed ticks. Cover every possible actual
                // position where the next callback can observe radius*2 and set the new look.
                const turnStartPose = sweepShapeMotion(threshold.switchPoint, threshold.switchPoint,
                    threshold.turnToStart, threshold.turnToStart);
                if (!turnStartPose.clear) return {
                    clear: false, contact: turnStartPose, points, turnGeometry: turns, thresholdPresent: true,
                    rejectionReason: 'wall-sweep:waypoint-turn-start',
                };
                const waypointTurn = sweepShapeMotion(threshold.switchPoint, threshold.turnEnd,
                    threshold.turnToStart, threshold.turnToEnd, 0,
                    (position) => facing({ x: position.x, y: position.y, z: position.z }, nextTarget), nextTarget);
                if (!waypointTurn.clear) return {
                    clear: false, contact: waypointTurn, points, turnGeometry: turns, thresholdPresent: true,
                    rejectionReason: 'wall-sweep:waypoint-turn',
                };
                turns.push({
                    switchPoint: threshold.switchPoint,
                    turnEnd: threshold.turnEnd,
                    turnMidpoint: threshold.turnMidpoint,
                    departureEnd: nextTarget,
                    departureEnvelope: threshold.departureEnvelope,
                });
                // Every possible departure ray is contained by the midpoint ray plus a
                // continuous position/look-at orientation envelope and the same actual wall probes.
                // For Frozen CP05/CP07, a proven straight positive ray may sweep the full
                // earliest-origin union directly. Every approach/turn/portal guard above stays.
                const collinear = expectedMapKey === 'frozen_helix'
                    && (expectedCheckpointId === 'CP05' || expectedCheckpointId === 'CP07')
                    ? resolveCollinearDeparture({ switchPoint: threshold.switchPoint, turnEnd: threshold.turnEnd,
                        target: nextTarget, arrivalBand: radius * 2, maxMotionDisplacement: maximumTurnDisplacement }) : null;
                const departure = collinear
                    ? sweepShapeMotion(collinear.from, collinear.to, threshold.turnToMiddle, threshold.turnToMiddle,
                        collinear.envelope)
                    : sweepShapeMotion(threshold.turnMidpoint, nextTarget,
                        threshold.turnToMiddle, threshold.turnToMiddle, threshold.departureEnvelope);
                if (!departure.clear) return {
                    clear: false, contact: departure, points, turnGeometry: turns, thresholdPresent: true,
                    rejectionReason: 'wall-sweep:departure',
                };
            }
            return { clear: true, contact: null, points, turnGeometry: turns, thresholdPresent: true, rejectionReason: null };
        };
        const pathConflicts = (points, predicate) => points.slice(1).some((point, index) => predicate(points[index], point));

        emitDiagnostic('initial-preflight', {
            start, target: end, speed, radius, playerVehicleId: player.vehicleId,
            visibility: document.visibilityState, focused: document.hasFocus(),
        });
        let driverWaypoints = [end];
        let portalDetourPairIndex = null;
        let selectedRouteId = null;
        let selectedRouteWaypoints = null;
        let directPath;
        let directCollision;
        let directPortalConflict;
        let checkpointEntrySelection = null;
        if (isRequiredNeonPinnedRoute) {
            // Pinned Neon routes own a fresh 65,536-pose budget and skip generic direct/entry probes.
            directPath = {
                clear: false,
                contact: { sourceName: `Required ${expectedCheckpointId} route preflight bypasses generic candidate probes` },
                points: [start, end],
                thresholdPresent: true,
                rejectionReason: 'required-route-preflight',
            };
            directCollision = directPath.contact;
            directPortalConflict = false;
        } else {
            directPath = evaluateDriverPath([end]);
            directCollision = directPath.clear ? { clear: true } : directPath.contact;
            directPortalConflict = pathConflicts(directPath.points, (from, to) => pathIntersectsPortal(from, to));
            emitDiagnostic('direct', {
                clear: directPath.clear, rejectionReason: directPath.rejectionReason,
                portalConflict: directPortalConflict, contact: directCollision.clear ? null : directCollision,
            });
        }
        if (!isRequiredNeonPinnedRoute && portalApproach === null && shouldSelectCheckpointEntryCandidate({
            kind,
            target,
            directWallClear: directCollision.clear,
            directPortalConflict,
        })) {
            const blockingPortal = portalEndpoints
                .map((endpoint) => ({
                    endpoint,
                    distance: pointToSegmentDistance(endpoint, start, end),
                }))
                .filter((entry) => entry.distance <= portalClearance)
                .sort((left, right) => left.distance - right.distance)[0]?.endpoint;
            const proposal = blockingPortal ? makeCheckpointEntryCandidate({
                start,
                checkpoint: target,
                playerRadius: radius,
                portal: blockingPortal,
                portalClearance,
                maxMotionDisplacement: maximumTurnDisplacement,
            }) : null;
            if (proposal) {
                const centerEnd = { ...end };
                end = proposal.position;
                const candidatePath = evaluateDriverPath([end]);
                const candidateCollision = candidatePath.clear ? { clear: true } : candidatePath.contact;
                const candidatePortalConflict = pathConflicts(candidatePath.points, (from, to) => pathIntersectsPortal(from, to));
                const candidateCheckpointConflict = pathConflicts(candidatePath.points,
                    (from, to) => pathHasUnorderedCheckpoint(from, to));
                const accepted = candidatePath.clear && !candidatePortalConflict && !candidateCheckpointConflict;
                checkpointEntrySelection = {
                    ...proposal,
                    accepted,
                    wallClear: candidatePath.clear,
                    rejectionReason: candidatePath.rejectionReason || null,
                    portalConflict: candidatePortalConflict,
                    unorderedCheckpointConflict: candidateCheckpointConflict,
                    contact: candidateCollision.clear ? null : candidateCollision,
                    blockingPortal: {
                        x: blockingPortal.x, y: blockingPortal.y, z: blockingPortal.z,
                        pairIndex: blockingPortal.pairIndex,
                        centerlineDistance: pointToSegmentDistance(blockingPortal, start, centerEnd),
                    },
                };
                if (accepted) {
                    directPath = candidatePath;
                    directCollision = { clear: true };
                    directPortalConflict = false;
                    distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
                    reachableFrames = Math.min(1200, Math.max(240, Math.ceil((distance / speed) * 60 * 3)));
                    closestDistance = distance;
                    driverWaypoints = [end];
                } else {
                    end = centerEnd;
                }
            } else {
                checkpointEntrySelection = {
                    accepted: false,
                    rejectionReason: 'invalid-or-degenerate-checkpoint-entry',
                    blockingPortal: blockingPortal ? {
                        x: blockingPortal.x, y: blockingPortal.y, z: blockingPortal.z,
                        pairIndex: blockingPortal.pairIndex,
                        centerlineDistance: pointToSegmentDistance(blockingPortal, start, end),
                    } : null,
                };
            }
            emitDiagnostic('checkpoint-entry', checkpointEntrySelection);
        }
        const forceNeonPinnedRouteHypothesis = isRequiredNeonPinnedRoute;
        if (!isRequiredNeonPinnedRoute && kind === 'checkpoint' && !directCollision.clear
            && checkpointEntryOverride === null && portalApproach === null) {
            const centerEnd = { ...end };
            for (const proposal of makeWallEntryCandidates({
                start, checkpoint: target, playerRadius: radius,
                maxMotionDisplacement: maximumTurnDisplacement,
                bidirectionalCheckpoints: route.rules?.bidirectionalCheckpoints === true,
            })) {
                end = proposal.position;
                const candidatePath = evaluateDriverPath([end]);
                const candidatePortalConflict = pathConflicts(candidatePath.points,
                    (from, to) => pathIntersectsPortal(from, to));
                const candidateCheckpointConflict = pathConflicts(candidatePath.points,
                    (from, to) => pathHasUnorderedCheckpoint(from, to));
                if (!candidatePath.clear || candidatePortalConflict || candidateCheckpointConflict) continue;
                checkpointEntrySelection = { ...proposal, accepted: true, wallClear: true,
                    portalConflict: false, checkpointConflict: false };
                directPath = candidatePath;
                directCollision = { clear: true };
                directPortalConflict = false;
                distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
                reachableFrames = Math.min(1200, Math.max(240, Math.ceil((distance / speed) * 60 * 3)));
                closestDistance = distance;
                driverWaypoints = [end];
                break;
            }
            if (checkpointEntrySelection?.accepted !== true) end = centerEnd;
        }
        if (!directCollision.clear || directPortalConflict || forceNeonPinnedRouteHypothesis) {
            const line = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
            const lineLength = Math.hypot(line.x, line.y, line.z) || 1;
            line.x /= lineLength;
            line.y /= lineLength;
            line.z /= lineLength;
            const upProjection = { x: -line.y * line.x, y: 1 - line.y * line.y, z: -line.y * line.z };
            const upLength = Math.hypot(upProjection.x, upProjection.y, upProjection.z);
            const sideProjection = {
                x: -line.z,
                y: 0,
                z: line.x,
            };
            const sideLength = Math.hypot(sideProjection.x, sideProjection.y, sideProjection.z);
            const directions = [];
            if (upLength > 0.0001) directions.push(
                { x: upProjection.x / upLength, y: upProjection.y / upLength, z: upProjection.z / upLength },
                { x: -upProjection.x / upLength, y: -upProjection.y / upLength, z: -upProjection.z / upLength },
            );
            if (sideLength > 0.0001) directions.push(
                { x: sideProjection.x / sideLength, y: sideProjection.y / sideLength, z: sideProjection.z / sideLength },
                { x: -sideProjection.x / sideLength, y: -sideProjection.y / sideLength, z: -sideProjection.z / sideLength },
            );

            const candidates = [];
            const detourCandidateDiagnostics = [];
            const addCandidate = (candidateWaypoints, pairIndex = null, routeId = null, entryProposal = null) => {
                const intermediate = Array.isArray(candidateWaypoints) ? candidateWaypoints : [candidateWaypoints];
                const candidateEnd = entryProposal?.position || end;
                const waypoints = [...intermediate, candidateEnd];
                const path = evaluateDriverPath(waypoints);
                const candidateOrdinal = detourCandidateDiagnostics.length + 1;
                const diagnostic = {
                    waypoints: intermediate.map((waypoint) => ({ x: waypoint.x, y: waypoint.y, z: waypoint.z })),
                    routeId,
                    target: candidateEnd,
                    thresholdPresent: path.thresholdPresent,
                    rejectionReason: path.rejectionReason,
                    turnDisplacementBound: maximumTurnDisplacement,
                    rejectionDetails: path.rejectionDetails || null,
                    sweepContact: path.rejectionReason?.startsWith('wall-sweep:') ? path.contact : null,
                };
                detourCandidateDiagnostics.push(diagnostic);
                if (!path.clear) {
                    if (candidateOrdinal <= 2) emitDiagnostic(`candidate-${candidateOrdinal}`, { candidate: diagnostic });
                    return { path, diagnostic };
                }
                if (hasPortalTurnEnvelopeConflict(path.points, portalEndpoints, portalClearance, maximumTurnDisplacement, path.turnGeometry)) {
                    diagnostic.rejectionReason = 'portal-clearance-envelope';
                    diagnostic.rejectionDetails = describePortalClearanceRejection(path.points, waypoints, path.turnGeometry);
                    if (candidateOrdinal <= 2) emitDiagnostic(`candidate-${candidateOrdinal}`, { candidate: diagnostic });
                    return { path, diagnostic };
                }
                if (pathConflicts(path.points, (from, to) => pathHasUnorderedCheckpoint(from, to, maximumTurnDisplacement))) {
                    diagnostic.rejectionReason = 'unordered-checkpoint-envelope';
                    if (candidateOrdinal <= 2) emitDiagnostic(`candidate-${candidateOrdinal}`, { candidate: diagnostic });
                    return { path, diagnostic };
                }
                candidates.push({
                    waypoints: intermediate,
                    end: { ...candidateEnd },
                    entryProposal,
                    routeId,
                    length: waypoints.reduce((total, point, index) => {
                        const from = index === 0 ? start : waypoints[index - 1];
                        return total + Math.hypot(point.x - from.x, point.y - from.y, point.z - from.z);
                    }, 0),
                    pairIndex,
                });
                if (candidateOrdinal <= 2) emitDiagnostic(`candidate-${candidateOrdinal}`, { candidate: diagnostic, accepted: true });
                return { path, diagnostic };
            };
            if (forceNeonPinnedRouteHypothesis) {
                // Required CP04â€“CP06 Neon routes must pass this same full live sweep before selection.
                addCandidate(requiredRouteWaypoints, null, requiredRouteId);
            } else {
            if (directPortalConflict) {
                for (const endpoint of portalEndpoints) {
                    if (pointToSegmentDistance(endpoint, start, end) > portalClearance) continue;
                    for (const direction of directions) {
                        for (const clearanceScale of [2, 2.5, 3]) {
                            addCandidate({
                                x: endpoint.x + direction.x * portalClearance * clearanceScale,
                                y: endpoint.y + direction.y * portalClearance * clearanceScale,
                                z: endpoint.z + direction.z * portalClearance * clearanceScale,
                            }, endpoint.pairIndex);
                        }
                    }
                }
            }
            if (!directCollision.clear) {
                const box = directCollision.obstacleBox;
                if (!box) {
                    throw new Error(`Actual wall probe hit has no obstacle bounds for a bounded detour on ${expectedMapKey}; `
                        + `source=${directCollision.sourceName || 'arena bounds'} contact=${JSON.stringify(directCollision.point)}`);
                }
                const line = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
                const lineLength = Math.hypot(line.x, line.y, line.z) || 1;
                line.x /= lineLength; line.y /= lineLength; line.z /= lineLength;
                const sideLength = Math.hypot(line.z, line.x);
                if (sideLength <= 0.0001) throw new Error(`Cannot bound a wall detour perpendicular to route on ${expectedMapKey}`);
                const sides = [{ x: -line.z / sideLength, y: 0, z: line.x / sideLength },
                    { x: line.z / sideLength, y: 0, z: -line.x / sideLength }];
                const center = {
                    x: (box.min.x + box.max.x) / 2,
                    y: (box.min.y + box.max.y) / 2,
                    z: (box.min.z + box.max.z) / 2,
                };
                for (const side of sides) {
                    const projectedHalfExtent = Math.abs(side.x) * (box.max.x - box.min.x) / 2
                        + Math.abs(side.y) * (box.max.y - box.min.y) / 2
                        + Math.abs(side.z) * (box.max.z - box.min.z) / 2;
                    const clearance = projectedHalfExtent + wallShape.boundRadius * modelScale + directCollision.probeRadius;
                    addCandidate({ x: center.x + side.x * clearance, y: center.y + side.y * clearance, z: center.z + side.z * clearance });
                }
                const contactProbeRadius = Number(directCollision.probeRadius);
                const cornerClearance = maximumTurnDisplacement + wallShape.boundRadius * modelScale + contactProbeRadius;
                if (!Number.isFinite(cornerClearance) || cornerClearance < 0) {
                    throw new Error(`Cannot bound a wall-corner detour on ${expectedMapKey}; `
                        + `turn=${maximumTurnDisplacement} wallRadius=${wallShape.boundRadius} `
                        + `modelScale=${modelScale} probeRadius=${directCollision.probeRadius}`);
                }
                addCandidate({
                    x: box.min.x - cornerClearance,
                    y: end.y,
                    z: box.min.z - cornerClearance,
                });
                const westArenaBound = arena.bounds?.minX;
                if (!Number.isFinite(westArenaBound)) {
                    throw new Error(`Cannot bound a west-edge detour on ${expectedMapKey}; minX=${westArenaBound}`);
                }
                const westEdgeCandidate = {
                    x: westArenaBound + cornerClearance,
                    y: end.y,
                    z: box.min.z - cornerClearance,
                };
                const westEdgeAttempt = addCandidate(westEdgeCandidate);
                const approachBlocker = westEdgeAttempt?.path?.contact?.obstacleBox;
                const approachProbeRadius = westEdgeAttempt?.path?.contact?.probeRadius;
                if (westEdgeAttempt?.path?.rejectionReason === 'wall-sweep:approach'
                    && approachBlocker && Number.isFinite(approachProbeRadius) && approachProbeRadius >= 0) {
                    const overflightBodyClearance = wallShape.boundRadius * modelScale
                        + Math.max(contactProbeRadius, approachProbeRadius);
                    let entryFraction = 0;
                    let exitFraction = 1;
                    for (const axis of ['x', 'z']) {
                        const delta = westEdgeCandidate[axis] - start[axis];
                        const minimum = approachBlocker.min[axis] - overflightBodyClearance;
                        const maximum = approachBlocker.max[axis] + overflightBodyClearance;
                        if (Math.abs(delta) <= 0.000001) {
                            if (start[axis] < minimum || start[axis] > maximum) {
                                entryFraction = Infinity;
                                break;
                            }
                            continue;
                        }
                        const first = (minimum - start[axis]) / delta;
                        const second = (maximum - start[axis]) / delta;
                        entryFraction = Math.max(entryFraction, Math.min(first, second));
                        exitFraction = Math.min(exitFraction, Math.max(first, second));
                    }
                    entryFraction = Math.max(0, entryFraction);
                    const overflightY = start.y
                        + (approachBlocker.max.y + cornerClearance - start.y) / entryFraction;
                    const maximumSafeY = arena.bounds.maxY - cornerClearance;
                    if (Number.isFinite(entryFraction) && entryFraction > 0 && entryFraction <= 1
                        && Number.isFinite(exitFraction) && exitFraction >= entryFraction
                        && Number.isFinite(overflightY) && overflightY > start.y
                        && Number.isFinite(maximumSafeY) && overflightY <= maximumSafeY) {
                        addCandidate({ ...westEdgeCandidate, y: overflightY });
                    }
                }
            }
            if (expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
                && expectedCheckpointId === 'CP03' && target.routeIndex === 2) {
                // This one authored CP03 candidate still traverses the same full live wall,
                // turn, portal-clearance, and unordered-checkpoint preflight as every detour.
                addCandidate({ x: -115, y: 76, z: -150 });
            }
            if (expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
                && expectedCheckpointId === 'CP07' && target.routeIndex === 6) {
                // Cross above the south chicane before descending on the entry side.
                // All segments retain the live hull, turn, portal and checkpoint sweeps.
                addCandidate([
                    { x: 180, y: 90, z: 180 },
                    { x: 35, y: 90, z: 180 },
                ]);
            }
            if (expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
                && expectedCheckpointId === 'CP08' && target.routeIndex === 7) {
                addCandidate([
                    { x: -150, y: 90, z: 180 },
                ]);
            }
            if (expectedMapKey === 'neon_circuit' && kind === 'checkpoint'
                && expectedCheckpointId === 'CP09' && target.routeIndex === 8) {
                addCandidate([
                    { x: -160, y: 105, z: 95 },
                    { x: -195, y: 70, z: 65 },
                ]);
            }
            if (expectedMapKey === 'frozen_helix' && kind === 'checkpoint'
                && ((expectedCheckpointId === 'CP02' && target.routeIndex === 1)
                    || (expectedCheckpointId === 'CP03' && target.routeIndex === 2))) {
                // Keep legal ring poses for routes around the start deck and the central ice pillar.
                // Each complete route retains the same hull, turn and checkpoint checks.
                const waypoints = expectedCheckpointId === 'CP02' ? [
                    { x: start.x, y: 315, z: start.z },
                    { x: end.x, y: 315, z: end.z },
                ] : [
                    { x: -105, y: 250, z: -105 },
                ];
                for (const proposal of makeWallEntryCandidates({
                    start: waypoints.at(-1), checkpoint: target, playerRadius: radius,
                    maxMotionDisplacement: maximumTurnDisplacement,
                    bidirectionalCheckpoints: route.rules?.bidirectionalCheckpoints === true,
                })) {
                    addCandidate(waypoints, null, null, proposal);
                }
            }
            if (expectedMapKey === 'frozen_helix' && kind === 'checkpoint'
                && expectedCheckpointId === 'CP05' && target.routeIndex === 4) {
                // Approach the bore from its open south end, outside the intervening
                // stalactites and platform. Preserve the full hull/turn/portal guards.
                const waypoints = [{ x: 90, y: 240, z: 140 }, { x: 90, y: 150, z: 140 }, { x: 90, y: 150, z: 110 }];
                addCandidate(waypoints);
                for (const proposal of makeWallEntryCandidates({
                    start: waypoints.at(-1), checkpoint: target, playerRadius: radius,
                    maxMotionDisplacement: maximumTurnDisplacement,
                    bidirectionalCheckpoints: route.rules?.bidirectionalCheckpoints === true,
                })) addCandidate(waypoints, null, null, proposal);
            }
            if (expectedMapKey === 'frozen_helix' && kind === 'checkpoint'
                && expectedCheckpointId === 'CP06' && target.routeIndex === 5) {
                // Leave through the north bore before turning west. Climb within the
                // opening to clear the platform outside its mouth; retain every sweep.
                addCandidate(frozenCp06Waypoints);
                for (const proposal of makeWallEntryCandidates({
                    start: frozenCp06Waypoints.at(-1), checkpoint: target, playerRadius: radius,
                    maxMotionDisplacement: maximumTurnDisplacement,
                    bidirectionalCheckpoints: route.rules?.bidirectionalCheckpoints === true,
                })) addCandidate(frozenCp06Waypoints, null, null, proposal);
            }
            if (expectedMapKey === 'frozen_helix' && kind === 'checkpoint'
                && expectedCheckpointId === 'CP07' && target.routeIndex === 6) {
                // Enter the open lower tube mouth from below, around the central pillar.
                // The final vertical approach retains the exact positive-ray proof.
                addCandidate(frozenCp07Waypoints);
            }
            if (expectedMapKey === 'chrono_spillway' && kind === 'checkpoint'
                && Object.hasOwn(chronoWaypoints, expectedCheckpointId)) {
                const routeIndices = { CP05: 4, CP09: 8, CP10: 9, CP11: 10, CP12: 11 };
                if (target.routeIndex === routeIndices[expectedCheckpointId]) {
                    // Exit each bore through its open mouth before changing direction;
                    // CP05 keeps moving east instead of doubling back into the old trail.
                    addCandidate(chronoWaypoints[expectedCheckpointId]);
                }
            }
            }
            console.info(`K19_DETOUR_DIAGNOSTIC ${JSON.stringify({
                mapKey: expectedMapKey,
                checkpointId: expectedCheckpointId,
                start,
                target: end,
                bidirectionalCheckpoints: route.rules?.bidirectionalCheckpoints ?? null,
                checkpointEntrySelection,
                checkpointEntryOverride,
                turnDisplacementBound: maximumTurnDisplacement,
                directBlocker: {
                    sourceName: directCollision.sourceName || null,
                    point: directCollision.point || directCollision.sample || null,
                    obstacleBox: directCollision.obstacleBox || null,
                    probeRadius: directCollision.probeRadius ?? null,
                },
                candidates: detourCandidateDiagnostics,
            })}`);
            const selectedCandidate = chooseRouteCandidate(candidates, requiredRouteId, requiredRouteWaypoints);
            if (!selectedCandidate) {
                throw new Error(
                    `No live collision/portal-safe route to authored ${kind} ${expectedCheckpointId || 'finish'} on ${expectedMapKey}; `
                    + `requiredRouteId=${requiredRouteId || 'shortest-safe-candidate'} `
                    + `start=${JSON.stringify(start)} target=${JSON.stringify(end)} portalClearance=${portalClearance} `
                    + `hull=${radius} blocker=${JSON.stringify(directCollision.point || directCollision.sample || null)} `
                    + `turnDisplacementBound=${maximumTurnDisplacement.toFixed(2)} maxTicks=${maximumTicksPerFrame} `
                    + `bidirectionalCheckpoints=${route.rules?.bidirectionalCheckpoints ?? null} `
                    + `checkpointEntrySelection=${JSON.stringify(checkpointEntrySelection)} `
                    + `candidateDiagnostics=${JSON.stringify(detourCandidateDiagnostics)} bounds=${JSON.stringify(arena.bounds)}`
                );
            }
            end = selectedCandidate.end;
            if (selectedCandidate.entryProposal) {
                checkpointEntrySelection = { ...selectedCandidate.entryProposal, accepted: true,
                    wallClear: true, portalConflict: false, checkpointConflict: false };
            }
            driverWaypoints = [...selectedCandidate.waypoints, end];
            selectedRouteId = selectedCandidate.routeId;
            selectedRouteWaypoints = selectedCandidate.waypoints.map((waypoint) => ({ ...waypoint }));
            distance = measurePolyline(start, driverWaypoints);
            if (!Number.isFinite(distance) || distance <= 0) {
                throw new Error(`Invalid selected K19 waypoint polyline on ${expectedMapKey}; waypoints=${JSON.stringify(driverWaypoints)}`);
            }
            reachableFrames = Math.min(1200, Math.max(240, Math.ceil((distance / speed) * 60 * 3)));
            closestDistance = distance;
            portalDetourPairIndex = selectedCandidate.pairIndex;
        }

        const routeIndex = kind === 'finish'
            ? route.totalCheckpoints
            : target.routeIndex;
        if (!Number.isInteger(routeIndex) || routeIndex < 0) {
            throw new Error(`Invalid route index for ${expectedCheckpointId || 'finish'} on ${expectedMapKey}`);
        }
        const expectedPassedIndex = kind === 'finish' ? route.totalCheckpoints : routeIndex + 1;
        const maxFrames = 1800;
        let waypointIndex = 0;
        let previousDriverPosition = { x: start.x, y: start.y, z: start.z };
        let completedRafCallbacks = 0;
        let heartbeatCount = 0;
        emitDiagnostic('live', {
            waypoints: driverWaypoints,
            target: end,
            selectedDetourPairIndex: portalDetourPairIndex,
            checkpointEntrySelection,
            checkpointEntryOverride,
            firstWaypoint: driverWaypoints[0] || null,
            playerState: {
                alive: player.alive !== false,
                hp: Number(player.hp),
                deathCause: player.lastDeathCause || null,
                position: { x: player.position.x, y: player.position.y, z: player.position.z },
                speed: Number(player.speed) || 0,
            },
        });
        let segmentTimeoutObserver = null;
        let segmentTimeoutSnapshot = null;
        try {
        if (shouldObserveSegmentTimeout(expectedMapKey, expectedCheckpointId)) {
            const installObserver = new Function(`return (${segmentTimeoutObserverSource});`)();
            segmentTimeoutObserver = installObserver({
                progressSystem,
                expectedPlayer: player,
                getContext: () => {
                    const timing = gameLoop?.getRenderTiming?.();
                    return {
                        mapKey: expectedMapKey,
                        checkpointId: expectedCheckpointId,
                        startPosition: start,
                        startSpeed: speed,
                        selectedWaypoint: driverWaypoints[0] || null,
                        currentWaypoint: driverWaypoints[waypointIndex] || null,
                        previousDriverPosition,
                        waypointIndex,
                        completedRafCallbacks,
                        simulationClockMs: entityManager?._simulationClockMs,
                        renderTiming: timing ? {
                            frameId: timing.frameId,
                            rawDt: timing.rawDt,
                            stabilizedDt: timing.stabilizedDt,
                            reset: timing.reset,
                            resetReason: timing.resetReason,
                            timestampMs: timing.timestampMs,
                        } : null,
                    };
                },
                onSnapshot: (snapshot) => {
                    segmentTimeoutSnapshot = snapshot;
                    console.info(`K19_SEGMENT_TIMEOUT_DIAGNOSTIC ${JSON.stringify(snapshot)}`);
                },
            });
        }
        let boostInput = null;
        if ((expectedMapKey === 'neon_circuit' && expectedCheckpointId === 'CP02')
            || (expectedMapKey === 'frozen_helix'
                && (expectedCheckpointId === 'CP05' || expectedCheckpointId === 'CP07'))) {
            const boostKey = game?.settings?.controls?.PLAYER_1?.BOOST;
            const boostGateCount = (arena.specialGates || []).filter((gate) => gate?.type === 'boost').length;
            const boostAlreadyActive = player.manualBoostActive === true || player.isBoosting === true
                || Number(player.boostPortalTimer) > 0;
            const inputManager = game.runtimeFacade?.getRuntimeHandle?.('input');
            const chargeBefore = Number(player.boostCharge);
            const positionBeforeInput = { x: player.position.x, y: player.position.y, z: player.position.z };
            const progressBeforeInput = progressSystem.getPlayerProgressSnapshot(0);
            if (boostKey !== 'ShiftLeft' || boostGateCount < 1 || boostActive !== true
                || player.alive === false || Number(player.hp) <= 0
                || entityManager.players?.[0] !== player || arena.currentMapKey !== expectedMapKey
                || runtime.phase !== 'racing' || progressBeforeInput?.nextCheckpointIndex !== currentProgress.nextCheckpointIndex
                || currentProgress.nextCheckpointIndex !== routeIndex || progressBeforeInput?.nextCheckpointIndex !== routeIndex
                || currentProgress.completed === true || progressBeforeInput?.completed === true
                || progressBeforeInput?.resetCount !== currentProgress.resetCount
                || progressBeforeInput?.checkpointRespawnsUsed !== currentProgress.checkpointRespawnsUsed
                || positionBeforeInput.x !== start.x || positionBeforeInput.y !== start.y || positionBeforeInput.z !== start.z) {
                throw new Error(`K19 ${expectedMapKey} ${expectedCheckpointId} preflight-to-input identity changed; key=${boostKey} gates=${boostGateCount} `
                    + `guardBoost=${boostActive} start=${JSON.stringify(start)} player=${JSON.stringify(positionBeforeInput)} `
                    + `progress=${progressBeforeInput?.nextCheckpointIndex}/${currentProgress.nextCheckpointIndex}/${routeIndex} `
                    + `reset=${progressBeforeInput?.resetCount}/${currentProgress.resetCount} `
                    + `respawns=${progressBeforeInput?.checkpointRespawnsUsed}/${currentProgress.checkpointRespawnsUsed}`);
            }
            if (boostAlreadyActive) {
                boostInput = { status: 'already-active-preserved', preflightCompleted: true, chargeBefore, chargeAfter: chargeBefore, events: [] };
            } else {
                if (!inputManager || !Number.isFinite(chargeBefore) || chargeBefore <= 0
                    || inputManager.keys?.[boostKey] === true) {
                    throw new Error(`K19 ${expectedMapKey} ${expectedCheckpointId} normal boost input is unavailable after preflight; charge=${chargeBefore} `
                        + `inputManager=${!!inputManager} keyHeld=${inputManager?.keys?.[boostKey] === true}`);
                }
                const events = [];
                try {
                    events.push('keydown');
                    window.dispatchEvent(new KeyboardEvent('keydown', {
                        code: boostKey, key: 'Shift', bubbles: true, cancelable: true,
                    }));
                } finally {
                    events.push('keyup');
                    window.dispatchEvent(new KeyboardEvent('keyup', {
                        code: boostKey, key: 'Shift', bubbles: true, cancelable: true,
                    }));
                }
                const inputEdgeRecorded = inputManager.justPressed?.[boostKey] === true
                    && inputManager.keys?.[boostKey] !== true;
                if (!inputEdgeRecorded) {
                    throw new Error(`K19 ${expectedMapKey} ${expectedCheckpointId} Shift edge did not reach the existing InputManager; events=${events.join('/')}`);
                }
                boostInput = { status: 'pending-first-driver-frame', preflightCompleted: true, inputEdgeRecorded, chargeBefore, events };
            }
            console.info(`K19_BOOST_INPUT_DIAGNOSTIC ${JSON.stringify({ phase: 'post-preflight-input', ...boostInput, player: positionBeforeInput, progress: progressBeforeInput?.nextCheckpointIndex, boostGateCount })}`);
        }
        for (let frame = 0; frame < maxFrames; frame += 1) {
            const progress = progressSystem.getPlayerProgressSnapshot(0);
            failIfRunChanged(progress, kind === 'finish' && progress?.completed === true ? 'portal' : 'racing');
            if (kind === 'finish' ? progress?.completed === true : progress?.nextCheckpointIndex >= expectedPassedIndex) {
                if (boostInput?.status === 'pending-first-driver-frame') {
                    throw new Error(`K19 ${expectedMapKey} ${expectedCheckpointId} cannot pass before first-frame normal boost activation and charge-consumption proof`);
                }
                return {
                    mapKey: expectedMapKey,
                    checkpointId: kind === 'finish' ? route.finish.id : expectedCheckpointId,
                    passedIndex: progress.nextCheckpointIndex,
                    routeIndex,
                    playerHullRadius: radius,
                    vehicleId: player.vehicleId,
                    modelScale: player.modelScale,
                    wrongOrderCount: progress.wrongOrderCount,
                    finishCompleted: progress.completed,
                    portalDetourPairIndex,
                    selectedRouteId,
                    selectedRouteWaypoints,
                    portalApproach,
                    checkpointEntrySelection,
                    checkpointEntryOverride,
                    entryOverrideApplied: portalApproach !== null || checkpointEntryOverride !== null,
                    turnTimingBound: {
                        maximumTicksPerFrame,
                        fixedStep: loopStep,
                        timeScale: loopTimeScale,
                        motionSeconds: maximumMotionSecondsPerFrame,
                        maximumSpeed: maximumTurnSpeed,
                        maximumDisplacement: maximumTurnDisplacement,
                    },
                };
            }

            const steeringTarget = driverWaypoints[waypointIndex];
            const incomingStart = getIncomingStart(start, driverWaypoints, waypointIndex);
            if (!incomingStart) throw new Error(`Invalid K19 incoming route segment at waypoint ${waypointIndex} on ${expectedMapKey}`);
            if (waypointIndex < driverWaypoints.length - 1 && hasCrossedWaypointArrivalBand(
                    previousDriverPosition,
                    player.position,
                    steeringTarget,
                    incomingStart,
                    radius,
                )) {
                const reachedWaypoint = steeringTarget;
                const reachedWaypointIndex = waypointIndex;
                waypointIndex += 1;
                emitDiagnostic('waypoint-advance', {
                    completedRafCallbacks,
                    reachedWaypointIndex,
                    reachedWaypoint,
                    nextWaypointIndex: waypointIndex,
                    nextSteeringTarget: driverWaypoints[waypointIndex] || null,
                    playerPosition: { x: player.position.x, y: player.position.y, z: player.position.z },
                });
            }
            const nextTarget = driverWaypoints[waypointIndex];
            previousDriverPosition = { x: player.position.x, y: player.position.y, z: player.position.z };
            player.setLookAtWorld(nextTarget.x, nextTarget.y, nextTarget.z);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            completedRafCallbacks += 1;
            failIfSegmentTimeout(segmentTimeoutSnapshot, expectedMapKey, expectedCheckpointId);
            if (diagnosticCapture && completedRafCallbacks === 1) {
                const firstFrameProgress = progressSystem.getPlayerProgressSnapshot(0);
                const firstFrameTiming = gameLoop?.getRenderTiming?.();
                emitDiagnostic('first-frame', {
                    completedRafCallbacks,
                    waypointIndex,
                    steeringTarget: nextTarget,
                    previousPosition: previousDriverPosition,
                    player: {
                        position: { x: player.position.x, y: player.position.y, z: player.position.z },
                        speed: Number(player.speed) || 0,
                        alive: player.alive !== false,
                        hp: Number(player.hp),
                        deathCause: player.lastDeathCause || null,
                    },
                    progress: firstFrameProgress?.nextCheckpointIndex,
                    renderTiming: firstFrameTiming ? {
                        frameId: firstFrameTiming.frameId,
                        rawDt: firstFrameTiming.rawDt,
                        stabilizedDt: firstFrameTiming.stabilizedDt,
                        reset: firstFrameTiming.reset,
                        resetReason: firstFrameTiming.resetReason,
                        timestampMs: firstFrameTiming.timestampMs,
                    } : null,
                });
            }
            if (boostInput?.status === 'pending-first-driver-frame') {
                const frameProgress = progressSystem.getPlayerProgressSnapshot(0);
                const chargeAfter = Number(player.boostCharge);
                const activated = player.manualBoostActive === true && Number.isFinite(chargeAfter)
                    && chargeAfter < boostInput.chargeBefore;
                console.info(`K19_BOOST_INPUT_DIAGNOSTIC ${JSON.stringify({
                    phase: 'first-validated-driver-frame', preflightCompleted: boostInput.preflightCompleted,
                    frame: completedRafCallbacks, active: player.manualBoostActive === true,
                    isBoosting: player.isBoosting === true, chargeBefore: boostInput.chargeBefore, chargeAfter,
                    progress: frameProgress?.nextCheckpointIndex, position: { x: player.position.x, y: player.position.y, z: player.position.z },
                })}`);
                if (!activated) {
                    throw new Error(`K19 ${expectedMapKey} ${expectedCheckpointId} normal InputManager boost did not activate and consume charge on the first validated driver frame; `
                        + `active=${player.manualBoostActive === true} charge=${boostInput.chargeBefore}->${chargeAfter} `
                        + `progress=${frameProgress?.nextCheckpointIndex}`);
                }
                boostInput = { ...boostInput, status: 'activated', chargeAfter };
            }
            if (diagnosticCapture && completedRafCallbacks % 60 === 0 && heartbeatCount < 30) {
                heartbeatCount += 1;
                const timing = gameLoop?.getRenderTiming?.();
                const afterCallbackProgress = progressSystem.getPlayerProgressSnapshot(0);
                emitDiagnostic('heartbeat', {
                    completedRafCallbacks, heartbeatCount,
                    player: { x: player.position.x, y: player.position.y, z: player.position.z, speed: Number(player.speed) || 0 },
                    progress: afterCallbackProgress?.nextCheckpointIndex,
                    waypointIndex, steeringTarget: nextTarget,
                    visibility: document.visibilityState, focused: document.hasFocus(),
                    renderTiming: timing ? {
                        frameId: timing.frameId, rawDt: timing.rawDt, stabilizedDt: timing.stabilizedDt,
                        reset: timing.reset, resetReason: timing.resetReason, timestampMs: timing.timestampMs,
                    } : null,
                });
            }

            const afterFrame = progressSystem.getPlayerProgressSnapshot(0);
            if (diagnosticCapture && (player.alive === false || Number(player.hp) <= 0 || player.lastDeathCause)) {
                emitDiagnostic('death-state', {
                    completedRafCallbacks,
                    waypointIndex,
                    steeringTarget: nextTarget,
                    player: {
                        position: { x: player.position.x, y: player.position.y, z: player.position.z },
                        speed: Number(player.speed) || 0,
                        alive: player.alive !== false,
                        hp: Number(player.hp),
                        deathCause: player.lastDeathCause || null,
                    },
                    progress: afterFrame?.nextCheckpointIndex,
                    resetCount: afterFrame?.resetCount,
                    checkpointRespawnsUsed: afterFrame?.checkpointRespawnsUsed,
                });
            }
            failIfRunChanged(afterFrame, kind === 'finish' && afterFrame?.completed === true ? 'portal' : 'racing');
            const current = player.position;
            const remaining = measureRemainingPolyline(current, start, driverWaypoints, waypointIndex);
            if (!Number.isFinite(remaining)) throw new Error(`Invalid K19 remaining polyline distance on ${expectedMapKey}`);
            if (remaining <= closestDistance - progressDistance) {
                closestDistance = remaining;
                closestFrame = frame + 1;
            }
            if (remaining > radius + target.radius + 4 && frame + 1 >= reachableFrames
                && frame + 1 - closestFrame >= stalledFrames) {
                const next = progressSystem.getPlayerProgressSnapshot(0);
                if (kind === 'finish' ? next?.completed !== true : next?.nextCheckpointIndex < expectedPassedIndex) {
                    throw new Error(
                        `Player stalled before authored ${kind} ${expectedCheckpointId || 'finish'} on ${expectedMapKey}; `
                        + `frames=${frame + 1}/${maxFrames} reachableAfter=${reachableFrames} stalledFrames=${frame + 1 - closestFrame} `
                        + `remaining=${remaining.toFixed(2)} closest=${closestDistance.toFixed(2)} `
                        + `hull=${radius} speed=${speed.toFixed(2)} progress=${next?.nextCheckpointIndex}/${route.totalCheckpoints} `
                        + `player=${JSON.stringify({ x: current.x, y: current.y, z: current.z })}`
                    );
                }
            }
        }
        const progress = progressSystem.getPlayerProgressSnapshot(0);
        throw new Error(
            `Timed out traversing ${kind} ${expectedCheckpointId || 'finish'} on ${expectedMapKey}; `
            + `progress=${progress?.nextCheckpointIndex}/${route.totalCheckpoints} hull=${radius} start=${JSON.stringify(start)} `
            + `target=${JSON.stringify(end)} player=${JSON.stringify({ x: player.position.x, y: player.position.y, z: player.position.z })}`
        );
        } finally {
            segmentTimeoutObserver?.restore();
        }
    }, {
        expectedMapKey: mapKey,
        expectedMapIndex: mapIndex,
        expectedCheckpointId: checkpointId,
        kind: targetKind,
        minThickness: ARCADE_HITBOX_MIN_THICKNESS,
        maxSweepSteps: ARCADE_SWEEP_MAX_STEPS,
        altitudeSpeedMax: ALTITUDE_SPEED_MAX_MULTIPLIER,
        speedUpMultiplier: PICKUP_REGISTRY.SPEED_UP.multiplier,
        speedEffectDefinitions: {
            SPEED_UP: { multiplier: PICKUP_REGISTRY.SPEED_UP.multiplier, allowedModes: PICKUP_REGISTRY.SPEED_UP.allowedModes },
            SLOW_DOWN: { multiplier: PICKUP_REGISTRY.SLOW_DOWN.multiplier, allowedModes: PICKUP_REGISTRY.SLOW_DOWN.allowedModes },
        },
        diagnosticTargetOrdinal: effectiveDiagnosticTargetOrdinal,
        frozenCp06Waypoints: K19_FROZEN_CP06_WAYPOINTS,
        frozenCp07Waypoints: K19_FROZEN_CP07_WAYPOINTS,
        chronoWaypoints: K19_CHRONO_CHECKPOINT_WAYPOINTS,
        checkpointEntrySource: K19_CHECKPOINT_ENTRY_SOURCE,
        checkpointEntryEligibilitySource: K19_CHECKPOINT_ENTRY_ELIGIBILITY_SOURCE,
        arrivalTransitionSource: K19_WAYPOINT_TRANSITION_SOURCE,
        waypointIncomingStartSource: K19_WAYPOINT_INCOMING_START_SOURCE,
        waypointPolylineLengthSource: K19_WAYPOINT_POLYLINE_LENGTH_SOURCE,
        waypointPolylineRemainingSource: K19_WAYPOINT_POLYLINE_REMAINING_SOURCE,
        turnIntervalReachesTargetSource: K19_TURN_INTERVAL_REACHES_TARGET_SOURCE,
        routeCandidateSelectionSource: K19_ROUTE_CANDIDATE_SELECTION_SOURCE,
        maxOrientationDeviationSource: K19_MAX_ORIENTATION_DEVIATION_SOURCE,
        collinearDepartureSource: K19_COLLINEAR_DEPARTURE_SOURCE,
        routePreflightPlanSource: K19_ROUTE_PREFLIGHT_PLAN_SOURCE,
        timeoutObserverEligibilitySource: K19_TIMEOUT_OBSERVER_ELIGIBILITY_SOURCE,
        failOnSegmentTimeoutSource: K19_FAIL_ON_SEGMENT_TIMEOUT_SOURCE,
        requiredRouteId: mapKey === 'neon_circuit' && targetKind === 'checkpoint'
            ? (checkpointId === 'CP04' ? K19_NEON_CP04_ROUTE_ID
                : (checkpointId === 'CP05' ? K19_NEON_CP05_ROUTE_ID
                : (checkpointId === 'CP06' ? K19_NEON_CP06_ROUTE_ID : null)))
            : null,
        requiredRouteWaypoints: mapKey === 'neon_circuit' && targetKind === 'checkpoint'
            ? (checkpointId === 'CP04' ? K19_NEON_CP04_ROUTE_WAYPOINTS
                : (checkpointId === 'CP05' ? K19_NEON_CP05_ROUTE_WAYPOINTS
                : (checkpointId === 'CP06' ? K19_NEON_CP06_ROUTE_WAYPOINTS : null)))
            : null,
        cp05EntryOverrideSource: K19_CP05_ENTRY_OVERRIDE_SOURCE,
        wallCheckpointEntrySource: K19_WALL_CHECKPOINT_ENTRY_SOURCE,
        portalTurnEnvelopeSource: K19_PORTAL_TURN_ENVELOPE_SOURCE,
        segmentTimeoutObserverSource: K19_SEGMENT_TIMEOUT_OBSERVER_SOURCE,
    });
        const targetResult = diagnosticCapture && effectiveDiagnosticTargetOrdinal === 1
            ? await runK19TargetWithCpuProfile({ page, testInfo, runTarget })
            : await runTarget();
        if (diagnosticCapture) console.info(`K19_TARGET_DIAGNOSTIC ${JSON.stringify({ phase: 'done', ordinal: effectiveDiagnosticTargetOrdinal, mapKey, checkpointId: checkpointId || null, targetKind, result: targetResult })}`);
        return targetResult;
    } catch (error) {
        if (diagnosticCapture) console.info(`K19_TARGET_DIAGNOSTIC ${JSON.stringify({ phase: 'done', ordinal: effectiveDiagnosticTargetOrdinal, mapKey, checkpointId: checkpointId || null, targetKind, error: String(error?.message || error) })}`);
        throw error;
    }
}

async function driveExitPortal(page, { mapKey, mapIndex, nextMapKey }) {
    return page.evaluate(async ({ expectedMapKey, expectedMapIndex, expectedNextMapKey, minThickness, maxSweepSteps }) => {
        const game = window.GAME_INSTANCE;
        const entityManager = game?.entityManager;
        const arena = game?.arena;
        const runtime = game?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime;
        const player = entityManager?.players?.[0];
        const portal = arena?.exitPortals?.[0];
        const progressSystem = entityManager?._parcoursProgressSystem;
        const progressAtEntry = progressSystem?.getPlayerProgressSnapshot?.(0);
        const hudAtEntry = runtime?.getHudState?.();
        const wallShape = player?.arcadeHitbox?.wall;
        const modelScale = Number(player?.modelScale) > 0 ? Number(player.modelScale) : 1;
        if (!player || !portal || !progressSystem || arena.currentMapKey !== expectedMapKey || runtime?.phase !== 'portal'
            || runtime.mapIndex !== expectedMapIndex || runtime.entityManager !== entityManager
            || hudAtEntry?.runType !== 'five_portals' || hudAtEntry.chainId !== 'portal_chain_k19'
            || hudAtEntry.mapIndex !== expectedMapIndex || hudAtEntry.currentMapKey !== expectedMapKey
            || progressAtEntry?.completed !== true || player.alive === false || Number(player.hp) <= 0
            || !wallShape || !Number.isInteger(wallShape.count) || wallShape.count < 1
            || !(wallShape.boxes instanceof Float64Array) || !(wallShape.boxReach instanceof Float64Array)
            || !(wallShape.probes instanceof Float64Array) || !(wallShape.probeStart instanceof Int32Array)
            || !Number.isFinite(wallShape.boundRadius) || wallShape.boundRadius <= 0
            || typeof arena.checkCollisionBroad !== 'function' || typeof arena.getCollisionInfo !== 'function') {
            throw new Error(`K19 live exit unavailable on ${expectedMapKey}`);
        }
        const start = { x: player.position.x, y: player.position.y, z: player.position.z };
        const end = { x: portal.pos.x, y: portal.pos.y, z: portal.pos.z };
        const identity = { game, entityManager, arena, runtime, player, progressSystem };
        const initialDeathCause = player.lastDeathCause || '';
        const failIfPortalRunChanged = (progress) => {
            const hud = runtime?.getHudState?.();
            const livePlayer = entityManager?.players?.[0];
            if (window.GAME_INSTANCE !== identity.game || game.entityManager !== identity.entityManager || game.arena !== identity.arena
                || game.runtimeFacade?._arcadeSupport?.fivePortalsRuntime !== identity.runtime
                || runtime?.entityManager !== identity.entityManager || entityManager.players?.[0] !== identity.player
                || entityManager._parcoursProgressSystem !== identity.progressSystem || arena.currentMapKey !== expectedMapKey
                || runtime?.phase !== 'portal' || runtime.mapIndex !== expectedMapIndex
                || hud?.chainId !== 'portal_chain_k19' || hud?.mapIndex !== expectedMapIndex
                || hud?.currentMapKey !== expectedMapKey || livePlayer?.alive === false || Number(livePlayer?.hp) <= 0
                || (livePlayer?.lastDeathCause || '') !== initialDeathCause
                || entityManager._respawnSystem?.isRespawnPending?.(livePlayer) === true
                || progress?.completed !== true || progress?.nextCheckpointIndex !== progressAtEntry.nextCheckpointIndex
                || progress?.resetCount !== progressAtEntry.resetCount
                || progress?.checkpointRespawnsUsed !== progressAtEntry.checkpointRespawnsUsed
                || progress?.wrongOrderCount !== progressAtEntry.wrongOrderCount) {
                throw new Error(`K19 exit run identity/progress changed on ${expectedMapKey}; phase=${runtime?.phase} `
                    + `death=${livePlayer?.lastDeathCause || 'none'} hp=${livePlayer?.hp} alive=${livePlayer?.alive} `
                    + `progress=${progress?.nextCheckpointIndex}/${progress?.totalCheckpoints} reset=${progress?.resetCount}/${progressAtEntry.resetCount} `
                    + `respawns=${progress?.checkpointRespawnsUsed}/${progressAtEntry.checkpointRespawnsUsed}`);
            }
        };
        failIfPortalRunChanged(progressAtEntry);
        const validateCompletedTransition = () => {
            const hud = runtime?.getHudState?.();
            const finalMap = expectedNextMapKey == null;
            const normalFinal = finalMap && runtime?.phase === 'finished' && runtime.mapIndex === expectedMapIndex
                && hud?.currentMapKey === expectedMapKey && arena.currentMapKey === expectedMapKey
                && game.entityManager === entityManager && game.arena === arena
                && game.runtimeFacade?._arcadeSupport?.fivePortalsRuntime === identity.runtime;
            const normalAdvance = !finalMap && (runtime?.phase === 'transition' || runtime?.phase === 'racing')
                && runtime.mapIndex === expectedMapIndex + 1 && hud?.mapIndex === expectedMapIndex + 1
                && hud?.currentMapKey === expectedNextMapKey
                && game.entityManager === entityManager
                && runtime?.entityManager === entityManager
                && game.runtimeFacade?._arcadeSupport?.fivePortalsRuntime === identity.runtime
                && (runtime.phase !== 'racing' || game.arena?.currentMapKey === expectedNextMapKey);
            if (!hud || hud.chainId !== 'portal_chain_k19' || (!normalFinal && !normalAdvance)
                || player.alive === false || Number(player.hp) <= 0
                || (player.lastDeathCause || '') !== initialDeathCause
                || entityManager._respawnSystem?.isRespawnPending?.(player) === true
                || (normalFinal && (player.alive === false || Number(player.hp) <= 0
                    || (player.lastDeathCause || '') !== initialDeathCause
                    || entityManager._respawnSystem?.isRespawnPending?.(player) === true
                    || progressSystem.getPlayerProgressSnapshot(0)?.completed !== true))) {
                throw new Error(`Unexpected K19 exit outcome on ${expectedMapKey}; phase=${runtime?.phase} mapIndex=${hud?.mapIndex} `
                    + `nextMap=${hud?.currentMapKey} death=${player.lastDeathCause || 'none'} hp=${player.hp} alive=${player.alive}`);
            }
            return { mapKey: expectedMapKey, nextMapKey: expectedNextMapKey, phase: runtime.phase, playerHullRadius: Number(player.hitboxRadius) };
        };
        const vectorAt = (value) => player.position.clone().set(value.x, value.y, value.z);
        const facing = (from, to) => player.quaternion.clone().setFromUnitVectors(
            player.position.clone().set(0, 0, -1), vectorAt(to).sub(vectorAt(from)).normalize(),
        );
        const writeWorldPoint = (position, quaternion, scale, x, y, z) => {
            const vx = x * scale; const vy = y * scale; const vz = z * scale;
            const qx = quaternion.x; const qy = quaternion.y; const qz = quaternion.z; const qw = quaternion.w;
            const ix = qw * vx + qy * vz - qz * vy;
            const iy = qw * vy + qz * vx - qx * vz;
            const iz = qw * vz + qx * vy - qy * vx;
            const iw = -qx * vx - qy * vy - qz * vz;
            return {
                x: position.x + ix * qw + iw * -qx + iy * -qz - iz * -qy,
                y: position.y + iy * qw + iw * -qy + iz * -qx - ix * -qz,
                z: position.z + iz * qw + iw * -qz + ix * -qy - iy * -qx,
            };
        };
        const probeShapeAt = (position, quaternion) => {
            if (!arena.checkCollisionBroad(position, wallShape.boundRadius * modelScale)) return null;
            for (let boxIndex = 0; boxIndex < wallShape.count; boxIndex += 1) {
                const boxOffset = boxIndex * 6;
                const boxCenter = writeWorldPoint(position, quaternion, modelScale,
                    wallShape.boxes[boxOffset], wallShape.boxes[boxOffset + 1], wallShape.boxes[boxOffset + 2]);
                if (!arena.checkCollisionBroad(boxCenter, wallShape.boxReach[boxIndex] * modelScale)) continue;
                for (let probeIndex = wallShape.probeStart[boxIndex]; probeIndex < wallShape.probeStart[boxIndex + 1]; probeIndex += 1) {
                    const probeOffset = probeIndex * 4;
                    const point = writeWorldPoint(position, quaternion, modelScale,
                        wallShape.probes[probeOffset], wallShape.probes[probeOffset + 1], wallShape.probes[probeOffset + 2]);
                    const info = arena.getCollisionInfo(point, wallShape.probes[probeOffset + 3] * modelScale);
                    if (info) return { point, sourceName: info.sourceName };
                }
            }
            return null;
        };
        let preflightSamplesLeft = 65_536;
        const sweepShapeMotion = (from, to, startQuaternion, endQuaternion) => {
            const fromVector = vectorAt(from); const toVector = vectorAt(to);
            const travelled = fromVector.distanceTo(toVector);
            const reach = wallShape.boundRadius * modelScale;
            const requestedSteps = Math.max(1, Math.ceil(
                (travelled + startQuaternion.angleTo(endQuaternion) * reach) / Math.max(1e-6, minThickness * modelScale),
            ));
            if (requestedSteps > preflightSamplesLeft) {
                throw new Error(`Actual exit wall-shape preflight exceeds 65536 pose samples on ${expectedMapKey}; requested=${requestedSteps}`);
            }
            let completedSteps = 0;
            while (completedSteps < requestedSteps) {
                const chunkSteps = Math.min(maxSweepSteps, requestedSteps - completedSteps);
                const t0 = completedSteps / requestedSteps; const t1 = (completedSteps + chunkSteps) / requestedSteps;
                const chunkStart = fromVector.clone().lerp(toVector, t0); const chunkEnd = fromVector.clone().lerp(toVector, t1);
                const chunkStartQuat = startQuaternion.clone().slerp(endQuaternion, t0);
                const chunkEndQuat = startQuaternion.clone().slerp(endQuaternion, t1);
                const chunkDistance = chunkStart.distanceTo(chunkEnd);
                if (arena.checkCollisionBroad(chunkStart.clone().lerp(chunkEnd, 0.5), chunkDistance / 2 + reach)) {
                    const samplePosition = chunkStart.clone(); const sampleQuaternion = chunkStartQuat.clone();
                    for (let step = 1; step <= chunkSteps; step += 1) {
                        const amount = step / chunkSteps;
                        samplePosition.lerpVectors(chunkStart, chunkEnd, amount);
                        sampleQuaternion.slerpQuaternions(chunkStartQuat, chunkEndQuat, amount);
                        preflightSamplesLeft -= 1;
                        const contact = probeShapeAt(samplePosition, sampleQuaternion);
                        if (contact) throw new Error(`Blocked actual exit wall probe on ${expectedMapKey}; `
                            + `sample=${completedSteps + step}/${requestedSteps} source=${contact.sourceName || 'arena bounds'} `
                            + `point=${JSON.stringify(contact.point)}`);
                    }
                } else {
                    preflightSamplesLeft -= chunkSteps;
                }
                completedSteps += chunkSteps;
            }
        };
        const exitOrientation = facing(start, end);
        // setLookAtWorld runs before the next rAF; Player.update captures this new
        // quaternion before collision handling, so the first pose is already facing out.
        sweepShapeMotion(start, start, exitOrientation, exitOrientation);
        sweepShapeMotion(start, end, exitOrientation, exitOrientation);

        for (let frame = 0; frame < 900; frame += 1) {
            if (runtime.phase !== 'portal') {
                return validateCompletedTransition();
            }
            failIfPortalRunChanged(progressSystem.getPlayerProgressSnapshot(0));
            player.setLookAtWorld(end.x, end.y, end.z);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const progress = progressSystem.getPlayerProgressSnapshot(0);
            if (runtime.phase !== 'portal') return validateCompletedTransition();
            failIfPortalRunChanged(progress);
        }
        throw new Error(
            `Player did not traverse active exit portal on ${expectedMapKey}; hull=${Number(player.hitboxRadius)} `
            + `player=${JSON.stringify({ x: player.position.x, y: player.position.y, z: player.position.z })} exit=${JSON.stringify(end)}`
        );
    }, {
        expectedMapKey: mapKey,
        expectedMapIndex: mapIndex,
        expectedNextMapKey: nextMapKey,
        minThickness: ARCADE_HITBOX_MIN_THICKNESS,
        maxSweepSteps: ARCADE_SWEEP_MAX_STEPS,
    });
}

test('K19 starts from its dedicated menu button, traverses five live maps and saves separate results', async ({ page }, testInfo) => {
    // Five full live courses plus asset transitions can exceed five wall-clock minutes.
    // The authored 16/18-second segment deadlines remain enforced by the runtime.
    test.setTimeout(600_000);
    page.on('console', (message) => {
        if (message.text().startsWith('K19_DETOUR_DIAGNOSTIC ') || message.text().startsWith('K19_TARGET_DIAGNOSTIC ')
            || message.text().startsWith('K19_BOOST_INPUT_DIAGNOSTIC ')) console.info(message.text());
    });
    await waitForLoadedGame(page);
    const priorLegacyRecords = await captureLegacyRecords(page);

    await selectSessionType(page, 'single');
    await page.locator('#arcade-inline-surface > summary').click();
    await page.locator('.arcade-start-mode-options-summary').click();
    const startButton = page.locator('#btn-arcade-k19-portal-chain-start-inline');
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
    await startButton.click();

    const observedMapTimes = [];
    const flightProof = [];
    let diagnosticTargetOrdinal = 0;
    for (let index = 0; index < CHAIN.maps.length; index += 1) {
        const mapKey = CHAIN.maps[index];
        await page.waitForFunction(({ expected, chainId }) => {
            const game = window.GAME_INSTANCE;
            const runtime = game?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime;
            const state = runtime?.getHudState?.();
            return runtime?.phase === 'racing' && state?.chainId === chainId && state?.currentMapKey === expected
                && runtime?.entityManager === game?.entityManager
                && game?.arena?.currentMapKey === expected;
        }, { expected: mapKey, chainId: CHAIN_ID }, { timeout: 90_000 });

        const route = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const player = game.entityManager.players[0];
            const routeSnapshot = game.entityManager.getParcoursRouteSnapshot();
            return {
                routeId: routeSnapshot?.routeId,
                sequence: routeSnapshot?.sequence,
                rules: routeSnapshot?.rules,
                player: {
                    position: [player.position.x, player.position.y, player.position.z],
                    vehicleId: player.vehicleId,
                    modelScale: player.modelScale,
                    hitboxRadius: player.hitboxRadius,
                },
                mapKey: game.arena.currentMapKey,
            };
        });
        expect(route.mapKey).toBe(mapKey);
        expect(route.routeId).toBeTruthy();
        expect(route.sequence.length).toBeGreaterThan(0);
        expect(route.player.hitboxRadius).toBeGreaterThan(0);
        expect(route.player.vehicleId).toBeTruthy();
        expect(route.player.modelScale).toBeGreaterThan(0);

        for (const checkpointId of route.sequence) {
            if (mapKey === 'neon_circuit' && checkpointId === 'CP04') {
                expect(route.rules?.maxSegmentTimeMs).toBe(16_000);
            }
            const crossed = await driveAuthoredParcoursTarget(page, testInfo, {
                mapKey,
                mapIndex: index,
                checkpointId,
                targetKind: 'checkpoint',
                diagnosticTargetOrdinal: diagnosticTargetOrdinal < 3 ? ++diagnosticTargetOrdinal : null,
            });
            flightProof.push({ mapKey, ...crossed });
            expect(crossed.wrongOrderCount).toBe(0);
            expect(crossed.playerHullRadius).toBe(route.player.hitboxRadius);
            if (mapKey === 'neon_circuit' && checkpointId === route.sequence[0]) {
                expect(crossed.portalDetourPairIndex).toBeNull();
                expect(crossed.checkpointEntrySelection).toEqual(expect.objectContaining({ accepted: true }));
                expect(crossed.entryOverrideApplied).toBe(false);
            }
            if (mapKey === 'neon_circuit' && checkpointId === 'CP03') {
                expect(crossed.entryOverrideApplied).toBe(false);
                expect(crossed.portalApproach).toBeNull();
            }
            if (mapKey === 'neon_circuit' && checkpointId === 'CP05') {
                expect(crossed.checkpointId).toBe('CP05');
                expect(crossed.routeIndex).toBe(4);
                expect(crossed.passedIndex).toBe(5);
                expect(crossed.entryOverrideApplied).toBe(true);
                expect(crossed.portalApproach).toBeNull();
                expect(crossed.checkpointEntryOverride).toEqual(expect.objectContaining({
                    position: K19_NEON_CP05_ENTRY_POSITION,
                    contactRadius: expect.any(Number),
                    checkpointDistance: expect.any(Number),
                    portalClearance: expect.any(Number),
                    nearestPortalDistance: expect.any(Number),
                }));
                expect(crossed.checkpointEntryOverride.checkpointDistance)
                    .toBeLessThan(crossed.checkpointEntryOverride.contactRadius);
                expect(crossed.checkpointEntryOverride.nearestPortalDistance)
                    .toBeGreaterThan(crossed.checkpointEntryOverride.portalClearance);
            }
            if (mapKey === 'neon_circuit' && checkpointId === 'CP06') {
                expect(crossed.checkpointId).toBe('CP06');
                expect(crossed.routeIndex).toBe(5);
                expect(crossed.passedIndex).toBe(6);
                expect(crossed.entryOverrideApplied).toBe(false);
                expect(crossed.selectedRouteId).toBe(K19_NEON_CP06_ROUTE_ID);
                expect(crossed.selectedRouteWaypoints).toEqual(K19_NEON_CP06_ROUTE_WAYPOINTS);
            }
            if (mapKey === 'frozen_helix' && checkpointId === 'CP06') {
                expect(crossed.selectedRouteWaypoints).toEqual(K19_FROZEN_CP06_WAYPOINTS);
            }
            if (mapKey === 'frozen_helix' && checkpointId === 'CP07') {
                expect(crossed.selectedRouteWaypoints).toEqual(K19_FROZEN_CP07_WAYPOINTS);
            }
            if (mapKey === 'frozen_helix' && checkpointId === 'CP09') {
                expect(crossed.selectedRouteWaypoints).toBeNull();
                expect(crossed.checkpointEntryOverride).toEqual(expect.objectContaining({
                    accepted: true, position: K19_FROZEN_CP09_ENTRY_POSITION,
                }));
                expect(crossed.portalApproach).toBeNull();
            }
            if (mapKey === 'sky_islands' && checkpointId === 'CP07') {
                expect(crossed.checkpointEntryOverride).toEqual(expect.objectContaining({
                    accepted: true, position: K19_SKY_CP07_ENTRY_POSITION,
                }));
                expect(crossed.portalApproach).toBeNull();
            }
            if (mapKey === 'chrono_spillway' && checkpointId === 'CP05') {
                expect(crossed.selectedRouteWaypoints).toEqual(K19_CHRONO_CHECKPOINT_WAYPOINTS.CP05);
            }
            await expect(page.locator('#arcade-score-hud')).toContainText(`Karte ${index + 1}/5`);
        }

        const finished = await driveAuthoredParcoursTarget(page, testInfo, {
            mapKey,
            mapIndex: index,
            targetKind: 'finish',
            diagnosticTargetOrdinal: diagnosticTargetOrdinal < 3 ? ++diagnosticTargetOrdinal : null,
        });
        expect(finished.finishCompleted).toBe(true);
        await expect(page.locator('#arcade-score-hud')).toContainText('Goldenes Portal');
        const exitResult = await driveExitPortal(page, {
            mapKey,
            mapIndex: index,
            nextMapKey: CHAIN.maps[index + 1] ?? null,
        });
        expect(exitResult.mapKey).toBe(mapKey);
        if (index < CHAIN.maps.length - 1) {
            await page.waitForFunction(({ expected, chainId }) => {
                const game = window.GAME_INSTANCE;
                const runtime = game?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime;
                return runtime?.phase === 'racing' && runtime?.getHudState?.().chainId === chainId
                    && game?.arena?.currentMapKey === expected;
            }, { expected: CHAIN.maps[index + 1], chainId: CHAIN_ID }, { timeout: 90_000 });
        }
        const mapTime = await page.evaluate((mapIndex) => {
            const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.fivePortalsRuntime;
            return runtime.mapTimesMs[mapIndex];
        }, index);
        observedMapTimes.push(mapTime);
    }

    await page.waitForFunction(() => window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime?.phase === 'finished');
    await expect(page.locator('#arcade-overlay-panel')).toContainText(`${CHAIN.label} abgeschlossen`);
    await expect(page.locator('#arcade-overlay-panel [data-stats-block-id="five-portals-maps"] [data-stats-row-key]')).toHaveCount(5);


    const saved = await page.evaluate(({ localKey, rankedStorageKey, legacyKey }) => {
        const game = window.GAME_INSTANCE;
        const store = game.settingsManager.getPlayerRecordStorePort();
        const runtime = game.runtimeFacade._arcadeSupport.fivePortalsRuntime;
        const leaderboard = store.loadJsonRecord(rankedStorageKey, null);
        const legacyBoardKey = 'five_portals:any:1-5';
        const hasLegacyBoard = Object.hasOwn(leaderboard?.boards || {}, legacyBoardKey);
        return {
            local: store.loadJsonRecord(localKey, null),
            profileStorageKey: store.resolveStorageKey(localKey),
            legacyLocal: store.loadJsonRecord(legacyKey, null),
            hasLegacyBoard,
            legacyBoard: hasLegacyBoard ? leaderboard.boards[legacyBoardKey] : undefined,
            leaderboard,
            rankContext: runtime.rankContext,
            mapTimesMs: runtime.mapTimesMs,
            summary: runtime.getHudState().postRunSummary,
        };
    }, { localKey: CHAIN.recordKey, rankedStorageKey: ARCADE_RANKED_STORAGE_KEY, legacyKey: FIVE_PORTALS_RECORD_KEY });
    const totalMs = saved.mapTimesMs.reduce((sum, time) => sum + time, 0);
    await testInfo.attach('k19-full-flight.json', {
        body: Buffer.from(JSON.stringify({ chainId: CHAIN_ID, maps: CHAIN.maps, totalMs,
            mapTimesMs: saved.mapTimesMs, checkpoints: flightProof,
            profileStorageKey: saved.profileStorageKey, rankContext: saved.rankContext,
            legacyLocalPreserved: JSON.stringify(saved.legacyLocal) === JSON.stringify(priorLegacyRecords.local),
            legacyBoardPreserved: saved.hasLegacyBoard === priorLegacyRecords.hasBoard
                && JSON.stringify(saved.legacyBoard) === JSON.stringify(priorLegacyRecords.board),
        }, null, 2)),
        contentType: 'application/json',
    });
    await expect(page.locator('#arcade-overlay-panel [data-stats-block-id="five-portals-total"] [data-stats-row-key="total"] .message-stats-value')).toHaveText(formatDuration(totalMs / 1000, 2));
    expect(saved.profileStorageKey).toMatch(/^cuviosclash\.player\.[^.]+\.portal-chain-k19-records\.v1$/);
    expect(saved.local).toEqual(expect.objectContaining({
        version: CHAIN.recordVersion,
        lastTotalMs: totalMs,
        bestTotalMs: expect.any(Number),
        lastMapsMs: saved.mapTimesMs,
    }));
    expect(saved.local.lastTotalMs).toBeGreaterThan(0);
    expect(saved.local.bestTotalMs).toBeGreaterThan(0);
    expect(saved.mapTimesMs).toHaveLength(CHAIN.maps.length);
    expect(saved.mapTimesMs.every((time) => Number.isFinite(time) && time > 0)).toBe(true);
    expect(saved.summary?.totalMs).toBe(totalMs);
    expect(saved.rankContext).toEqual(expect.objectContaining({ ranked: true, portalChainId: CHAIN_ID }));
    const rankedKey = resolveArcadeRankKey(saved.rankContext);
    expect(rankedKey).toBe(`five_portals:${CHAIN_ID}:any:1-5`);
    expect(saved.leaderboard?.boards?.[rankedKey]?.some((row) => row.runId === saved.rankContext.runId && row.score === totalMs)).toBe(true);
    expect(saved.legacyLocal).toEqual(priorLegacyRecords.local);
    expect(saved.hasLegacyBoard).toBe(priorLegacyRecords.hasBoard);
    expect(saved.legacyBoard).toEqual(priorLegacyRecords.board);
    expect(observedMapTimes).toEqual(saved.mapTimesMs);
});

import * as THREE from 'three';
import { PLAYABLE_VOLUME_INSIDE, probeArenaPlayableVolumes } from '../arena/ArenaPlayableVolumes.js';
import {
    DEFAULT_ENTITY_RUNTIME_CONFIG,
    resolveEntityRuntimeConfig,
} from '../../shared/contracts/EntityRuntimeConfig.js';

export const EXCLUSION_ZONE_PHASES = Object.freeze({
    SAFE: 'SAFE',
    GRACE: 'GRACE',
    SALVO: 'SALVO',
});

export const EXCLUSION_ZONE_GRACE_SECONDS = 5;
export const EXCLUSION_ZONE_HYSTERESIS = 0.35;
export const EXCLUSION_ZONE_MAX_GLOBAL_ROCKETS = 64;

const ENVIRONMENT_OWNER = Object.freeze({
    index: -1,
    environment: true,
    name: 'Exclusion Zone',
});

// pursuitSpeedFactor scales the top level-flight speed of a boosting ship: a runaway can dodge
// the slow-turning salvo, but can no longer simply outfly it.
const SALVO_STAGES = Object.freeze([
    Object.freeze({ key: 'WEAK', from: 5, until: 15, count: 4, interval: 3, type: 'ROCKET_WEAK', spawnDistance: 96, pursuitSpeedFactor: 1, turnRateMultiplier: 0.35, minimumLifetimeSeconds: 24 }),
    Object.freeze({ key: 'MEDIUM', from: 15, until: 25, count: 6, interval: 2, type: 'ROCKET_MEDIUM', spawnDistance: 120, pursuitSpeedFactor: 1.1, turnRateMultiplier: 0.4, minimumLifetimeSeconds: 20 }),
    Object.freeze({ key: 'HEAVY', from: 25, until: Infinity, count: 8, interval: 1, type: 'ROCKET_HEAVY', spawnDistance: 144, pursuitSpeedFactor: 1.2, turnRateMultiplier: 0.45, minimumLifetimeSeconds: 18 }),
]);

// ProjectileSystem.spawnExternalProjectile falls back to this launch speed as well.
const FALLBACK_PROJECTILE_SPEED = 45;
const MINIMUM_TRAVEL_DISTANCE = 720;

function positiveOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/**
 * Longest straight chase of a ship that flees at cruise speed and boosts whenever its reserve
 * allows. The worst launch moment is the start of a boost, when the gap closes slowest.
 */
function resolveWorstPursuitSeconds(distance, rocketSpeed, ship) {
    const boostClosing = Math.max(0, rocketSpeed - ship.boostedSpeed);
    const cruiseClosing = Math.max(1e-6, rocketSpeed - ship.speed);
    const boostReach = boostClosing * ship.boostSeconds;
    const cycleReach = boostReach + cruiseClosing * ship.rechargeSeconds;
    const cycles = Math.floor(distance / cycleReach);
    const remaining = distance - cycles * cycleReach;
    const seconds = cycles * (ship.boostSeconds + ship.rechargeSeconds);
    if (remaining <= boostReach) return seconds + (remaining > 0 ? remaining / boostClosing : 0);
    return seconds + ship.boostSeconds + (remaining - boostReach) / cruiseClosing;
}

/**
 * Salvo tuning derived from the ship physics instead of fixed numbers.
 *
 * Every rocket flies at least as fast as a boosting ship in level flight. The per-target cap
 * keeps every rocket launched within the longest chase of a fleeing, boosting ship, so no
 * rocket is deleted before it can arrive; it never exceeds the global cap.
 *
 * @param {object|null} config Entity runtime config with PLAYER and PROJECTILE sections.
 * @param {number|null} [speedOverride] Current runtime cruise speed, before boost.
 */
export function resolveExclusionZoneRocketTuning(config, speedOverride = null) {
    const defaults = DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER;
    const playerConfig = config?.PLAYER || defaults;
    const speed = positiveOr(speedOverride, positiveOr(playerConfig.SPEED, defaults.SPEED));
    const ship = {
        speed,
        boostedSpeed: speed * Math.max(1, positiveOr(playerConfig.BOOST_MULTIPLIER, defaults.BOOST_MULTIPLIER)),
        boostSeconds: positiveOr(playerConfig.BOOST_DURATION, defaults.BOOST_DURATION),
        rechargeSeconds: positiveOr(playerConfig.BOOST_COOLDOWN, defaults.BOOST_COOLDOWN),
    };
    const projectileSpeed = positiveOr(config?.PROJECTILE?.SPEED, FALLBACK_PROJECTILE_SPEED);
    let maxPlayerRockets = 0;
    const stages = SALVO_STAGES.map((stage) => {
        const rocketSpeed = ship.boostedSpeed * stage.pursuitSpeedFactor;
        const flightSeconds = resolveWorstPursuitSeconds(stage.spawnDistance, rocketSpeed, ship);
        maxPlayerRockets = Math.max(maxPlayerRockets, stage.count * (Math.floor(flightSeconds / stage.interval) + 1));
        return Object.freeze({
            key: stage.key,
            rocketSpeed,
            speedMultiplier: rocketSpeed / projectileSpeed,
            flightSeconds,
            // The lifetime stays the pursuit limit; a faster rocket must not run out of range first.
            minimumTravelDistance: Math.max(MINIMUM_TRAVEL_DISTANCE, Math.ceil(rocketSpeed * stage.minimumLifetimeSeconds)),
        });
    });
    return Object.freeze({
        boostedShipSpeed: ship.boostedSpeed,
        maxPlayerRockets: Math.min(EXCLUSION_ZONE_MAX_GLOBAL_ROCKETS, maxPlayerRockets),
        maxGlobalRockets: EXCLUSION_ZONE_MAX_GLOBAL_ROCKETS,
        stages: Object.freeze(Object.fromEntries(stages.map((stage) => [stage.key, stage]))),
    });
}

const DIRECTION_COUNT = 32;
const PRECOMPUTED_DIRECTIONS = Object.freeze(Array.from({ length: DIRECTION_COUNT }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / DIRECTION_COUNT;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return Object.freeze([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
}));

function createState() {
    return {
        phase: EXCLUSION_ZONE_PHASES.SAFE,
        elapsedSeconds: 0,
        countdownSeconds: 0,
        stage: '',
        nextSalvoAt: EXCLUSION_ZONE_GRACE_SECONDS,
        salvoSequence: 0,
        lastFiniteX: 0,
        lastFiniteY: 0,
        lastFiniteZ: 0,
        hasFinitePosition: false,
    };
}

function stageForTime(elapsedSeconds) {
    if (elapsedSeconds >= SALVO_STAGES[2].from) return SALVO_STAGES[2];
    if (elapsedSeconds >= SALVO_STAGES[1].from) return SALVO_STAGES[1];
    return SALVO_STAGES[0];
}

function nextSalvoTime(time, stage, offset = 0) {
    return Math.min(stage.until + offset, time + stage.interval);
}

export class ExclusionZoneSystem {
    constructor(entityManager, options = {}) {
        this.entityManager = entityManager || null;
        this.projectileSystem = options.projectileSystem || null;
        this.states = new Map();
        this.networkReplica = false;
        this._projectileSequence = 0;
        this._spawnPosition = new THREE.Vector3();
        this._spawnDirection = new THREE.Vector3();
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    startRound() {
        this.reset();
        for (const player of this.entityManager?.players || []) this._publish(player, this._stateFor(player));
    }

    resetPlayer(player) {
        if (!player) return;
        this.states.delete(player.index);
        this._publish(player, createState());
    }

    update(dt) {
        if (this.networkReplica) return;
        const openFaces = this.entityManager?.arena?.openFaces;
        const candidate = this.entityManager?.arena?.exclusionZoneSource;
        const source = typeof candidate?.isOutside === 'function' ? candidate : null;
        if (!source && (!Array.isArray(openFaces) || openFaces.length === 0)) {
            if (this.states.size > 0) this.reset();
            return;
        }
        const safeDt = Math.max(0, Number(dt) || 0);
        const players = this.entityManager?.players || [];
        this._pruneMissingPlayers(players);
        for (const player of players) this._updatePlayer(player, safeDt, openFaces, source);
    }

    _pruneMissingPlayers(players) {
        for (const playerIndex of this.states.keys()) {
            if (!players.some((player) => player?.index === playerIndex)) this.states.delete(playerIndex);
        }
    }

    _stateFor(player) {
        let state = this.states.get(player.index);
        if (!state) {
            state = createState();
            this.states.set(player.index, state);
        }
        return state;
    }

    _updatePlayer(player, dt, openFaces, source = null) {
        const state = this._stateFor(player);
        if (!this._restoreFinitePosition(player, state)
            || !player.alive
            || player.isBot
            || player.isGhost
            || Number(player.spawnProtectionTimer) > 0) {
            this._setSafe(player, state);
            return;
        }

        // A map room lies outside the arena box on purpose, so its visitor is not a runaway.
        const inRoom = !source && probeArenaPlayableVolumes(this.entityManager?.arena?.playableVolumes, player.position)
            === PLAYABLE_VOLUME_INSIDE;
        const outside = source
            ? source.isOutside(player, state.phase === EXCLUSION_ZONE_PHASES.SAFE ? 0 : EXCLUSION_ZONE_HYSTERESIS)
            : !inRoom && (state.phase === EXCLUSION_ZONE_PHASES.SAFE
                ? this._isFullyOutside(player, openFaces)
                : !this._isInsideHysteresis(player, openFaces));
        if (!outside) {
            this._setSafe(player, state);
            return;
        }

        const graceSeconds = positiveOr(source?.graceSeconds, EXCLUSION_ZONE_GRACE_SECONDS);
        const stageOffset = graceSeconds - EXCLUSION_ZONE_GRACE_SECONDS;
        if (state.phase === EXCLUSION_ZONE_PHASES.SAFE) {
            state.phase = EXCLUSION_ZONE_PHASES.GRACE;
            state.elapsedSeconds = dt;
            state.nextSalvoAt = graceSeconds;
        } else {
            state.elapsedSeconds += dt;
        }

        if (state.elapsedSeconds < graceSeconds) {
            state.phase = EXCLUSION_ZONE_PHASES.GRACE;
            state.stage = '';
            state.countdownSeconds = Math.max(0, Math.ceil(graceSeconds - state.elapsedSeconds));
            this._publish(player, state);
            return;
        }

        state.phase = EXCLUSION_ZONE_PHASES.SALVO;
        state.countdownSeconds = 0;
        state.stage = stageForTime(state.elapsedSeconds - stageOffset).key;
        while (state.elapsedSeconds + 1e-9 >= state.nextSalvoAt) {
            const stage = stageForTime(state.nextSalvoAt - stageOffset);
            this._spawnSalvo(player, state, stage, source);
            state.nextSalvoAt = nextSalvoTime(state.nextSalvoAt, stage, stageOffset);
        }
        this._publish(player, state);
    }

    _restoreFinitePosition(player, state) {
        const position = player?.position;
        if (!position) return false;
        if ([position.x, position.y, position.z].every(Number.isFinite)) {
            state.lastFiniteX = position.x;
            state.lastFiniteY = position.y;
            state.lastFiniteZ = position.z;
            state.hasFinitePosition = true;
            return true;
        }
        if (state.hasFinitePosition) {
            position.set?.(state.lastFiniteX, state.lastFiniteY, state.lastFiniteZ);
            if (typeof position.set !== 'function') {
                position.x = state.lastFiniteX;
                position.y = state.lastFiniteY;
                position.z = state.lastFiniteZ;
            }
            player.markRenderDiscontinuity?.('non-finite-position-recovery');
        }
        return false;
    }

    _isFullyOutside(player, openFaces) {
        const position = player.position;
        const bounds = this.entityManager.arena.bounds;
        const radius = Math.max(0, Number(player.hitboxRadius) || 0);
        return (openFaces.includes('minX') && position.x + radius < bounds.minX)
            || (openFaces.includes('maxX') && position.x - radius > bounds.maxX)
            || (openFaces.includes('minZ') && position.z + radius < bounds.minZ)
            || (openFaces.includes('maxZ') && position.z - radius > bounds.maxZ)
            || (openFaces.includes('maxY') && position.y - radius > bounds.maxY);
    }

    _isInsideHysteresis(player, openFaces) {
        const position = player.position;
        const bounds = this.entityManager.arena.bounds;
        const radius = Math.max(0, Number(player.hitboxRadius) || 0);
        const h = EXCLUSION_ZONE_HYSTERESIS;
        if (openFaces.includes('minX') && position.x + radius < bounds.minX + h) return false;
        if (openFaces.includes('maxX') && position.x - radius > bounds.maxX - h) return false;
        if (openFaces.includes('minZ') && position.z + radius < bounds.minZ + h) return false;
        if (openFaces.includes('maxZ') && position.z - radius > bounds.maxZ - h) return false;
        if (openFaces.includes('maxY') && position.y - radius > bounds.maxY - h) return false;
        return true;
    }

    _spawnSalvo(player, state, stage, source = null) {
        const arena = this.entityManager?.arena;
        if (!this.projectileSystem || !arena) return;
        const tuning = resolveExclusionZoneRocketTuning(
            resolveEntityRuntimeConfig(this.entityManager), source?.getPlayerSpeed?.(player)
        );
        const launch = tuning.stages[stage.key];
        const offset = (Number(player.index) * 11 + state.salvoSequence * 7) % DIRECTION_COUNT;
        let spawned = 0;
        for (let attempt = 0; attempt < DIRECTION_COUNT && spawned < stage.count; attempt += 1) {
            const direction = PRECOMPUTED_DIRECTIONS[(offset + attempt) % DIRECTION_COUNT];
            this._spawnPosition.set(
                player.position.x + direction[0] * stage.spawnDistance,
                player.position.y + direction[1] * stage.spawnDistance,
                player.position.z + direction[2] * stage.spawnDistance,
            );
            if (arena.checkWorldGeometryCollision?.(this._spawnPosition, 1.2)) continue;
            this._spawnDirection.subVectors(player.position, this._spawnPosition).normalize();
            const projectile = this.projectileSystem.spawnExternalProjectile({
                owner: ENVIRONMENT_OWNER,
                type: stage.type,
                position: this._spawnPosition,
                direction: this._spawnDirection,
                target: player,
                targetPlayerIndex: player.index,
                targetReacquireDisabled: true,
                ignoresTrails: true,
                ignoresTurrets: true,
                environmentProjectile: true,
                zoneProjectile: true,
                zoneSequence: ++this._projectileSequence,
                speedMultiplier: launch.speedMultiplier,
                homingTurnRateMultiplier: stage.turnRateMultiplier,
                minimumLifetimeSeconds: stage.minimumLifetimeSeconds,
                minimumTravelDistance: launch.minimumTravelDistance,
            });
            if (projectile) spawned += 1;
        }
        state.salvoSequence += 1;
        this.projectileSystem.trimZoneProjectiles(
            player.index,
            tuning.maxPlayerRockets,
            tuning.maxGlobalRockets,
        );
        if (spawned > 0) this.entityManager?.audio?.play?.('EXCLUSION_WARNING', { intensity: 0.28 });
    }

    _setSafe(player, state) {
        state.phase = EXCLUSION_ZONE_PHASES.SAFE;
        state.elapsedSeconds = 0;
        state.countdownSeconds = 0;
        state.stage = '';
        state.nextSalvoAt = EXCLUSION_ZONE_GRACE_SECONDS;
        state.salvoSequence = 0;
        this._publish(player, state);
    }

    _publish(player, state) {
        const published = player.exclusionZoneState && typeof player.exclusionZoneState === 'object'
            ? player.exclusionZoneState
            : (player.exclusionZoneState = {});
        published.phase = state.phase;
        published.elapsedSeconds = Math.max(0, state.elapsedSeconds);
        published.countdownSeconds = Math.max(0, state.countdownSeconds);
        published.stage = state.stage;
    }

    applyNetworkState(player, snapshotState) {
        if (!player || !snapshotState || typeof snapshotState !== 'object') return;
        const phase = Object.values(EXCLUSION_ZONE_PHASES).includes(snapshotState.phase)
            ? snapshotState.phase
            : EXCLUSION_ZONE_PHASES.SAFE;
        const published = player.exclusionZoneState && typeof player.exclusionZoneState === 'object'
            ? player.exclusionZoneState
            : (player.exclusionZoneState = {});
        published.phase = phase;
        published.elapsedSeconds = Math.max(0, Number(snapshotState.elapsedSeconds) || 0);
        published.countdownSeconds = Math.max(0, Math.ceil(Number(snapshotState.countdownSeconds) || 0));
        published.stage = typeof snapshotState.stage === 'string' ? snapshotState.stage : '';
    }

    getPlayerState(playerIndex) {
        const player = (this.entityManager?.players || []).find((entry) => Number(entry?.index) === Number(playerIndex));
        return player?.exclusionZoneState || { phase: EXCLUSION_ZONE_PHASES.SAFE, elapsedSeconds: 0, countdownSeconds: 0, stage: '' };
    }

    reset() {
        for (const player of this.entityManager?.players || []) this._publish(player, createState());
        this.states.clear();
    }

    dispose() {
        this.reset();
        this.entityManager = null;
        this.projectileSystem = null;
    }
}

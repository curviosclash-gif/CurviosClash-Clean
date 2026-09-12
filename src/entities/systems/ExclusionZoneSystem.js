import * as THREE from 'three';

export const EXCLUSION_ZONE_PHASES = Object.freeze({
    SAFE: 'SAFE',
    GRACE: 'GRACE',
    SALVO: 'SALVO',
});

export const EXCLUSION_ZONE_GRACE_SECONDS = 5;
export const EXCLUSION_ZONE_HYSTERESIS = 0.35;
export const EXCLUSION_ZONE_MAX_PLAYER_ROCKETS = 12;
export const EXCLUSION_ZONE_MAX_GLOBAL_ROCKETS = 64;

const ENVIRONMENT_OWNER = Object.freeze({
    index: -1,
    environment: true,
    name: 'Exclusion Zone',
});

const SALVO_STAGES = Object.freeze([
    Object.freeze({ key: 'WEAK', from: 5, until: 15, count: 4, interval: 3, type: 'ROCKET_WEAK', spawnDistance: 96, speedMultiplier: 0.55, turnRateMultiplier: 0.35, minimumLifetimeSeconds: 24 }),
    Object.freeze({ key: 'MEDIUM', from: 15, until: 25, count: 6, interval: 2, type: 'ROCKET_MEDIUM', spawnDistance: 120, speedMultiplier: 0.65, turnRateMultiplier: 0.4, minimumLifetimeSeconds: 20 }),
    Object.freeze({ key: 'HEAVY', from: 25, until: Infinity, count: 8, interval: 1, type: 'ROCKET_HEAVY', spawnDistance: 144, speedMultiplier: 0.75, turnRateMultiplier: 0.45, minimumLifetimeSeconds: 18 }),
]);

const DIRECTION_COUNT = 32;
const ZONE_PROJECTILE_MINIMUM_TRAVEL_DISTANCE = 720;
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

function nextSalvoTime(time, stage) {
    return Math.min(stage.until, time + stage.interval);
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
        if (!Array.isArray(openFaces) || openFaces.length === 0) {
            if (this.states.size > 0) this.reset();
            return;
        }
        const safeDt = Math.max(0, Number(dt) || 0);
        const players = this.entityManager?.players || [];
        this._pruneMissingPlayers(players);
        for (const player of players) this._updatePlayer(player, safeDt, openFaces);
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

    _updatePlayer(player, dt, openFaces) {
        const state = this._stateFor(player);
        if (!this._restoreFinitePosition(player, state)
            || !player.alive
            || player.isBot
            || player.isGhost
            || Number(player.spawnProtectionTimer) > 0) {
            this._setSafe(player, state);
            return;
        }

        const outside = state.phase === EXCLUSION_ZONE_PHASES.SAFE
            ? this._isFullyOutside(player, openFaces)
            : !this._isInsideHysteresis(player, openFaces);
        if (!outside) {
            this._setSafe(player, state);
            return;
        }

        if (state.phase === EXCLUSION_ZONE_PHASES.SAFE) {
            state.phase = EXCLUSION_ZONE_PHASES.GRACE;
            state.elapsedSeconds = dt;
            state.nextSalvoAt = EXCLUSION_ZONE_GRACE_SECONDS;
        } else {
            state.elapsedSeconds += dt;
        }

        if (state.elapsedSeconds < EXCLUSION_ZONE_GRACE_SECONDS) {
            state.phase = EXCLUSION_ZONE_PHASES.GRACE;
            state.stage = '';
            state.countdownSeconds = Math.max(0, Math.ceil(EXCLUSION_ZONE_GRACE_SECONDS - state.elapsedSeconds));
            this._publish(player, state);
            return;
        }

        state.phase = EXCLUSION_ZONE_PHASES.SALVO;
        state.countdownSeconds = 0;
        state.stage = stageForTime(state.elapsedSeconds).key;
        while (state.elapsedSeconds + 1e-9 >= state.nextSalvoAt) {
            const stage = stageForTime(state.nextSalvoAt);
            this._spawnSalvo(player, state, stage);
            state.nextSalvoAt = nextSalvoTime(state.nextSalvoAt, stage);
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

    _spawnSalvo(player, state, stage) {
        const arena = this.entityManager?.arena;
        if (!this.projectileSystem || !arena) return;
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
                speedMultiplier: stage.speedMultiplier,
                homingTurnRateMultiplier: stage.turnRateMultiplier,
                minimumLifetimeSeconds: stage.minimumLifetimeSeconds,
                minimumTravelDistance: ZONE_PROJECTILE_MINIMUM_TRAVEL_DISTANCE,
            });
            if (projectile) spawned += 1;
        }
        state.salvoSequence += 1;
        this.projectileSystem.trimZoneProjectiles(
            player.index,
            EXCLUSION_ZONE_MAX_PLAYER_ROCKETS,
            EXCLUSION_ZONE_MAX_GLOBAL_ROCKETS,
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

import * as THREE from 'three';

import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';

// ============================================
// SpawnPlacementSystem.js - spawn and safe reposition helpers
// ============================================
//
// Contract:
// - Inputs: owner (EntityManager-like), optional isBotPositionSafe(player, position)
// - Outputs: deterministic spawn direction/position + safe bounce fallback placement
// - Side effects: mutates owner/player reusable temp vectors and player.position only
// - Hotpath guardrail: never allocate per call in update/render-adjacent paths

const DEFAULT_SAFE_BOUNCE_DISTANCES = Object.freeze([1.5, 3.0, 5.0, 0.5]);

const SPAWN_DIRECTION_SAMPLES = 20;
const SPAWN_DIRECTION_STEP = 2.2;
const DEFAULT_SPAWN_LOOKAHEAD = 36;
// Coprime with the sample count, so the rotation still visits every heading while two
// spawns in a row end up on opposite sides instead of 18 degrees apart.
const SPAWN_DIRECTION_STRIDE = 7;

/**
 * Distance from the configured base speed that a vehicle can cover while protected, including
 * the immediately available boost. Loadout speed changes happen later in the spawn flow; wall
 * contacts still separate safely during protection, while clear runway avoids a forced turn.
 *
 * @param {object|null} config Entity runtime config.
 * @returns {number} Look-ahead in world units, never below the legacy 36.
 */
export function resolveSpawnLookaheadDistance(config) {
    const speed = Number(config?.PLAYER?.SPEED);
    const boostMultiplier = Math.max(1, Number(config?.PLAYER?.BOOST_MULTIPLIER) || 1);
    const protection = Math.max(
        Number(config?.PLAYER?.SPAWN_PROTECTION) || 0,
        Number(config?.HUNT?.RESPAWN?.INVULNERABILITY_SECONDS) || 0
    );
    if (!Number.isFinite(speed) || speed <= 0 || protection <= 0) return DEFAULT_SPAWN_LOOKAHEAD;
    return Math.max(DEFAULT_SPAWN_LOOKAHEAD, speed * boostMultiplier * protection);
}

// Fallbacks match HUNT_CONFIG.MG for owners whose runtime config carries no gun block.
const DEFAULT_SPAWN_AIM_RANGE = 152;
const DEFAULT_SPAWN_AIM_DOT = 0.965;

function resolveSpawnAimCone(config) {
    const range = Number(config?.HUNT?.MG?.RANGE);
    const dot = Number(config?.HUNT?.MG?.AIM_DOT_MIN);
    return {
        rangeSq: (Number.isFinite(range) && range > 0 ? range : DEFAULT_SPAWN_AIM_RANGE) ** 2,
        dot: Number.isFinite(dot) ? dot : DEFAULT_SPAWN_AIM_DOT,
    };
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function buildSpawnCandidateKey(candidate, fallbackPrefix = 'spawn') {
    if (typeof candidate?.id === 'string' && candidate.id.trim()) {
        return candidate.id.trim();
    }
    return [
        fallbackPrefix,
        Math.round((Number(candidate?.x) || 0) * 1000),
        Math.round((Number(candidate?.y) || 0) * 1000),
        Math.round((Number(candidate?.z) || 0) * 1000),
    ].join(':');
}

function clonePosition(position) {
    if (typeof position?.clone === 'function') {
        return position.clone();
    }
    return new THREE.Vector3(
        Number(position?.x) || 0,
        Number(position?.y) || 0,
        Number(position?.z) || 0
    );
}

export class SpawnPlacementSystem {
    constructor(owner, options = {}) {
        this.owner = owner || null;
        this.isBotPositionSafe = typeof options.isBotPositionSafe === 'function'
            ? options.isBotPositionSafe
            : (() => false);
        this._assignedSpawnByPlayer = new Map();
        this._botSpawnCursor = 0;
        this._spawnDirectionCursor = 0;
        this._tmpSpawnProbe = new THREE.Vector3();
        this._tmpSpawnDirection = new THREE.Vector3();
        this._tmpBounceDirection = new THREE.Vector3();
        this._recentSpawnPositions = [];
    }

    resetAssignments() {
        this._assignedSpawnByPlayer.clear();
        this._botSpawnCursor = 0;
        this._spawnDirectionCursor = 0;
        this._recentSpawnPositions.length = 0;
    }

    findSpawnPosition(minDistance = 12, margin = 12, planarLevelOrOptions = null, extraOptions = null) {
        const owner = this.owner;
        const arena = owner?.arena;
        const players = owner?.players || [];
        if (!arena) return null;

        const options = this._normalizeSpawnOptions(planarLevelOrOptions, extraOptions);
        const preferredPositions = this._resolvePreferredPositions(options);
        const usePlanarLevel = Number.isFinite(options.planarLevel) && typeof arena.getRandomPositionOnLevel === 'function';
        // Ohne diesen Wuerfel fiel die Ausweich-Spawnposition auf Math.random
        // zurueck, waehrend Spur, Spawn-Richtung und Bots laengst gesetzt liefen.
        const spawnRoll = owner?.runtimeRng?.next;
        const minDistanceSq = minDistance * minDistance;
        const preferredRadius = Math.max(3, Number(options?.player?.hitboxRadius) || 0);

        for (let i = 0; i < preferredPositions.length; i++) {
            const candidate = preferredPositions[i];
            if (!candidate) continue;
            const y = isFiniteNumber(candidate.y)
                ? Number(candidate.y)
                : (Number.isFinite(options.planarLevel) ? options.planarLevel : ((arena.bounds.minY + arena.bounds.maxY) * 0.5));
            this._tmpSpawnProbe.set(Number(candidate.x) || 0, y, Number(candidate.z) || 0);
            if (this._isSpawnPositionSafe(this._tmpSpawnProbe, preferredRadius, minDistanceSq, players, options.player)) {
                return this._rememberSpawn(this._tmpSpawnProbe.clone());
            }
        }

        let checkedFallback = null;
        let safestFallback = null;
        let safestFallbackScore = -Infinity;
        for (let attempts = 0; attempts < 100; attempts++) {
            const pos = usePlanarLevel
                ? arena.getRandomPositionOnLevel(options.planarLevel, margin, spawnRoll)
                : arena.getRandomPosition(margin, spawnRoll);
            if (!pos) continue;
            if (!checkedFallback) {
                checkedFallback = clonePosition(pos);
            }
            if (!arena.checkCollision(pos, preferredRadius)) {
                const score = this._scoreSpawnPosition(pos, players, options.player);
                if (score > safestFallbackScore) {
                    safestFallbackScore = score;
                    safestFallback = clonePosition(pos);
                }
            }
            if (this._isSpawnPositionSafe(pos, preferredRadius, minDistanceSq, players, options.player)) {
                return this._rememberSpawn(pos);
            }
        }

        return this._rememberSpawn(safestFallback || checkedFallback);
    }

    findSafeSpawnDirection(position, radius = 0.8, player = null) {
        const owner = this.owner;
        if (!owner) return null;

        // Reaching only a fixed 36 units left the probe blind for the rest of the protected
        // flight, so a heading that ends in a wall right after the timer scored as freely
        // as an open corridor.
        const config = resolveEntityRuntimeConfig(owner);
        const maxDistance = resolveSpawnLookaheadDistance(config);
        const aimCone = resolveSpawnAimCone(config);
        const sampleDir = owner._tmpDir;
        const bestDirection = owner._tmpDir2;
        bestDirection.set(0, 0, -1);
        let bestDistance = -1;
        let bestTier = -1;

        // In open geometry most samples reach the cap and tie. Keeping the first of them
        // always meant sample 0, which is exactly -Z: two thirds of all respawns left on
        // the same heading and piled into the same walls. The rotation breaks the tie by
        // where the round starts counting, which keeps the choice replay-stable.
        const startSample = this._spawnDirectionCursor;
        for (let i = 0; i < SPAWN_DIRECTION_SAMPLES; i++) {
            const sampleIndex = (startSample + i) % SPAWN_DIRECTION_SAMPLES;
            const angle = (Math.PI * 2 * sampleIndex) / SPAWN_DIRECTION_SAMPLES;
            sampleDir.set(Math.sin(angle), 0, -Math.cos(angle));
            const freeDistance = this.traceFreeDistance(
                position,
                sampleDir,
                maxDistance,
                SPAWN_DIRECTION_STEP,
                radius
            );
            // A clear protected flight matters most; among those, a heading that does not
            // put an enemy straight into the gun sight wins. On the maze the tie break
            // otherwise lined a bot up behind the human, firing from the first frame.
            const tier = (freeDistance >= maxDistance ? 2 : 0)
                + (this._isHeadingAimedAtEnemy(position, sampleDir, player, aimCone) ? 0 : 1);
            if (tier > bestTier || (tier === bestTier && freeDistance > bestDistance)) {
                bestTier = tier;
                bestDistance = freeDistance;
                bestDirection.copy(sampleDir);
            }
        }
        this._spawnDirectionCursor = (startSample + SPAWN_DIRECTION_STRIDE) % SPAWN_DIRECTION_SAMPLES;

        return bestDirection;
    }

    _isHeadingAimedAtEnemy(position, direction, player, aimCone) {
        const players = this.owner?.players;
        if (!Array.isArray(players)) return false;
        const toEnemy = this._tmpSpawnDirection;
        for (let i = 0; i < players.length; i++) {
            const other = players[i];
            if (!other?.alive || other === player || !other.position) continue;
            toEnemy.subVectors(other.position, position);
            const distanceSq = toEnemy.lengthSq();
            if (distanceSq <= 0.000001 || distanceSq > aimCone.rangeSq) continue;
            if (direction.dot(toEnemy) / Math.sqrt(distanceSq) >= aimCone.dot) return true;
        }
        return false;
    }

    traceFreeDistance(origin, direction, maxDistance, stepDistance, radius = 0.8) {
        const owner = this.owner;
        const arena = owner?.arena;
        if (!owner || !arena) return 0;

        const step = Math.max(0.5, stepDistance);
        let traveled = 0;
        while (traveled < maxDistance) {
            traveled += step;
            owner._tmpVec.set(
                origin.x + direction.x * traveled,
                origin.y + direction.y * traveled,
                origin.z + direction.z * traveled
            );
            if (arena.checkCollision(owner._tmpVec, radius)) {
                return traveled - step;
            }
        }
        return maxDistance;
    }

    _normalizeSpawnOptions(planarLevelOrOptions = null, extraOptions = null) {
        if (planarLevelOrOptions && typeof planarLevelOrOptions === 'object' && !Array.isArray(planarLevelOrOptions)) {
            return { ...planarLevelOrOptions };
        }

        const normalized = extraOptions && typeof extraOptions === 'object'
            ? { ...extraOptions }
            : {};
        normalized.planarLevel = planarLevelOrOptions;
        return normalized;
    }

    _resolvePreferredPositions(options = {}) {
        if (Array.isArray(options.preferredPositions) && options.preferredPositions.length > 0) {
            return options.preferredPositions;
        }

        const player = options.player || null;
        if (!player) return [];

        const authoredCandidates = this._resolveAuthoredCandidatesForPlayer(player);
        if (authoredCandidates.length === 0) {
            return [];
        }

        const assignedCandidate = this._assignCandidateToPlayer(player, authoredCandidates);
        if (!assignedCandidate) {
            return authoredCandidates;
        }

        const assignedKey = buildSpawnCandidateKey(assignedCandidate, `player-${player.index}`);
        return [
            assignedCandidate,
            ...authoredCandidates.filter((candidate) => buildSpawnCandidateKey(candidate, `player-${player.index}`) !== assignedKey),
        ];
    }

    _resolveAuthoredCandidatesForPlayer(player) {
        const arena = this.owner?.arena;
        if (!arena) return [];

        const candidates = [];
        const dedicatedPlayerSpawn = arena.getAuthoredPlayerSpawn?.();
        const botSpawns = arena.getAuthoredBotSpawns?.() || [];
        const isFirstHuman = !player?.isBot && this.owner?.humanPlayers?.[0] === player;

        if (isFirstHuman && dedicatedPlayerSpawn) {
            candidates.push(dedicatedPlayerSpawn);
        }

        if (player?.isBot) {
            candidates.push(...botSpawns);
        } else if (!isFirstHuman || !dedicatedPlayerSpawn) {
            candidates.push(...botSpawns);
        }

        return candidates.filter((candidate) => (
            candidate
            && isFiniteNumber(candidate.x)
            && isFiniteNumber(candidate.z)
            && (isFiniteNumber(candidate.y) || Number.isFinite(this.owner?.arena?.bounds?.maxY))
        ));
    }

    _assignCandidateToPlayer(player, candidates) {
        const existingAssignment = this._assignedSpawnByPlayer.get(player.index);
        if (existingAssignment) {
            const existingKey = buildSpawnCandidateKey(existingAssignment, `player-${player.index}`);
            const matchedCandidate = candidates.find((candidate) => buildSpawnCandidateKey(candidate, `player-${player.index}`) === existingKey);
            if (matchedCandidate) {
                return matchedCandidate;
            }
        }

        if (candidates.length === 0) {
            this._assignedSpawnByPlayer.delete(player.index);
            return null;
        }

        let nextCandidate = null;
        if (player?.isBot) {
            const startIndex = this._botSpawnCursor % candidates.length;
            nextCandidate = candidates[startIndex];
            this._botSpawnCursor += 1;
        } else {
            nextCandidate = candidates[0];
        }

        if (nextCandidate) {
            this._assignedSpawnByPlayer.set(player.index, nextCandidate);
        }
        return nextCandidate;
    }

    _isSpawnPositionSafe(position, collisionRadius, minDistanceSq, players, player = null) {
        const owner = this.owner;
        const arena = owner?.arena;
        if (!arena || !position) return false;
        if (arena.checkCollision(position, collisionRadius)) {
            return false;
        }
        if (player?.fightLastDeathPosition && position.distanceToSquared(player.fightLastDeathPosition) < 400) return false;
        for (const recent of this._recentSpawnPositions) {
            if (position.distanceToSquared(recent) < 64) return false;
        }

        for (let i = 0; i < players.length; i++) {
            const other = players[i];
            if (!other?.alive || other === player) continue;
            const distanceSq = other.position.distanceToSquared(position);
            if (distanceSq < minDistanceSq) return false;
            if (distanceSq > 2025) continue;
            const distance = Math.sqrt(distanceSq);
            this._tmpSpawnDirection.subVectors(other.position, position).normalize();
            if (this.traceFreeDistance(position, this._tmpSpawnDirection, distance, 2.5, collisionRadius) >= distance - 2.5) return false;
        }

        return true;
    }

    _scoreSpawnPosition(position, players, player) {
        let nearestEnemySq = Infinity;
        for (const other of players) {
            if (!other?.alive || other === player) continue;
            nearestEnemySq = Math.min(nearestEnemySq, other.position.distanceToSquared(position));
        }
        const deathPenalty = player?.fightLastDeathPosition && position.distanceToSquared(player.fightLastDeathPosition) < 400 ? 10000 : 0;
        return (Number.isFinite(nearestEnemySq) ? nearestEnemySq : 100000) - deathPenalty;
    }

    _rememberSpawn(position) {
        if (!position) return position;
        this._recentSpawnPositions.push(clonePosition(position));
        if (this._recentSpawnPositions.length > 6) this._recentSpawnPositions.shift();
        return position;
    }

    findSafeBouncePosition(player, baseDirection, normal = null, options = {}, preferredDistance = 0) {
        const owner = this.owner;
        if (!owner || !player || !baseDirection) return;

        const pos = player.position;
        this._tmpBounceDirection.copy(baseDirection);
        if (this._tmpBounceDirection.lengthSq() <= 0.000001) return;
        this._tmpBounceDirection.normalize();

        const firstDistance = Number.isFinite(preferredDistance) && preferredDistance > 0
            ? preferredDistance
            : 0;
        if (firstDistance > 0) {
            owner._tmpVec2.copy(pos).addScaledVector(this._tmpBounceDirection, firstDistance);
            if (this.isBotPositionSafe(player, owner._tmpVec2)) {
                pos.copy(owner._tmpVec2);
                return;
            }
        }

        const distances = Array.isArray(options.distances) && options.distances.length > 0
            ? options.distances
            : DEFAULT_SAFE_BOUNCE_DISTANCES;

        for (let i = 0; i < distances.length; i++) {
            const dist = distances[i];
            owner._tmpVec2.copy(pos).addScaledVector(this._tmpBounceDirection, dist);
            if (this.isBotPositionSafe(player, owner._tmpVec2)) {
                pos.copy(owner._tmpVec2);
                return;
            }
        }

        if (normal) {
            const normalPush = Number.isFinite(options.normalPush) ? options.normalPush : 2.0;
            pos.addScaledVector(normal, normalPush);
            if (this.isBotPositionSafe(player, pos)) return;
        }

        const bounds = owner?.arena?.bounds;
        if (!bounds) return;
        pos.set(
            (bounds.minX + bounds.maxX) * 0.5,
            (bounds.minY + bounds.maxY) * 0.5,
            (bounds.minZ + bounds.maxZ) * 0.5
        );
    }
}

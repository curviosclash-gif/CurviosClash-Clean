// ============================================
// BotSensors.js - encapsulated probe/raycast sensor runtime
// ============================================

import * as THREE from 'three';
import { runPerception } from './BotSensingOps.js';
import { composeProbeDirection, scanProbeRay, scoreProbe } from './BotProbeOps.js';
import { estimateExitSafety, evaluatePortalIntent } from './BotPortalOps.js';
import { senseProjectiles, senseHeight, senseBotSpacing, evaluatePursuit } from './BotThreatOps.js';
import { BotSensorsFacade } from './BotSensorsFacade.js';
import {
    AI_SENSE_PHASE_WINDOW,
    AI_SENSOR_LOOKAHEAD,
    AI_SENSOR_TRAIL_COLLISION,
} from './perception/AiPerceptionConfig.js';
import {
    clamp01,
    normalizeDistance,
    normalizePressure,
    normalizeRisk,
    normalizeSigned,
    normalizeTargetDistance,
} from './perception/AiPerceptionPrimitives.js';
import {
    buildPerceptionBasis,
    computeTargetSteeringSignals,
    PERCEPTION_THRESHOLDS,
} from './perception/EnvironmentSamplingOps.js';

const MAP_BEHAVIOR = {
    standard: { caution: 0.0, portalBias: 0.0, aggressionBias: 0.0 },
    empty: { caution: -0.12, portalBias: -0.08, aggressionBias: 0.16 },
    maze: { caution: 0.22, portalBias: 0.06, aggressionBias: -0.1 },
    complex: { caution: 0.16, portalBias: 0.08, aggressionBias: -0.04 },
    pyramid: { caution: 0.08, portalBias: 0.12, aggressionBias: 0.03 },
};

const BOT_COLLISION_CACHE_POS_SCALE = 32;
const BOT_COLLISION_CACHE_RADIUS_SCALE = 64;
const PROBE_RISK_SENTINEL = 999;
const BOT_SENSOR_ARRAY_PROBE_WIDTH = 5;
const BOT_SENSOR_ARRAY_SCALAR_WIDTH = 24;

function createProbe(name, yaw, pitch, weight = 0) {
    return {
        name,
        yaw,
        pitch,
        weight,
        dir: new THREE.Vector3(),
        risk: PROBE_RISK_SENTINEL,
        wallDist: 0,
        trailDist: 0,
        clearance: 0,
        immediateDanger: false,
    };
}

export function createBotSenseState() {
    return {
        lookAhead: 0,
        forwardRisk: 1,
        bestProbe: null,
        targetDistanceSq: Infinity,
        targetInFront: false,
        immediateDanger: false,
        pressure: 0,
        localOpenness: 0,
        mapCaution: 0,
        mapPortalBias: 0,
        mapAggressionBias: 0,
        projectileThreat: false,
        projectileEvadeYaw: 0,
        projectileEvadePitch: 0,
        heightBias: 0,
        botRepulsionYaw: 0,
        botRepulsionPitch: 0,
        pursuitActive: false,
        pursuitYaw: 0,
        pursuitPitch: 0,
        pursuitAimDot: 0,
        targetYaw: 0,
        targetPitch: 0,
        targetAimDot: 0,
    };
}

export class BotSensors {
    constructor() {
        this.sense = createBotSenseState();

        this._probes = [
            createProbe('forward', 0, 0, 0),
            createProbe('left', -1.0, 0, 0.02),
            createProbe('right', 1.0, 0, 0.02),
            createProbe('leftWide', -1.8, 0, 0.07),
            createProbe('rightWide', 1.8, 0, 0.07),
            createProbe('up', 0, 0.9, 0.08),
            createProbe('down', 0, -0.9, 0.08),
            createProbe('upLeft', -0.7, 0.7, 0.10),
            createProbe('upRight', 0.7, 0.7, 0.10),
            createProbe('downLeft', -0.7, -0.7, 0.10),
            createProbe('downRight', 0.7, -0.7, 0.10),
            createProbe('backward', 3.14, 0, 0.25),
        ];

        this._collisionCache = new Map();
        this._probeRayCenter = { wallDist: 0, trailDist: 0, immediateDanger: false };
        this._probeRayLeft = { wallDist: 0, trailDist: 0, immediateDanger: false };
        this._probeRayRight = { wallDist: 0, trailDist: 0, immediateDanger: false };

        this._sensePhase = 0;
        this._sensePhaseCounter = 0;

        this._tmpForward = new THREE.Vector3();
        this._tmpRight = new THREE.Vector3();
        this._tmpUp = new THREE.Vector3();
        this._tmpVec = new THREE.Vector3();
        this._tmpVec2 = new THREE.Vector3();
        this._tmpVec3 = new THREE.Vector3();

        this.profile = null;
        this.state = null;
        this._recentBouncePressure = 0;
        this._portalEntry = new THREE.Vector3();
        this._portalExit = new THREE.Vector3();
        this._portalTarget = null;
        this._runtimeBot = null;

        const vectorLength = this._probes.length * BOT_SENSOR_ARRAY_PROBE_WIDTH + BOT_SENSOR_ARRAY_SCALAR_WIDTH;
        this._sensorArray = new Array(vectorLength).fill(0);
        this._sensorSnapshot = {
            targetPlayer: null,
            targetDistanceSq: Infinity,
            targetInFront: false,
            lookAhead: 0,
            forwardRisk: 1,
            immediateDanger: false,
            pressure: 0,
            projectileThreat: false,
            projectileEvadeYaw: 0,
            projectileEvadePitch: 0,
            targetYaw: 0,
            targetPitch: 0,
            targetAimDot: 0,
            pursuitActive: false,
            pursuitYaw: 0,
            pursuitPitch: 0,
            pursuitAimDot: 0,
            portalIntentActive: false,
            portalIntentScore: 0,
        };
        this.facade = new BotSensorsFacade(this);
    }

    _bindRuntime(bot) {
        if (!bot) return;
        this._runtimeBot = bot;
        this.profile = bot.profile;
        this.state = bot.state;
        this._recentBouncePressure = bot._recentBouncePressure;
        this._portalEntry = bot._portalEntry || this._portalEntry;
        this._portalExit = bot._portalExit || this._portalExit;
        this._portalTarget = bot._portalTarget || null;
    }

    bindRuntime(bot) {
        this._bindRuntime(bot);
        return this;
    }

    _syncRuntimeState() {
        if (!this._runtimeBot) return;
        this._runtimeBot._portalTarget = this._portalTarget;
    }

    setSensePhase(phase) {
        const normalized = Number.isFinite(phase)
            ? Math.max(0, Math.floor(phase)) % AI_SENSE_PHASE_WINDOW
            : 0;
        this._sensePhase = normalized;
    }

    _buildBasis(forward) {
        buildPerceptionBasis(forward, this._tmpRight, this._tmpUp);
    }

    _computeDynamicLookAhead(player) {
        const base = Math.max(
            AI_SENSOR_LOOKAHEAD.minimumDistance,
            Number(this.profile?.lookAhead) || AI_SENSOR_LOOKAHEAD.defaultBaseDistance
        );
        const speedRatio = player.baseSpeed > 0 ? player.speed / player.baseSpeed : 1;
        let lookAhead = base * (1 + (speedRatio - 1) * AI_SENSOR_LOOKAHEAD.speedRatioWeight);
        if (player.isBoosting) lookAhead *= AI_SENSOR_LOOKAHEAD.boostMultiplier;
        return Math.max(AI_SENSOR_LOOKAHEAD.minimumDistance, lookAhead);
    }

    _mapBehavior(arena) {
        const mapKey = arena?.currentMapKey || 'standard';
        return MAP_BEHAVIOR[mapKey] || MAP_BEHAVIOR.standard;
    }

    _composeProbeDirection(forward, right, up, probe) {
        composeProbeDirection(this, forward, right, up, probe);
    }

    _buildCollisionMemoKey(position, radius, excludePlayerIndex, skipRecent) {
        const qx = Math.round(position.x * BOT_COLLISION_CACHE_POS_SCALE);
        const qy = Math.round(position.y * BOT_COLLISION_CACHE_POS_SCALE);
        const qz = Math.round(position.z * BOT_COLLISION_CACHE_POS_SCALE);
        const qr = Math.round(radius * BOT_COLLISION_CACHE_RADIUS_SCALE);

        let hash = 2166136261;
        hash = Math.imul(hash ^ qx, 16777619);
        hash = Math.imul(hash ^ qy, 16777619);
        hash = Math.imul(hash ^ qz, 16777619);
        hash = Math.imul(hash ^ qr, 16777619);
        hash = Math.imul(hash ^ (excludePlayerIndex + 2048), 16777619);
        hash = Math.imul(hash ^ skipRecent, 16777619);
        return hash >>> 0;
    }

    _getCollisionMemoized(entityManager, position, radius, excludePlayerIndex, skipRecent, playerRef) {
        const key = this._buildCollisionMemoKey(position, radius, excludePlayerIndex, skipRecent);
        const cached = this._collisionCache.get(key);
        if (cached !== undefined) {
            return cached === 1;
        }

        const hit = entityManager.checkGlobalCollision(position, radius, excludePlayerIndex, skipRecent, playerRef);
        const hasHit = !!(hit && hit.hit);
        this._collisionCache.set(key, hasHit ? 1 : 0);
        return hasHit;
    }

    _checkTrailHit(
        position,
        player,
        _allPlayers,
        radius = player.hitboxRadius * AI_SENSOR_TRAIL_COLLISION.radiusMultiplier,
        skipRecent = AI_SENSOR_TRAIL_COLLISION.skipRecentSegments
    ) {
        const entityManager = player?.trail?.entityManager;
        if (!entityManager) return false;
        return this._getCollisionMemoized(entityManager, position, radius, player.index, skipRecent, player);
    }

    checkTrailHit(
        position,
        player,
        allPlayers,
        radius = player.hitboxRadius * AI_SENSOR_TRAIL_COLLISION.radiusMultiplier,
        skipRecent = AI_SENSOR_TRAIL_COLLISION.skipRecentSegments
    ) {
        return this._checkTrailHit(position, player, allPlayers, radius, skipRecent);
    }

    _scanProbeRay(player, arena, allPlayers, direction, lookAhead, step, out) {
        scanProbeRay(this, player, arena, allPlayers, direction, lookAhead, step, out);
    }

    _scoreProbe(player, arena, allPlayers, probe, lookAhead) {
        scoreProbe(this, player, arena, allPlayers, probe, lookAhead);
    }

    _estimateExitSafety(exit, arena, player, allPlayers) {
        return estimateExitSafety(this, exit, arena, player, allPlayers);
    }

    _senseProjectiles(player, projectiles) {
        senseProjectiles(this, player, projectiles);
    }

    _senseHeight(player, arena) {
        senseHeight(this, player, arena);
    }

    _senseBotSpacing(player, allPlayers) {
        senseBotSpacing(this, player, allPlayers);
    }

    _evaluatePursuit(player) {
        evaluatePursuit(this, player);
    }

    _evaluatePortalIntent(player, arena, allPlayers) {
        evaluatePortalIntent(this, player, arena, allPlayers);
    }

    _updateTargetSteering(player) {
        this.sense.targetYaw = 0;
        this.sense.targetPitch = 0;
        this.sense.targetAimDot = 0;

        const target = this.state?.targetPlayer || null;
        if (!player || !target || !target.alive) return;

        player.getDirection(this._tmpForward).normalize();
        this._buildBasis(this._tmpForward);
        this._tmpVec.subVectors(target.position, player.position);
        const steering = computeTargetSteeringSignals(
            this._tmpForward,
            this._tmpRight,
            this._tmpUp,
            this._tmpVec,
            {
                yawDeadzone: PERCEPTION_THRESHOLDS.targetYawDeadzone,
                pitchDeadzone: PERCEPTION_THRESHOLDS.targetPitchDeadzone,
            }
        );
        this.sense.targetAimDot = steering.aimDot;
        this.sense.targetYaw = steering.yaw;
        this.sense.targetPitch = steering.pitch;
    }

    update(bot, player, arena, allPlayers, projectiles) {
        this._bindRuntime(bot);
        runPerception(this.facade.bindRuntime(bot), player, arena, allPlayers, projectiles);
        this._updateTargetSteering(player);
        this._syncRuntimeState();
        return this.sense;
    }

    getSnapshot() {
        const snapshot = this._sensorSnapshot;
        snapshot.targetPlayer = this.state?.targetPlayer || null;
        snapshot.targetDistanceSq = this.sense.targetDistanceSq;
        snapshot.targetInFront = this.sense.targetInFront;
        snapshot.lookAhead = this.sense.lookAhead;
        snapshot.forwardRisk = this.sense.forwardRisk;
        snapshot.immediateDanger = this.sense.immediateDanger;
        snapshot.pressure = this.sense.pressure;
        snapshot.projectileThreat = this.sense.projectileThreat;
        snapshot.projectileEvadeYaw = this.sense.projectileEvadeYaw;
        snapshot.projectileEvadePitch = this.sense.projectileEvadePitch;
        snapshot.targetYaw = this.sense.targetYaw;
        snapshot.targetPitch = this.sense.targetPitch;
        snapshot.targetAimDot = this.sense.targetAimDot;
        snapshot.pursuitActive = this.sense.pursuitActive;
        snapshot.pursuitYaw = this.sense.pursuitYaw;
        snapshot.pursuitPitch = this.sense.pursuitPitch;
        snapshot.pursuitAimDot = this.sense.pursuitAimDot;
        snapshot.portalIntentActive = !!this.state?.portalIntentActive;
        snapshot.portalIntentScore = Number(this.state?.portalIntentScore) || 0;
        return snapshot;
    }

    getSensorArray() {
        const out = this._sensorArray;
        const lookAhead = Math.max(1, Number(this.sense.lookAhead) || 1);
        let cursor = 0;

        for (let i = 0; i < this._probes.length; i++) {
            const probe = this._probes[i];
            out[cursor++] = normalizeDistance(probe.wallDist, lookAhead);
            out[cursor++] = normalizeDistance(probe.trailDist, lookAhead);
            out[cursor++] = normalizeDistance(probe.clearance, lookAhead);
            out[cursor++] = probe.immediateDanger ? 1 : 0;
            out[cursor++] = normalizeRisk(probe.risk);
        }

        out[cursor++] = clamp01(this.sense.forwardRisk);
        out[cursor++] = this.sense.immediateDanger ? 1 : 0;
        out[cursor++] = normalizePressure(this.sense.pressure);
        out[cursor++] = normalizeDistance(this.sense.localOpenness, lookAhead);
        out[cursor++] = normalizeSigned(this.sense.mapCaution);
        out[cursor++] = normalizeSigned(this.sense.mapPortalBias);
        out[cursor++] = normalizeSigned(this.sense.mapAggressionBias);
        out[cursor++] = this.sense.projectileThreat ? 1 : 0;
        out[cursor++] = normalizeSigned(this.sense.projectileEvadeYaw);
        out[cursor++] = normalizeSigned(this.sense.projectileEvadePitch);
        out[cursor++] = normalizeSigned(this.sense.heightBias);
        out[cursor++] = normalizeSigned(this.sense.botRepulsionYaw);
        out[cursor++] = normalizeSigned(this.sense.botRepulsionPitch);
        out[cursor++] = this.sense.pursuitActive ? 1 : 0;
        out[cursor++] = normalizeSigned(this.sense.pursuitYaw);
        out[cursor++] = normalizeSigned(this.sense.pursuitPitch);
        out[cursor++] = normalizeSigned(this.sense.pursuitAimDot);
        out[cursor++] = normalizeTargetDistance(this.sense.targetDistanceSq, lookAhead);
        out[cursor++] = this.sense.targetInFront ? 1 : 0;
        out[cursor++] = normalizeSigned(this.sense.targetYaw);
        out[cursor++] = normalizeSigned(this.sense.targetPitch);
        out[cursor++] = normalizeSigned(this.sense.targetAimDot);
        out[cursor++] = this.state?.portalIntentActive ? 1 : 0;
        out[cursor++] = clamp01(this.state?.portalIntentScore);

        return out;
    }
}

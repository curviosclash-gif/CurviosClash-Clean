import * as THREE from 'three';
import { CameraCollisionSolver } from './CameraCollisionSolver.js';

function toPositiveNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

// Shot types cycled by the director.
const SHOT_TYPE = Object.freeze({
    WIDE_ORBIT: 0,
    CHASE_CLOSE: 1,
    SIDE_TRACK: 2,
    HIGH_OVERVIEW: 3,
    DUEL_FOCUS: 4,
});

// --- Slot styles: cinematic (slot 0) vs action (slot 1) -------------------

const SLOT_STYLE = Object.freeze({
    CINEMATIC: 'cinematic',
    ACTION: 'action',
});

const STYLE_CONFIG = Object.freeze({
    [SLOT_STYLE.CINEMATIC]: Object.freeze({
        sequence: Object.freeze([
            SHOT_TYPE.WIDE_ORBIT,
            SHOT_TYPE.HIGH_OVERVIEW,
            SHOT_TYPE.CHASE_CLOSE,
            SHOT_TYPE.SIDE_TRACK,
        ]),
        durationMin: 4.0,
        durationMax: 6.0,
        radiusMul: 1.15,
        liftMul: 1.1,
        orbitSpeedMul: 0.75,
        transitionSpeedMul: 0.8,
    }),
    [SLOT_STYLE.ACTION]: Object.freeze({
        sequence: Object.freeze([
            SHOT_TYPE.CHASE_CLOSE,
            SHOT_TYPE.SIDE_TRACK,
            SHOT_TYPE.WIDE_ORBIT,
            SHOT_TYPE.HIGH_OVERVIEW,
            SHOT_TYPE.CHASE_CLOSE,
        ]),
        durationMin: 2.5,
        durationMax: 4.0,
        radiusMul: 0.85,
        liftMul: 0.85,
        orbitSpeedMul: 1.3,
        transitionSpeedMul: 1.3,
    }),
});

function getStyleConfig(slotStyle) {
    return STYLE_CONFIG[slotStyle] || STYLE_CONFIG[SLOT_STYLE.CINEMATIC];
}

function pickShotDuration(sequenceIndex, playerIndex, style) {
    const cfg = getStyleConfig(style);
    const t = Math.sin((sequenceIndex + 1) * 2.17 + playerIndex * 1.31) * 0.5 + 0.5;
    return cfg.durationMin + t * (cfg.durationMax - cfg.durationMin);
}

// --- Gameplay event detection thresholds ----------------------------------

const EVENT_HP_DROP_THRESHOLD = 0.08;
const EVENT_SCORE_CHANGE_THRESHOLD = 0.5;
const EVENT_SPEED_BURST_THRESHOLD = 1.4;

const EVENT_OVERRIDE_HIT = 1.8;
const EVENT_OVERRIDE_SCORE = 1.5;
const EVENT_OVERRIDE_BOOST = 2.0;
const EVENT_OVERRIDE_DUEL = 3.0;

const SHAKE_HIT = 0.35;
const SHAKE_SCORE = 0.15;
const SHAKE_BOOST = 0.08;

// --- Duel detection -------------------------------------------------------

const DUEL_PROXIMITY_THRESHOLD = 15;
const DUEL_PROXIMITY_SQ = DUEL_PROXIMITY_THRESHOLD * DUEL_PROXIMITY_THRESHOLD;

// --- Dynamic FOV ----------------------------------------------------------

const BASE_FOV_OFFSET = 0;
const FOV_BOOST_OFFSET = 15;       // degrees wider on boost
const FOV_HIT_OFFSET = -10;        // degrees narrower on hit (dolly zoom)
const FOV_HIT_SNAP_BACK = 5;       // overshoot on recovery
const FOV_DUEL_OFFSET = 8;         // slightly wider for duel framing
const FOV_DECAY_SPEED = 6.0;
const FOV_SNAP_BACK_DELAY = 0.25;  // seconds before snap-back starts

// --- Letterbox transition -------------------------------------------------

const LETTERBOX_FADE_IN = 0.12;    // seconds
const LETTERBOX_HOLD = 0.06;       // seconds at full
const LETTERBOX_FADE_OUT = 0.18;   // seconds
const LETTERBOX_TOTAL = LETTERBOX_FADE_IN + LETTERBOX_HOLD + LETTERBOX_FADE_OUT;

export { SHOT_TYPE, SLOT_STYLE };

export class RecordingOrbitCameraDirector {
    constructor({
        orbitSpeed = 0.9,
        smoothSpeed = 8.0,
        enterSpeed = 3.5,
        exitSpeed = 7.5,
        minDistance = 2.5,
        baseRadius = 10.0,
        baseLift = 3.8,
        baseLookAhead = 5.5,
        transitionSpeed = 4.5,
    } = {}) {
        this.orbitSpeed = toPositiveNumber(orbitSpeed, 0.9);
        this.smoothSpeed = toPositiveNumber(smoothSpeed, 8.0);
        this.enterSpeed = toPositiveNumber(enterSpeed, 3.5);
        this.exitSpeed = toPositiveNumber(exitSpeed, 7.5);
        this.minDistance = toPositiveNumber(minDistance, 2.5);
        this.baseRadius = toPositiveNumber(baseRadius, 10.0);
        this.baseLift = toPositiveNumber(baseLift, 3.8);
        this.baseLookAhead = toPositiveNumber(baseLookAhead, 5.5);
        this.transitionSpeed = toPositiveNumber(transitionSpeed, 4.5);

        this._phaseByPlayer = [];
        this._blendByPlayer = [];

        // Shot-switching state per player.
        this._shotTimerByPlayer = [];
        this._shotDurationByPlayer = [];
        this._shotSeqIndexByPlayer = [];
        this._slotStyleByPlayer = [];
        this._prevShotType = [];

        // Gameplay event tracking per player.
        this._prevHpRatio = [];
        this._prevScore = [];
        this._prevBoosting = [];
        this._baselineSpeed = [];
        this._eventOverrideShot = [];
        this._eventOverrideTimer = [];
        this._shakeIntensity = [];
        this._shakeDecay = [];

        // Dynamic FOV per player.
        this._fovOffset = [];
        this._fovTarget = [];
        this._fovSnapBackTimer = [];

        // Letterbox transition per player.
        this._letterboxTimer = [];

        this._tmpDir = new THREE.Vector3();
        this._tmpSide = new THREE.Vector3();
        this._tmpDesiredPosition = new THREE.Vector3();
        this._tmpDesiredLookAt = new THREE.Vector3();
        this._tmpTargetPosition = new THREE.Vector3();
        this._tmpTargetLookAt = new THREE.Vector3();
        this._tmpMidpoint = new THREE.Vector3();
        this._tmpToOther = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);
        this._collisionSolver = new CameraCollisionSolver();
    }

    reset() {
        this._phaseByPlayer.length = 0;
        this._blendByPlayer.length = 0;
        this._shotTimerByPlayer.length = 0;
        this._shotDurationByPlayer.length = 0;
        this._shotSeqIndexByPlayer.length = 0;
        this._slotStyleByPlayer.length = 0;
        this._prevShotType.length = 0;
        this._prevHpRatio.length = 0;
        this._prevScore.length = 0;
        this._prevBoosting.length = 0;
        this._baselineSpeed.length = 0;
        this._eventOverrideShot.length = 0;
        this._eventOverrideTimer.length = 0;
        this._shakeIntensity.length = 0;
        this._shakeDecay.length = 0;
        this._fovOffset.length = 0;
        this._fovTarget.length = 0;
        this._fovSnapBackTimer.length = 0;
        this._letterboxTimer.length = 0;
        this._collisionSolver.reset();
    }

    /** Returns letterbox progress 0..1 for the given player slot. */
    getLetterboxProgress(playerIndex) {
        const timer = this._letterboxTimer[playerIndex] || 0;
        if (timer <= 0) return 0;
        const remaining = Math.max(0, LETTERBOX_TOTAL - timer);
        if (remaining <= 0) return 0;

        if (timer < LETTERBOX_FADE_IN) {
            return timer / LETTERBOX_FADE_IN;
        }
        if (timer < LETTERBOX_FADE_IN + LETTERBOX_HOLD) {
            return 1;
        }
        const fadeOutElapsed = timer - LETTERBOX_FADE_IN - LETTERBOX_HOLD;
        return Math.max(0, 1 - fadeOutElapsed / LETTERBOX_FADE_OUT);
    }

    _isWithinArenaBounds(position, arena) {
        const bounds = arena?.bounds || null;
        if (!bounds?.min || !bounds?.max) return true;
        const margin = 1.25;
        return (
            position.x >= (bounds.min.x + margin)
            && position.x <= (bounds.max.x - margin)
            && position.y >= (bounds.min.y + margin)
            && position.y <= (bounds.max.y - margin)
            && position.z >= (bounds.min.z + margin)
            && position.z <= (bounds.max.z - margin)
        );
    }

    // --- Shot computation helpers ----------------------------------------

    _computeWideOrbit(phase, playerIndex, playerPosition, cfg) {
        const radius = this.baseRadius * cfg.radiusMul;
        const lift = this.baseLift * cfg.liftMul;
        const orbitRadius = radius + (Math.sin((phase * 0.7) + playerIndex * 0.4) * 1.8);
        const orbitOffset = Math.cos((phase * 1.1) + playerIndex * 0.3) * orbitRadius;
        const forwardOffset = -4.2 + (Math.sin((phase * 0.55) + playerIndex * 0.2) * 1.6);
        const vertLift = lift + (Math.cos((phase * 0.4) + playerIndex) * 1.05);

        this._tmpDesiredPosition.copy(playerPosition)
            .addScaledVector(this._tmpSide, orbitOffset)
            .addScaledVector(this._tmpDir, forwardOffset);
        this._tmpDesiredPosition.y += vertLift;

        this._tmpDesiredLookAt.copy(playerPosition)
            .addScaledVector(this._tmpDir, this.baseLookAhead + (Math.sin(phase * 0.5) * 1.2));
    }

    _computeChaseClose(phase, playerIndex, playerPosition, cfg) {
        const behindDist = (3.8 + Math.sin(phase * 0.35 + playerIndex) * 0.6) * cfg.radiusMul;
        const lift = (1.6 + Math.cos(phase * 0.25 + playerIndex * 0.5) * 0.3) * cfg.liftMul;
        const sideWobble = Math.sin(phase * 0.6 + playerIndex * 0.7) * 0.8;

        this._tmpDesiredPosition.copy(playerPosition)
            .addScaledVector(this._tmpDir, -behindDist)
            .addScaledVector(this._tmpSide, sideWobble);
        this._tmpDesiredPosition.y += lift;

        this._tmpDesiredLookAt.copy(playerPosition)
            .addScaledVector(this._tmpDir, 3.0);
    }

    _computeSideTrack(phase, playerIndex, playerPosition, cfg) {
        const sideDist = (6.5 + Math.sin(phase * 0.45 + playerIndex * 0.6) * 1.2) * cfg.radiusMul;
        const side = (playerIndex % 2 === 0) ? 1 : -1;
        const forwardLead = 1.5 + Math.sin(phase * 0.3) * 1.0;
        const lift = (2.2 + Math.cos(phase * 0.5 + playerIndex) * 0.6) * cfg.liftMul;

        this._tmpDesiredPosition.copy(playerPosition)
            .addScaledVector(this._tmpSide, sideDist * side)
            .addScaledVector(this._tmpDir, forwardLead);
        this._tmpDesiredPosition.y += lift;

        this._tmpDesiredLookAt.copy(playerPosition)
            .addScaledVector(this._tmpDir, 2.0);
        this._tmpDesiredLookAt.y += 0.5;
    }

    _computeHighOverview(phase, playerIndex, playerPosition, cfg) {
        const height = (12.0 + Math.sin(phase * 0.3 + playerIndex * 0.4) * 2.0) * cfg.liftMul;
        const slowOrbit = Math.cos(phase * 0.25 + playerIndex * 0.5) * 4.0;
        const forwardDrift = Math.sin(phase * 0.2) * 2.0;

        this._tmpDesiredPosition.copy(playerPosition)
            .addScaledVector(this._tmpSide, slowOrbit)
            .addScaledVector(this._tmpDir, forwardDrift);
        this._tmpDesiredPosition.y += height;

        this._tmpDesiredLookAt.copy(playerPosition);
        this._tmpDesiredLookAt.y += 0.3;
    }

    _computeDuelFocus(phase, playerIndex, playerPosition, otherPosition, cfg) {
        // Camera frames both players from a raised side angle.
        this._tmpMidpoint.copy(playerPosition).add(otherPosition).multiplyScalar(0.5);
        this._tmpToOther.copy(otherPosition).sub(playerPosition);
        const separation = Math.max(1, this._tmpToOther.length());
        this._tmpToOther.normalize();

        // Perpendicular to the line between players (horizontal).
        const perpX = -this._tmpToOther.z;
        const perpZ = this._tmpToOther.x;
        const perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
        const normPerpX = perpLen > 0.001 ? perpX / perpLen : 1;
        const normPerpZ = perpLen > 0.001 ? perpZ / perpLen : 0;

        const sideOscillation = Math.sin(phase * 0.35 + playerIndex) * 0.3;
        const camDist = (separation * 0.7 + 6.0) * cfg.radiusMul;
        const side = (playerIndex % 2 === 0 ? 1 : -1) + sideOscillation;
        const lift = (4.5 + separation * 0.2) * cfg.liftMul;

        this._tmpDesiredPosition.set(
            this._tmpMidpoint.x + normPerpX * camDist * side,
            this._tmpMidpoint.y + lift,
            this._tmpMidpoint.z + normPerpZ * camDist * side
        );

        this._tmpDesiredLookAt.copy(this._tmpMidpoint);
        this._tmpDesiredLookAt.y += 0.5;
    }

    // --- Shot selection ---------------------------------------------------

    _advanceShotTimer(playerIndex, dt, slotStyle) {
        if (this._shotTimerByPlayer[playerIndex] === undefined
            || this._slotStyleByPlayer[playerIndex] !== slotStyle) {
            this._shotTimerByPlayer[playerIndex] = 0;
            this._shotSeqIndexByPlayer[playerIndex] = 0;
            this._shotDurationByPlayer[playerIndex] = pickShotDuration(0, playerIndex, slotStyle);
            this._slotStyleByPlayer[playerIndex] = slotStyle;
        }

        this._shotTimerByPlayer[playerIndex] += dt;

        const cfg = getStyleConfig(slotStyle);
        const duration = this._shotDurationByPlayer[playerIndex];
        if (this._shotTimerByPlayer[playerIndex] >= duration) {
            this._shotTimerByPlayer[playerIndex] -= duration;
            const nextIdx = (this._shotSeqIndexByPlayer[playerIndex] + 1) % cfg.sequence.length;
            this._shotSeqIndexByPlayer[playerIndex] = nextIdx;
            this._shotDurationByPlayer[playerIndex] = pickShotDuration(nextIdx, playerIndex, slotStyle);
        }

        return cfg.sequence[this._shotSeqIndexByPlayer[playerIndex]];
    }

    _computeDesiredShotPosition(shotType, phase, playerIndex, playerPosition, cfg, otherPosition) {
        if (shotType === SHOT_TYPE.DUEL_FOCUS && otherPosition) {
            this._computeDuelFocus(phase, playerIndex, playerPosition, otherPosition, cfg);
            return;
        }
        switch (shotType) {
            case SHOT_TYPE.CHASE_CLOSE:
                this._computeChaseClose(phase, playerIndex, playerPosition, cfg);
                break;
            case SHOT_TYPE.SIDE_TRACK:
                this._computeSideTrack(phase, playerIndex, playerPosition, cfg);
                break;
            case SHOT_TYPE.HIGH_OVERVIEW:
                this._computeHighOverview(phase, playerIndex, playerPosition, cfg);
                break;
            default:
                this._computeWideOrbit(phase, playerIndex, playerPosition, cfg);
                break;
        }
    }

    // --- Gameplay event detection ----------------------------------------

    _detectEvents(playerIndex, playerState, dt) {
        if (!playerState) return;

        const hp = Number(playerState.hp) || 0;
        const maxHp = Math.max(0.01, Number(playerState.maxHp) || 1);
        const hpRatio = Math.max(0, Math.min(1, hp / maxHp));
        const score = Number(playerState.score) || 0;
        const speed = Number(playerState.speed) || 0;
        const isBoosting = !!playerState.isBoosting;

        const prevHp = this._prevHpRatio[playerIndex];
        const prevScore = this._prevScore[playerIndex];
        const prevBoosting = this._prevBoosting[playerIndex];

        const prevBaseline = this._baselineSpeed[playerIndex] || speed;
        this._baselineSpeed[playerIndex] = prevBaseline + (speed - prevBaseline) * Math.min(1, dt * 0.5);

        this._prevHpRatio[playerIndex] = hpRatio;
        this._prevScore[playerIndex] = score;
        this._prevBoosting[playerIndex] = isBoosting;

        if (prevHp === undefined) return;

        if (this._eventOverrideTimer[playerIndex] > 0) {
            this._eventOverrideTimer[playerIndex] = Math.max(0, this._eventOverrideTimer[playerIndex] - dt);
        }

        if (this._shakeIntensity[playerIndex] > 0) {
            const decay = this._shakeDecay[playerIndex] || 4.0;
            this._shakeIntensity[playerIndex] = Math.max(0, this._shakeIntensity[playerIndex] - dt * decay);
        }

        // Detect HP drop (got hit).
        const hpDrop = prevHp - hpRatio;
        if (hpDrop >= EVENT_HP_DROP_THRESHOLD) {
            this._eventOverrideShot[playerIndex] = SHOT_TYPE.CHASE_CLOSE;
            this._eventOverrideTimer[playerIndex] = EVENT_OVERRIDE_HIT;
            this._shakeIntensity[playerIndex] = Math.min(1, SHAKE_HIT + hpDrop * 0.5);
            this._shakeDecay[playerIndex] = 3.0;
            // FOV: dolly zoom (narrow, then snap back).
            this._fovTarget[playerIndex] = FOV_HIT_OFFSET;
            this._fovSnapBackTimer[playerIndex] = FOV_SNAP_BACK_DELAY;
            return;
        }

        // Detect score increase.
        if (score > (prevScore || 0) + EVENT_SCORE_CHANGE_THRESHOLD) {
            this._eventOverrideShot[playerIndex] = SHOT_TYPE.HIGH_OVERVIEW;
            this._eventOverrideTimer[playerIndex] = EVENT_OVERRIDE_SCORE;
            this._shakeIntensity[playerIndex] = SHAKE_SCORE;
            this._shakeDecay[playerIndex] = 5.0;
            this._fovTarget[playerIndex] = FOV_HIT_SNAP_BACK;
            return;
        }

        // Detect boost start.
        if (isBoosting && !prevBoosting) {
            this._eventOverrideShot[playerIndex] = SHOT_TYPE.SIDE_TRACK;
            this._eventOverrideTimer[playerIndex] = EVENT_OVERRIDE_BOOST;
            this._shakeIntensity[playerIndex] = SHAKE_BOOST;
            this._shakeDecay[playerIndex] = 6.0;
            // FOV: wider for speed feel.
            this._fovTarget[playerIndex] = FOV_BOOST_OFFSET;
            return;
        }

        // Sustained boost keeps FOV wide.
        if (isBoosting) {
            this._fovTarget[playerIndex] = FOV_BOOST_OFFSET;
            return;
        }

        // Detect speed burst.
        const baseline = this._baselineSpeed[playerIndex] || 1;
        if (baseline > 0 && speed / baseline >= EVENT_SPEED_BURST_THRESHOLD && speed > 5) {
            this._eventOverrideShot[playerIndex] = SHOT_TYPE.CHASE_CLOSE;
            this._eventOverrideTimer[playerIndex] = 1.2;
            this._shakeIntensity[playerIndex] = Math.max(
                this._shakeIntensity[playerIndex] || 0, 0.05
            );
            this._shakeDecay[playerIndex] = 8.0;
        }
    }

    // --- Duel proximity ---------------------------------------------------

    _checkDuelProximity(playerIndex, playerPosition, otherPosition) {
        if (!otherPosition) return false;
        const distSq = playerPosition.distanceToSquared(otherPosition);
        return distSq <= DUEL_PROXIMITY_SQ;
    }

    // --- Dynamic FOV ------------------------------------------------------

    _updateFov(playerIndex, camera, dt, baseFov, isDuel) {
        if (!camera) return;

        // Snap-back timer for dolly zoom: after the initial narrow FOV,
        // overshoots slightly wide before returning to baseline.
        if ((this._fovSnapBackTimer[playerIndex] || 0) > 0) {
            this._fovSnapBackTimer[playerIndex] -= dt;
            if (this._fovSnapBackTimer[playerIndex] <= 0) {
                this._fovTarget[playerIndex] = FOV_HIT_SNAP_BACK;
                this._fovSnapBackTimer[playerIndex] = 0;
            }
        }

        let target = this._fovTarget[playerIndex] || BASE_FOV_OFFSET;
        if (isDuel) {
            target = Math.max(target, FOV_DUEL_OFFSET);
        }

        // Decay FOV target toward zero when no event is driving it.
        if ((this._eventOverrideTimer[playerIndex] || 0) <= 0
            && (this._fovSnapBackTimer[playerIndex] || 0) <= 0) {
            this._fovTarget[playerIndex] = target + (0 - target) * Math.min(1, dt * 3.0);
            target = this._fovTarget[playerIndex];
        }

        const current = this._fovOffset[playerIndex] || 0;
        const alpha = 1 - Math.exp(-FOV_DECAY_SPEED * dt);
        const next = current + (target - current) * alpha;
        this._fovOffset[playerIndex] = Math.abs(next) < 0.05 ? 0 : next;

        const desiredFov = baseFov + this._fovOffset[playerIndex];
        if (Math.abs(camera.fov - desiredFov) > 0.01) {
            camera.fov = desiredFov;
            camera.updateProjectionMatrix();
        }
    }

    // --- Shake & letterbox ------------------------------------------------

    _applyShake(camera, playerIndex, phase) {
        const intensity = this._shakeIntensity[playerIndex] || 0;
        if (intensity <= 0.001) return;

        const freq = 25 + playerIndex * 3;
        const ox = Math.sin(phase * freq) * intensity * 0.12;
        const oy = Math.cos(phase * freq * 1.3) * intensity * 0.08;
        camera.position.x += ox;
        camera.position.y += oy;
    }

    _updateLetterbox(playerIndex, shotType, dt) {
        const prev = this._prevShotType[playerIndex];
        // Trigger letterbox on shot change.
        if (prev !== undefined && prev !== shotType) {
            this._letterboxTimer[playerIndex] = 0.001; // start
        }
        this._prevShotType[playerIndex] = shotType;

        if ((this._letterboxTimer[playerIndex] || 0) > 0) {
            this._letterboxTimer[playerIndex] += dt;
            if (this._letterboxTimer[playerIndex] >= LETTERBOX_TOTAL) {
                this._letterboxTimer[playerIndex] = 0;
            }
        }
    }

    // --- Main entry point ------------------------------------------------

    apply({
        playerIndex,
        camera,
        fallbackTarget,
        playerPosition,
        playerDirection,
        dt,
        arena = null,
        slotStyle = SLOT_STYLE.CINEMATIC,
        playerState = null,
        otherPlayerPosition = null,
        baseFov = 0,
    }) {
        if (!camera || !playerPosition || !playerDirection) return;
        if (!Number.isInteger(playerIndex) || playerIndex < 0) return;

        const safeDt = Math.max(0, Number(dt) || 0);
        const cfg = getStyleConfig(slotStyle);
        const effectiveOrbitSpeed = this.orbitSpeed * cfg.orbitSpeedMul;
        const previousPhase = this._phaseByPlayer[playerIndex] || 0;
        const phase = previousPhase + (safeDt * effectiveOrbitSpeed * (1 + playerIndex * 0.13));
        this._phaseByPlayer[playerIndex] = phase;

        this._tmpDir.copy(playerDirection);
        if (this._tmpDir.lengthSq() <= 0.000001) {
            this._tmpDir.set(0, 0, -1);
        } else {
            this._tmpDir.normalize();
        }

        this._tmpSide.crossVectors(this._up, this._tmpDir);
        if (this._tmpSide.lengthSq() <= 0.000001) {
            this._tmpSide.set(1, 0, 0);
        } else {
            this._tmpSide.normalize();
        }

        // Detect gameplay events and update overrides/shake.
        this._detectEvents(playerIndex, playerState, safeDt);

        // Duel proximity check.
        const isDuel = this._checkDuelProximity(playerIndex, playerPosition, otherPlayerPosition);
        if (isDuel && (this._eventOverrideTimer[playerIndex] || 0) <= 0) {
            this._eventOverrideShot[playerIndex] = SHOT_TYPE.DUEL_FOCUS;
            this._eventOverrideTimer[playerIndex] = EVENT_OVERRIDE_DUEL;
        }

        // Advance shot timer; use event override if active.
        let shotType = this._advanceShotTimer(playerIndex, safeDt, slotStyle);
        if ((this._eventOverrideTimer[playerIndex] || 0) > 0
            && this._eventOverrideShot[playerIndex] !== undefined) {
            shotType = this._eventOverrideShot[playerIndex];
        }

        // Letterbox transition on shot change.
        this._updateLetterbox(playerIndex, shotType, safeDt);

        this._computeDesiredShotPosition(shotType, phase, playerIndex, playerPosition, cfg, otherPlayerPosition);
        if (arena && typeof arena.checkCollision === 'function') {
            this._collisionSolver.resolve(
                playerIndex,
                `recording-orbit-${slotStyle}`,
                playerPosition,
                this._tmpDesiredPosition,
                arena
            );
        }

        const finitePosition = Number.isFinite(this._tmpDesiredPosition.x)
            && Number.isFinite(this._tmpDesiredPosition.y)
            && Number.isFinite(this._tmpDesiredPosition.z);
        const finiteLookAt = Number.isFinite(this._tmpDesiredLookAt.x)
            && Number.isFinite(this._tmpDesiredLookAt.y)
            && Number.isFinite(this._tmpDesiredLookAt.z);
        const validDistance = this._tmpDesiredPosition.distanceToSquared(playerPosition) >= (this.minDistance * this.minDistance);
        const withinBounds = this._isWithinArenaBounds(this._tmpDesiredPosition, arena);
        const useOrbitShot = finitePosition && finiteLookAt && validDistance && withinBounds;

        const previousBlend = this._blendByPlayer[playerIndex] || 0;
        const targetBlend = useOrbitShot ? 1 : 0;
        const blendSpeed = targetBlend > previousBlend ? this.enterSpeed : this.exitSpeed;
        const blendAlpha = 1 - Math.exp(-blendSpeed * safeDt);
        const blend = THREE.MathUtils.clamp(
            THREE.MathUtils.lerp(previousBlend, targetBlend, blendAlpha),
            0,
            1
        );
        this._blendByPlayer[playerIndex] = blend;

        const fallbackLookAt = fallbackTarget?.lookAt || playerPosition;
        if (!useOrbitShot || blend <= 0.0001) {
            camera.lookAt(fallbackLookAt);
            this._updateFov(playerIndex, camera, safeDt, baseFov || camera.fov, isDuel);
            return;
        }

        this._tmpTargetPosition.copy(camera.position).lerp(this._tmpDesiredPosition, blend);
        this._tmpTargetLookAt.copy(fallbackLookAt).lerp(this._tmpDesiredLookAt, blend);

        const effectiveTransition = this.transitionSpeed * cfg.transitionSpeedMul;
        const smoothAlpha = 1 - Math.exp(-effectiveTransition * safeDt);
        camera.position.lerp(this._tmpTargetPosition, smoothAlpha);
        camera.lookAt(this._tmpTargetLookAt);

        // Apply camera shake from gameplay events.
        this._applyShake(camera, playerIndex, phase);

        // Apply dynamic FOV.
        this._updateFov(playerIndex, camera, safeDt, baseFov || camera.fov, isDuel);
    }
}

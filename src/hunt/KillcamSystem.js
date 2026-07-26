// ============================================
// KillcamSystem.js - cinematic replay of the last ~2.5s before a player death
// Features: 3-shot killer follow -> impact zoom -> explosion orbit, slow-mo, letterbox
// ============================================

import * as THREE from 'three';

const KILLCAM_WINDOW_SECONDS = 2.5;
const KILLCAM_CAMERA_INDEX = 0;
const KILLCAM_ORBIT_SMOOTH_SPEED = 9.5;
const KILLCAM_MIN_DURATION = 0.6;
const KILLCAM_EXPLOSION_TRIGGER_RATIO = 0.86;
const KILLCAM_SLOWMO_TIMESCALE = 0.38;
const KILLCAM_LETTERBOX_DOM_ID = 'killcam-letterbox';

const SHOT_SEQUENCE = Object.freeze([
    Object.freeze({
        id: 'killer_chase',
        durationRatio: 0.42,
        radius: 7.5,
        offsetBack: 5.5,
        offsetLift: 1.4,
        orbitSpeed: 0.10,
        lookLift: 0.6,
        fov: 52,
        timeScale: 1.0,
    }),
    Object.freeze({
        id: 'impact_zoom',
        durationRatio: 0.22,
        radius: 4.0,
        offsetBack: 2.0,
        offsetLift: 0.5,
        orbitSpeed: 0.05,
        lookLift: 0.4,
        fov: 46,
        timeScale: 0.7,
    }),
    Object.freeze({
        id: 'explosion_orbit',
        durationRatio: 0.36,
        radius: 9.0,
        offsetBack: 0,
        offsetLift: 3.2,
        orbitSpeed: 0.34,
        lookLift: 0.9,
        fov: 58,
        timeScale: KILLCAM_SLOWMO_TIMESCALE,
    }),
]);

function isSingleNodeSession(entityManager) {
    if (!entityManager) return false;
    if (entityManager.runtimeConfig?.session?.networkEnabled === true) return false;
    const humans = Array.isArray(entityManager.humanPlayers) ? entityManager.humanPlayers : [];
    return humans.length === 1;
}

// Compute a uniform rate multiplier so that the cumulative ghost-time advance,
// driven by per-shot `timeScale` values, reaches exactly `sourceDuration`
// at the wall-clock instant the explosion is triggered (triggerRatio * displayDuration).
// Without this calibration the slow-mo shots (timeScale < 1) leave the ghost
// replay stuck short of the death frame, so the orbit never shows the actual impact.
function computeGhostRateCalibration(displayDuration, sourceDuration, triggerRatio) {
    const safeD = Math.max(0.001, Number(displayDuration) || 0);
    const safeSource = Math.max(0.001, Number(sourceDuration) || 0);
    const trigger = THREE.MathUtils.clamp(Number(triggerRatio) || 0, 0.001, 1);
    const triggerWall = trigger * safeD;

    let cumulativeScaled = 0;
    let wallElapsed = 0;
    for (const shot of SHOT_SEQUENCE) {
        const shotWall = Math.max(0, Number(shot.durationRatio) || 0) * safeD;
        const shotTimeScale = Number(shot.timeScale) > 0 ? Number(shot.timeScale) : 1;
        if (wallElapsed + shotWall <= triggerWall + 1e-9) {
            cumulativeScaled += shot.durationRatio * shotTimeScale;
            wallElapsed += shotWall;
        } else {
            const remaining = Math.max(0, triggerWall - wallElapsed);
            const partialFraction = shotWall > 0
                ? THREE.MathUtils.clamp(remaining / shotWall, 0, 1)
                : 0;
            cumulativeScaled += shot.durationRatio * partialFraction * shotTimeScale;
            break;
        }
    }

    const baseConsumed = cumulativeScaled * safeD;
    return baseConsumed > 1e-6 ? safeSource / baseConsumed : 1;
}

function resolveRespawnDelaySeconds(respawnSystem) {
    const remaining = respawnSystem?.getRemainingByPlayer?.() || {};
    let maxRemaining = 0;
    for (const key of Object.keys(remaining)) {
        const value = Math.max(0, Number(remaining[key]) || 0);
        if (value > maxRemaining) maxRemaining = value;
    }
    return maxRemaining;
}

function findFrameForTime(frames, playbackTime) {
    if (!Array.isArray(frames) || frames.length === 0) return null;
    let lastIndex = frames.length - 1;
    while (lastIndex > 0 && (Number(frames[lastIndex]?.time) || 0) > playbackTime) {
        lastIndex -= 1;
    }
    const nextIndex = Math.min(frames.length - 1, lastIndex + 1);
    const prev = frames[lastIndex];
    const next = frames[nextIndex];
    const prevTime = Number(prev?.time) || 0;
    const nextTime = Number(next?.time) || prevTime;
    const alpha = nextTime > prevTime
        ? THREE.MathUtils.clamp((playbackTime - prevTime) / (nextTime - prevTime), 0, 1)
        : 0;
    return { prev, next, alpha };
}

function resolvePoseInFrame(frame, playerIdx) {
    const players = Array.isArray(frame?.players) ? frame.players : [];
    for (const pose of players) {
        if (Number(pose?.idx) === playerIdx) return pose;
    }
    return null;
}

export class KillcamSystem {
    constructor({ renderer, entityManager, recorder, respawnSystem } = {}) {
        this.renderer = renderer || null;
        this.entityManager = entityManager || null;
        this.recorder = recorder || null;
        this.respawnSystem = respawnSystem || null;

        this._active = false;
        this._elapsed = 0;
        this._displayDuration = 0;
        this._deadPlayerIndex = -1;
        this._killerIndex = -1;

        this._shotIndex = 0;
        this._shotElapsed = 0;
        this._shotDuration = 0;
        this._currentShot = null;
        this._startAngle = 0;

        this._focusPoint = new THREE.Vector3();
        this._killerPosition = new THREE.Vector3();
        this._killerQuaternion = new THREE.Quaternion();
        this._killerDirection = new THREE.Vector3(0, 0, -1);
        this._tmpPosition = new THREE.Vector3();
        this._tmpLookAt = new THREE.Vector3();
        this._tmpVec = new THREE.Vector3();
        this._baseFov = 75;
        this._explosionTriggered = false;
        this._deadPlayerColor = 0xffffff;
        this._frames = [];
        this._ghostSourceDuration = 0;
        this._ghostElapsed = 0;
        this._ghostRateCalibration = 1;
        this._visualGhostRateCalibration = 1;
        this._letterboxEl = null;
    }

    configure({ renderer, entityManager, recorder, respawnSystem } = {}) {
        if (renderer !== undefined) this.renderer = renderer;
        if (entityManager !== undefined) this.entityManager = entityManager;
        if (recorder !== undefined) this.recorder = recorder;
        if (respawnSystem !== undefined) this.respawnSystem = respawnSystem;
    }

    isActive() {
        return this._active;
    }

    getTimeScale() {
        if (!this._active || !this._currentShot) return 1;
        const shotScale = Number(this._currentShot.timeScale);
        return Number.isFinite(shotScale) && shotScale > 0 ? shotScale : 1;
    }

    onPlayerDied(player, { killer = null } = {}) {
        if (this._active) this.clear();

        const entityManager = this.entityManager;
        if (!isSingleNodeSession(entityManager)) return false;
        if (!player || player.isBot === true) return false;

        const respawnSystem = this.respawnSystem;
        if (!respawnSystem || respawnSystem.isEnabled?.() !== true) return false;
        if (!respawnSystem.isRespawnPending?.(player)) return false;

        const recorder = this.recorder;
        if (!recorder || typeof recorder.getLastRoundGhostClip !== 'function') return false;

        const respawnDelay = resolveRespawnDelaySeconds(respawnSystem);
        const displayDuration = respawnDelay > 0
            ? Math.min(KILLCAM_WINDOW_SECONDS, respawnDelay - 0.05)
            : KILLCAM_WINDOW_SECONDS;
        if (displayDuration < KILLCAM_MIN_DURATION) return false;

        const players = Array.isArray(entityManager.players) ? entityManager.players : [];
        let clip = null;
        try {
            clip = recorder.getLastRoundGhostClip(players, {
                includeBots: true,
                maxSourceDuration: KILLCAM_WINDOW_SECONDS,
                displayDuration,
            });
        } catch {
            clip = null;
        }
        if (!clip) return false;

        const played = entityManager.playLastRoundGhost?.(clip, { loop: false });
        if (played === false) return false;

        this._hideLivePlayerViewsForKillcam(players);

        this._active = true;
        this._elapsed = 0;
        this._displayDuration = displayDuration;
        this._deadPlayerIndex = Number.isInteger(player.index) ? player.index : -1;
        this._killerIndex = Number.isInteger(killer?.index) ? killer.index : -1;
        this._focusPoint.copy(player.position || this._focusPoint);
        this._explosionTriggered = false;
        this._deadPlayerColor = Number(player?.color) || 0xffffff;
        this._frames = Array.isArray(clip?.frames) ? clip.frames : [];
        this._ghostSourceDuration = Math.max(0.001, Number(clip?.sourceDuration) || displayDuration);
        this._ghostElapsed = 0;
        this._ghostRateCalibration = computeGhostRateCalibration(
            this._displayDuration,
            this._ghostSourceDuration,
            KILLCAM_EXPLOSION_TRIGGER_RATIO
        );
        this._visualGhostRateCalibration = computeGhostRateCalibration(
            this._displayDuration,
            this._displayDuration,
            KILLCAM_EXPLOSION_TRIGGER_RATIO
        );

        const cameras = this.renderer?.cameras;
        const camera = Array.isArray(cameras) ? cameras[KILLCAM_CAMERA_INDEX] : null;
        if (camera) {
            this._baseFov = Number.isFinite(camera.fov) ? camera.fov : 75;
        }

        this._initializeShot(0);
        this._showLetterbox(true);
        return true;
    }

    _hideLivePlayerViewsForKillcam(players) {
        const entityManager = this.entityManager;
        if (!entityManager) return;
        for (const p of players) {
            if (!p) continue;
            try {
                p?.view?.setVisible?.(false);
            } catch {
                // best-effort hide; restore on clear
            }
        }
    }

    _restoreLivePlayerViews() {
        const entityManager = this.entityManager;
        const players = Array.isArray(entityManager?.players) ? entityManager.players : [];
        for (const p of players) {
            if (!p) continue;
            try {
                p?.view?.setVisible?.(!!p?.alive);
            } catch {
                // best-effort restore
            }
        }
    }

    _initializeShot(shotIndex) {
        const safeIndex = Math.max(0, Math.min(SHOT_SEQUENCE.length - 1, shotIndex));
        const shot = SHOT_SEQUENCE[safeIndex];
        this._shotIndex = safeIndex;
        this._currentShot = shot;
        this._shotElapsed = 0;
        this._shotDuration = Math.max(0.05, this._displayDuration * shot.durationRatio);
        this._startAngle = safeIndex === 0
            ? Math.PI * 0.35
            : (this._startAngle + Math.PI * 0.55);
    }

    update(dt) {
        if (!this._active) return;
        const safeDt = Math.max(0, Number(dt) || 0);
        this._elapsed += safeDt;

        const remaining = this._getRemaining();
        if ((remaining <= 0 && this._deadPlayerIndex >= 0) || this._elapsed >= this._displayDuration) {
            this.clear();
            return;
        }

        if (!this._explosionTriggered) {
            const elapsedRatio = this._elapsed / Math.max(0.001, this._displayDuration);
            if (elapsedRatio >= KILLCAM_EXPLOSION_TRIGGER_RATIO) {
                this._triggerDeathExplosion();
            }
        }

        this._shotElapsed += safeDt;
        if (this._shotElapsed >= this._shotDuration && this._shotIndex < SHOT_SEQUENCE.length - 1) {
            this._initializeShot(this._shotIndex + 1);
        }
    }

    advanceGhostPlayback(scaledDt) {
        if (!this._active) return;
        const calibratedDt = Math.max(0, Number(scaledDt) || 0) * this._ghostRateCalibration;
        this._ghostElapsed = Math.min(
            this._ghostSourceDuration,
            this._ghostElapsed + calibratedDt
        );
        if (this._killerIndex < 0 || this._frames.length === 0) return;

        const frame = findFrameForTime(this._frames, this._ghostElapsed);
        if (!frame) return;
        const poseA = resolvePoseInFrame(frame.prev, this._killerIndex);
        const poseB = resolvePoseInFrame(frame.next, this._killerIndex);
        if (!poseA && !poseB) return;

        const pose1 = poseA || poseB;
        const pose2 = poseB || poseA;
        const a = frame.alpha;

        this._killerPosition.set(
            THREE.MathUtils.lerp(Number(pose1.x) || 0, Number(pose2.x) || 0, a),
            THREE.MathUtils.lerp(Number(pose1.y) || 0, Number(pose2.y) || 0, a),
            THREE.MathUtils.lerp(Number(pose1.z) || 0, Number(pose2.z) || 0, a)
        );
        const qx = THREE.MathUtils.lerp(Number(pose1.qx) || 0, Number(pose2.qx) || 0, a);
        const qy = THREE.MathUtils.lerp(Number(pose1.qy) || 0, Number(pose2.qy) || 0, a);
        const qz = THREE.MathUtils.lerp(Number(pose1.qz) || 0, Number(pose2.qz) || 0, a);
        const qw = THREE.MathUtils.lerp(Number(pose1.qw) || 1, Number(pose2.qw) || 1, a);
        this._killerQuaternion.set(qx, qy, qz, qw);
        if (this._killerQuaternion.lengthSq() > 0.000001) {
            this._killerQuaternion.normalize();
        } else {
            this._killerQuaternion.identity();
        }
        this._killerDirection.set(0, 0, -1).applyQuaternion(this._killerQuaternion).normalize();
    }

    getVisualGhostPlaybackDelta(scaledDt) {
        return Math.max(0, Number(scaledDt) || 0) * this._visualGhostRateCalibration;
    }

    _triggerDeathExplosion() {
        this._explosionTriggered = true;
        const particles = this.entityManager?.particles;
        const focus = this._focusPoint;
        if (typeof particles?.spawnExplosion === 'function') {
            try {
                particles.spawnExplosion(focus, this._deadPlayerColor);
            } catch {
                // best-effort particle effect
            }
        }

        const audio = this.entityManager?.audio;
        if (audio && typeof audio.play === 'function' && !this._deadPlayerIndexIsBot()) {
            try {
                audio.play('EXPLOSION');
            } catch {
                // ignore audio errors
            }
        }
    }

    _deadPlayerIndexIsBot() {
        const entityManager = this.entityManager;
        const players = Array.isArray(entityManager?.players) ? entityManager.players : [];
        const deadPlayer = players[this._deadPlayerIndex];
        return deadPlayer?.isBot === true || this._deadPlayerIndex < 0;
    }

    applyCinematicCamera(dt) {
        if (!this._active || !this._currentShot) return false;
        const cameras = this.renderer?.cameras;
        const camera = Array.isArray(cameras) ? cameras[KILLCAM_CAMERA_INDEX] : null;
        if (!camera) return false;

        const safeDt = Math.max(0, Number(dt) || 0);
        const shot = this._currentShot;
        const shotAlpha = THREE.MathUtils.clamp(this._shotElapsed / Math.max(0.001, this._shotDuration), 0, 1);

        if (shot.id === 'killer_chase' && this._killerIndex >= 0 && this._killerPosition.lengthSq() > 0) {
            this._applyKillerChaseShot(camera, shot, shotAlpha, safeDt);
        } else if (shot.id === 'impact_zoom') {
            this._applyImpactZoomShot(camera, shot, shotAlpha, safeDt);
        } else {
            this._applyExplosionOrbitShot(camera, shot, shotAlpha, safeDt);
        }

        if (Number.isFinite(shot.fov) && Math.abs(camera.fov - shot.fov) > 0.05) {
            const fovBlendAlpha = 1 - Math.exp(-6.5 * Math.max(safeDt, 1 / 240));
            camera.fov = THREE.MathUtils.lerp(camera.fov, shot.fov, fovBlendAlpha);
            camera.updateProjectionMatrix();
        }

        return true;
    }

    _applyKillerChaseShot(camera, shot, shotAlpha, safeDt) {
        // Position behind killer, offset along -forward vector
        const killerPos = this._killerPosition;
        const killerDir = this._killerDirection;

        // blend focus between killer (start) and dead player (end)
        const focusBlend = THREE.MathUtils.clamp(shotAlpha * 1.2, 0, 1);
        this._tmpLookAt.copy(killerPos).lerp(this._focusPoint, focusBlend);

        // camera sits behind killer, slightly above
        const backOffset = shot.offsetBack;
        this._tmpPosition.copy(killerPos)
            .addScaledVector(killerDir, -backOffset);
        this._tmpPosition.y += shot.offsetLift;

        // small lateral drift during shot
        const lateral = Math.sin(this._startAngle + shotAlpha * shot.orbitSpeed * Math.PI * 2) * 1.2;
        this._tmpVec.set(killerDir.z, 0, -killerDir.x).normalize().multiplyScalar(lateral);
        this._tmpPosition.add(this._tmpVec);

        const smoothAlpha = 1 - Math.exp(-KILLCAM_ORBIT_SMOOTH_SPEED * Math.max(safeDt, 1 / 240));
        camera.position.lerp(this._tmpPosition, smoothAlpha);
        camera.lookAt(this._tmpLookAt);
    }

    _applyImpactZoomShot(camera, shot, shotAlpha, safeDt) {
        // Zoom in toward focus point, slight dolly-in
        const startRadius = shot.radius + 6.0;
        const endRadius = shot.radius;
        const radius = THREE.MathUtils.lerp(startRadius, endRadius, shotAlpha);
        const angle = this._startAngle + shot.orbitSpeed * shotAlpha * Math.PI * 2;

        this._tmpPosition.set(
            this._focusPoint.x + Math.cos(angle) * radius,
            this._focusPoint.y + shot.offsetLift + radius * 0.15,
            this._focusPoint.z + Math.sin(angle) * radius
        );

        this._tmpLookAt.set(
            this._focusPoint.x,
            this._focusPoint.y + shot.lookLift,
            this._focusPoint.z
        );

        const smoothAlpha = 1 - Math.exp(-KILLCAM_ORBIT_SMOOTH_SPEED * Math.max(safeDt, 1 / 240));
        camera.position.lerp(this._tmpPosition, smoothAlpha);
        camera.lookAt(this._tmpLookAt);
    }

    _applyExplosionOrbitShot(camera, shot, shotAlpha, safeDt) {
        // Wide orbit around death point
        const angle = this._startAngle + shot.orbitSpeed * shotAlpha * Math.PI * 2;
        const radius = shot.radius + Math.sin(shotAlpha * Math.PI) * 1.5;

        this._tmpPosition.set(
            this._focusPoint.x + Math.cos(angle) * radius,
            this._focusPoint.y + shot.offsetLift,
            this._focusPoint.z + Math.sin(angle) * radius
        );

        this._tmpLookAt.set(
            this._focusPoint.x,
            this._focusPoint.y + shot.lookLift,
            this._focusPoint.z
        );

        // slower smoothing for slow-mo feel
        const slowSmooth = KILLCAM_ORBIT_SMOOTH_SPEED * 0.7;
        const smoothAlpha = 1 - Math.exp(-slowSmooth * Math.max(safeDt, 1 / 240));
        camera.position.lerp(this._tmpPosition, smoothAlpha);
        camera.lookAt(this._tmpLookAt);
    }

    _getRemaining() {
        const respawnSystem = this.respawnSystem;
        if (!respawnSystem || this._deadPlayerIndex < 0) return 0;
        const remainingByPlayer = respawnSystem.getRemainingByPlayer?.() || {};
        return Math.max(0, Number(remainingByPlayer[this._deadPlayerIndex]) || 0);
    }

    _resolveLetterboxEl() {
        if (this._letterboxEl !== null && this._letterboxEl !== undefined) return this._letterboxEl;
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc?.body) {
            this._letterboxEl = null;
            return null;
        }
        let el = doc.getElementById(KILLCAM_LETTERBOX_DOM_ID);
        if (!el) {
            el = doc.createElement('div');
            el.id = KILLCAM_LETTERBOX_DOM_ID;
            el.className = 'killcam-letterbox hidden';
            el.setAttribute('aria-hidden', 'true');
            const top = doc.createElement('div');
            top.className = 'killcam-letterbox-bar killcam-letterbox-top';
            const bottom = doc.createElement('div');
            bottom.className = 'killcam-letterbox-bar killcam-letterbox-bottom';
            const label = doc.createElement('div');
            label.className = 'killcam-letterbox-label';
            label.textContent = 'KILLCAM';
            el.appendChild(top);
            el.appendChild(bottom);
            el.appendChild(label);
            doc.body.appendChild(el);
        }
        this._letterboxEl = el;
        return el;
    }

    _showLetterbox(show) {
        const el = this._resolveLetterboxEl();
        if (!el) return;
        try {
            el.classList.toggle('hidden', !show);
            el.setAttribute('aria-hidden', String(!show));
        } catch {
            // best-effort toggle
        }
    }

    clear() {
        const wasActive = this._active;
        this._active = false;
        this._elapsed = 0;
        this._displayDuration = 0;
        this._deadPlayerIndex = -1;
        this._killerIndex = -1;
        this._shotIndex = 0;
        this._shotElapsed = 0;
        this._shotDuration = 0;
        this._currentShot = null;
        this._startAngle = 0;
        this._frames = [];
        this._ghostSourceDuration = 0;
        this._ghostElapsed = 0;
        this._ghostRateCalibration = 1;
        this._visualGhostRateCalibration = 1;
        this._explosionTriggered = false;

        this._showLetterbox(false);

        if (wasActive) {
            const cameras = this.renderer?.cameras;
            const camera = Array.isArray(cameras) ? cameras[KILLCAM_CAMERA_INDEX] : null;
            if (camera
                && Number.isFinite(this._baseFov)
                && Math.abs(Number(camera.fov) - this._baseFov) > 0.05) {
                try {
                    camera.fov = this._baseFov;
                    if (typeof camera.updateProjectionMatrix === 'function') {
                        camera.updateProjectionMatrix();
                    }
                } catch {
                    // best-effort reset; caller owns camera state
                }
            }
            this._restoreLivePlayerViews();
            this.entityManager?.clearLastRoundGhost?.();
        }
    }

    dispose() {
        this.clear();
        this.renderer = null;
        this.entityManager = null;
        this.recorder = null;
        this.respawnSystem = null;
        this._letterboxEl = null;
    }
}

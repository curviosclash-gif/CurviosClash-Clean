// ============================================
// KillcamSystem.js - cinematic replay of the last 2s before a player death
// Features: 3-shot killer follow -> impact zoom -> explosion orbit, slow-mo, letterbox
// ============================================

import * as THREE from 'three';
import {
    hideKillcamLivePresentation,
    restoreKillcamLivePresentation,
} from './KillcamPresentationOps.js';

const KILLCAM_SOURCE_WINDOW_SECONDS = 2;
const KILLCAM_MAX_DISPLAY_SECONDS = 2.5;
const KILLCAM_CAMERA_INDEX = 0;
const KILLCAM_ORBIT_SMOOTH_SPEED = 9.5;
const KILLCAM_MIN_DURATION = 0.6;
const KILLCAM_EXPLOSION_TRIGGER_RATIO = 0.78;
const KILLCAM_SLOWMO_TIMESCALE = 0.38;
const KILLCAM_LETTERBOX_DOM_ID = 'killcam-letterbox';
const KILLCAM_HUD_ACTIVE_CLASS = 'killcam-active';
const KILLCAM_MIN_CAMERA_DISTANCE = 4;

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

// Compute a uniform rate multiplier so that the cumulative replay-time advance,
// driven by per-shot `timeScale` values, reaches exactly `sourceDuration`
// at the wall-clock instant the explosion is triggered (triggerRatio * displayDuration).
// Without this calibration the slow-mo shots (timeScale < 1) leave the replay
// replay stuck short of the death frame, so the orbit never shows the actual impact.
function computeReplayRateCalibration(displayDuration, sourceDuration, triggerRatio) {
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

function resolveRespawnDelaySeconds(respawnSystem, player) {
    const directRemaining = respawnSystem?.getRemainingForPlayer?.(player);
    if (Number.isFinite(Number(directRemaining))) {
        return Math.max(0, Number(directRemaining));
    }
    const remaining = respawnSystem?.getRemainingByPlayer?.() || {};
    return Math.max(0, Number(remaining[player?.index]) || 0);
}

function hasFinitePosition(value) {
    return Number.isFinite(Number(value?.x))
        && Number.isFinite(Number(value?.y))
        && Number.isFinite(Number(value?.z));
}

export class KillcamSystem {
    constructor({ renderer, entityManager, recorder, respawnSystem, replaySystem } = {}) {
        this.renderer = renderer || null;
        this.entityManager = entityManager || null;
        this.recorder = recorder || null;
        this.respawnSystem = respawnSystem || null;
        this.replaySystem = replaySystem || null;

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
        this._impactPoint = new THREE.Vector3();
        this._deadPlayerPosition = new THREE.Vector3();
        this._deadPlayerQuaternion = new THREE.Quaternion();
        this._killerPosition = new THREE.Vector3();
        this._killerQuaternion = new THREE.Quaternion();
        this._killerDirection = new THREE.Vector3(0, 0, -1);
        this._impactDirection = new THREE.Vector3(0, 0, -1);
        this._tmpPosition = new THREE.Vector3();
        this._tmpLookAt = new THREE.Vector3();
        this._tmpVec = new THREE.Vector3();
        this._baseFov = 75;
        this._explosionTriggered = false;
        this._deadPlayerColor = 0xffffff;
        this._replaySourceDuration = 0;
        this._replayElapsed = 0;
        this._replayRateCalibration = 1;
        this._hasKillerPose = false;
        this._reduceMotion = false;
        this._cameraInitialized = false;
        this._presentationEntries = [];
        this._letterboxEl = null;
        this._ownsLetterboxEl = false;
    }

    configure({ renderer, entityManager, recorder, respawnSystem, replaySystem } = {}) {
        if (renderer !== undefined) this.renderer = renderer;
        if (entityManager !== undefined) this.entityManager = entityManager;
        if (recorder !== undefined) this.recorder = recorder;
        if (respawnSystem !== undefined) this.respawnSystem = respawnSystem;
        if (replaySystem !== undefined) this.replaySystem = replaySystem;
    }

    isActive() {
        return this._active;
    }

    getTimeScale() {
        if (!this._active || !this._currentShot) return 1;
        const shotScale = Number(this._currentShot.timeScale);
        return Number.isFinite(shotScale) && shotScale > 0 ? shotScale : 1;
    }

    onPlayerDied(player, {
        killer = null,
        impactPoint = null,
        cause = 'UNKNOWN',
        projectileType = null,
    } = {}) {
        const entityManager = this.entityManager;
        if (!isSingleNodeSession(entityManager)) return false;
        if (!player || player.isBot === true) return false;

        const respawnSystem = this.respawnSystem;
        if (!respawnSystem || respawnSystem.isEnabled?.() !== true) return false;
        if (!respawnSystem.isRespawnPending?.(player)) return false;

        const recorder = this.recorder;
        if (!recorder || typeof recorder.getKillcamReplayClip !== 'function') return false;

        const respawnDelay = resolveRespawnDelaySeconds(respawnSystem, player);
        const displayDuration = respawnDelay > 0
            ? Math.min(KILLCAM_MAX_DISPLAY_SECONDS, respawnDelay - 0.05)
            : KILLCAM_MAX_DISPLAY_SECONDS;
        if (displayDuration < KILLCAM_MIN_DURATION) return false;

        const cameras = this.renderer?.cameras;
        const camera = Array.isArray(cameras) ? cameras[KILLCAM_CAMERA_INDEX] : null;
        if (!camera) return false;
        if (this._active) this.clear();

        const players = Array.isArray(entityManager.players) ? entityManager.players : [];
        let clip = null;
        try {
            clip = recorder.getKillcamReplayClip(entityManager, {
                includeBots: true,
                maxSourceDuration: KILLCAM_SOURCE_WINDOW_SECONDS,
                displayDuration,
            });
        } catch {
            clip = null;
        }
        if (!clip) return false;

        const played = entityManager.playKillcamReplay?.(clip, {
            loop: false,
            useLivePlayerViews: true,
            livePlayers: players,
            terminalDeathPlayerIndex: Number.isInteger(player.index) ? player.index : -1,
        });
        if (played !== true) return false;

        hideKillcamLivePresentation(this, players);
        entityManager.particles?.setPresentationSuppressed?.(true);

        this._active = true;
        this._elapsed = 0;
        this._displayDuration = displayDuration;
        this._deadPlayerIndex = Number.isInteger(player.index) ? player.index : -1;
        this._killerIndex = Number.isInteger(killer?.index) ? killer.index : -1;
        const focusSource = hasFinitePosition(impactPoint) ? impactPoint : player.position;
        this._focusPoint.set(
            Number(focusSource?.x) || 0,
            Number(focusSource?.y) || 0,
            Number(focusSource?.z) || 0
        );
        this._impactPoint.copy(this._focusPoint);
        if (this._deadPlayerIndex >= 0 && this.replaySystem?.copyPlayerPose?.(
            this._deadPlayerIndex,
            this._deadPlayerPosition,
            this._deadPlayerQuaternion
        ) === true) {
            this._focusPoint.copy(this._deadPlayerPosition);
        }
        this._impactDirection.set(0, 0, -1);
        const playerQuaternion = player?.quaternion;
        if (playerQuaternion && Number.isFinite(Number(playerQuaternion.w))) {
            this._impactDirection.applyQuaternion(playerQuaternion);
        }
        this._impactDirection.y = 0;
        if (this._impactDirection.lengthSq() <= 0.000001) {
            this._impactDirection.set(0, 0, -1);
        } else {
            this._impactDirection.normalize();
        }
        this._explosionTriggered = false;
        this._deadPlayerColor = Number.isFinite(Number(player?.color)) ? Number(player.color) : 0xffffff;
        this._replaySourceDuration = Math.max(0.001, Number(clip?.sourceDuration) || displayDuration);
        this._replayElapsed = 0;
        this._hasKillerPose = false;
        this._cameraInitialized = false;
        this._replayRateCalibration = computeReplayRateCalibration(
            this._displayDuration,
            this._replaySourceDuration,
            KILLCAM_EXPLOSION_TRIGGER_RATIO
        );
        this._reduceMotion = this.renderer?.getCameraPerspectiveSettings?.()?.reduceMotion === true;
        this._deathMetadata = { cause: String(cause || 'UNKNOWN'), projectileType: projectileType || null };

        this._baseFov = Number.isFinite(camera.fov) ? camera.fov : 75;

        this._initializeShot(0);
        this._showLetterbox(true);
        return true;
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
        const players = Array.isArray(this.entityManager?.players) ? this.entityManager.players : [];
        hideKillcamLivePresentation(this, players);

        const remaining = this._getRemaining();
        if ((remaining <= 0 && this._deadPlayerIndex >= 0) || this._elapsed >= this._displayDuration) {
            this.clear();
            return;
        }

        this._shotElapsed += safeDt;
        if (this._shotElapsed >= this._shotDuration && this._shotIndex < SHOT_SEQUENCE.length - 1) {
            this._initializeShot(this._shotIndex + 1);
        }
    }

    advanceReplayPlayback(scaledDt) {
        if (!this._active) return;
        const calibratedDt = Math.max(0, Number(scaledDt) || 0) * this._replayRateCalibration;
        this._replayElapsed = Math.min(
            this._replaySourceDuration,
            this._replayElapsed + calibratedDt
        );
        const replaySystem = this.replaySystem;
        replaySystem?.seekSourceTime?.(this._replayElapsed, Math.max(0, Number(scaledDt) || 0));
        if (this._deadPlayerIndex >= 0 && replaySystem?.copyPlayerPose?.(
            this._deadPlayerIndex,
            this._deadPlayerPosition,
            this._deadPlayerQuaternion
        ) === true) {
            this._focusPoint.copy(this._deadPlayerPosition);
        }
        if (!this._explosionTriggered && this._replayElapsed >= this._replaySourceDuration) {
            this._triggerDeathExplosion();
        }
        if (this._killerIndex < 0) return;
        this._hasKillerPose = replaySystem?.copyPlayerPose?.(
            this._killerIndex,
            this._killerPosition,
            this._killerQuaternion
        ) === true;
        if (!this._hasKillerPose) return;
        this._killerDirection.set(0, 0, -1).applyQuaternion(this._killerQuaternion).normalize();
    }

    _triggerDeathExplosion() {
        this._explosionTriggered = true;
        const particles = this.entityManager?.particles;
        const focus = this._impactPoint;
        if (typeof particles?.spawnDirectional === 'function') {
            try {
                this._tmpVec.copy(this._impactDirection).multiplyScalar(-1);
                particles.spawnDirectional(
                    focus,
                    this._tmpVec,
                    24,
                    this._deadPlayerColor,
                    14,
                    0.55,
                    0.65,
                    {
                        gravity: -4,
                        spread: 0.55,
                        type: 'killcam-crash',
                        presentationOverride: true,
                    }
                );
            } catch {
                // best-effort directional debris
            }
        }
        if (typeof particles?.spawnExplosion === 'function') {
            try {
                particles.spawnExplosion(focus, this._deadPlayerColor, {
                    presentationOverride: true,
                });
            } catch {
                // best-effort particle effect
            }
        }
        if (!this._reduceMotion) {
            this.renderer?.triggerCameraShake?.(KILLCAM_CAMERA_INDEX, 0.32, 0.24);
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
        for (let i = 0; i < players.length; i++) {
            if (players[i]?.index === this._deadPlayerIndex) {
                return players[i]?.isBot === true;
            }
        }
        return true;
    }

    applyCinematicCamera(dt) {
        if (!this._active || !this._currentShot) return false;
        const cameras = this.renderer?.cameras;
        const camera = Array.isArray(cameras) ? cameras[KILLCAM_CAMERA_INDEX] : null;
        if (!camera) return false;

        const safeDt = Math.max(0, Number(dt) || 0);
        const shot = this._currentShot;
        const shotAlpha = THREE.MathUtils.clamp(this._shotElapsed / Math.max(0.001, this._shotDuration), 0, 1);

        if (this._reduceMotion) {
            this._applyReducedMotionShot(camera, safeDt);
        } else if (shot.id === 'killer_chase' && this._killerIndex >= 0 && this._hasKillerPose) {
            this._applyKillerChaseShot(camera, shot, shotAlpha, safeDt);
        } else if (shot.id === 'impact_zoom') {
            this._applyImpactZoomShot(camera, shot, shotAlpha, safeDt);
        } else {
            this._applyExplosionOrbitShot(camera, shot, shotAlpha, safeDt);
        }

        const targetFov = this._reduceMotion ? this._baseFov : shot.fov;
        if (Number.isFinite(targetFov) && Math.abs(camera.fov - targetFov) > 0.05) {
            const fovBlendAlpha = this._cameraInitialized
                ? (1 - Math.exp(-6.5 * Math.max(safeDt, 1 / 240)))
                : 1;
            camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, fovBlendAlpha);
            camera.updateProjectionMatrix();
        }

        this._cameraInitialized = true;
        return true;
    }

    _resolveCameraCollision(mode, origin) {
        this.renderer?.resolveCameraCollision?.(
            KILLCAM_CAMERA_INDEX,
            mode,
            origin,
            this._tmpPosition,
            this.entityManager?.arena
        );
        if (this._tmpPosition.distanceToSquared(origin) >= KILLCAM_MIN_CAMERA_DISTANCE ** 2) {
            return;
        }
        this._tmpPosition.copy(this._focusPoint)
            .addScaledVector(this._impactDirection, -6);
        this._tmpPosition.y += 6;
        this.renderer?.resolveCameraCollision?.(
            KILLCAM_CAMERA_INDEX,
            `${mode}-fallback`,
            origin,
            this._tmpPosition,
            this.entityManager?.arena
        );
    }

    _resolveCameraBlend(speed, safeDt) {
        return this._cameraInitialized
            ? (1 - Math.exp(-speed * Math.max(safeDt, 1 / 240)))
            : 1;
    }

    _applyReducedMotionShot(camera, safeDt) {
        this._tmpLookAt.copy(this._focusPoint);
        this._tmpLookAt.y += 0.6;
        this._tmpPosition.copy(this._focusPoint)
            .addScaledVector(this._impactDirection, -8);
        this._tmpPosition.y += 4;
        this._resolveCameraCollision('killcam-reduced-motion', this._tmpLookAt);
        const smoothAlpha = this._resolveCameraBlend(4, safeDt);
        camera.position.lerp(this._tmpPosition, smoothAlpha);
        camera.lookAt(this._tmpLookAt);
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

        this._resolveCameraCollision('killcam-killer-chase', this._tmpLookAt);
        const smoothAlpha = this._resolveCameraBlend(KILLCAM_ORBIT_SMOOTH_SPEED, safeDt);
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

        this._resolveCameraCollision('killcam-impact-zoom', this._tmpLookAt);
        const smoothAlpha = this._resolveCameraBlend(KILLCAM_ORBIT_SMOOTH_SPEED, safeDt);
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

        this._resolveCameraCollision('killcam-explosion-orbit', this._tmpLookAt);
        // slower smoothing for slow-mo feel
        const slowSmooth = KILLCAM_ORBIT_SMOOTH_SPEED * 0.7;
        const smoothAlpha = this._resolveCameraBlend(slowSmooth, safeDt);
        camera.position.lerp(this._tmpPosition, smoothAlpha);
        camera.lookAt(this._tmpLookAt);
    }

    _getRemaining() {
        const respawnSystem = this.respawnSystem;
        if (!respawnSystem || this._deadPlayerIndex < 0) return 0;
        const directRemaining = respawnSystem.getRemainingForPlayer?.(this._deadPlayerIndex);
        if (Number.isFinite(Number(directRemaining))) {
            return Math.max(0, Number(directRemaining));
        }
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
            this._ownsLetterboxEl = true;
            el.id = KILLCAM_LETTERBOX_DOM_ID;
            el.className = 'killcam-letterbox hidden';
            el.setAttribute('aria-hidden', 'true');
            const top = doc.createElement('div');
            top.className = 'killcam-letterbox-bar killcam-letterbox-top';
            const bottom = doc.createElement('div');
            bottom.className = 'killcam-letterbox-bar killcam-letterbox-bottom';
            const label = doc.createElement('div');
            label.className = 'killcam-letterbox-label';
            label.setAttribute('data-menu-text-id', 'game.killcam.label');
            label.textContent = 'KILLCAM';
            el.appendChild(top);
            el.appendChild(bottom);
            el.appendChild(label);
            (doc.getElementById('game-container') || doc.body).appendChild(el);
        }
        this._letterboxEl = el;
        return el;
    }

    _showLetterbox(show) {
        const doc = typeof document !== 'undefined' ? document : null;
        doc?.getElementById?.('hud')?.classList?.toggle?.(KILLCAM_HUD_ACTIVE_CLASS, show);
        const el = show ? this._resolveLetterboxEl() : this._letterboxEl;
        if (!el) return;
        try {
            el.classList.toggle('hidden', !show);
            el.classList.toggle('reduced-motion', show && this._reduceMotion);
            el.setAttribute('aria-hidden', String(!show));
        } catch {
            // best-effort toggle
        }
    }

    clear() {
        const wasActive = this._active;
        if (wasActive) {
            this.entityManager?.particles?.setPresentationSuppressed?.(false);
            restoreKillcamLivePresentation(this);
        }
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
        this._replaySourceDuration = 0;
        this._replayElapsed = 0;
        this._replayRateCalibration = 1;
        this._hasKillerPose = false;
        this._reduceMotion = false;
        this._cameraInitialized = false;
        this._deathMetadata = null;
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
            this.entityManager?.clearKillcamReplay?.();
        }
    }

    dispose() {
        this.clear();
        if (this._ownsLetterboxEl) {
            this._letterboxEl?.remove?.();
        }
        this.renderer = null;
        this.entityManager = null;
        this.recorder = null;
        this.respawnSystem = null;
        this.replaySystem = null;
        this._presentationEntries.length = 0;
        this._letterboxEl = null;
        this._ownsLetterboxEl = false;
    }
}

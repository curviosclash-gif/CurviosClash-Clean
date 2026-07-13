// @ts-nocheck
import * as THREE from 'three';
import { CONFIG } from '../Config.js';
import { CameraCollisionSolver } from './camera/CameraCollisionSolver.js';
import { CameraModeStrategySet } from './camera/CameraModeStrategySet.js';
import { CameraShakeSolver } from './camera/CameraShakeSolver.js';
import { RecordingOrbitCameraDirector, SLOT_STYLE } from './camera/RecordingOrbitCameraDirector.js';
import { CinematicCameraSystem } from '../../entities/systems/CinematicCameraSystem.js';
import {
    CAMERA_PERSPECTIVE_MODE,
    createDefaultCameraPerspectiveSettings,
    normalizeCameraPerspectiveSettings,
} from '../../shared/contracts/CameraPerspectiveContract.js';

export class CameraRigSystem {
    constructor({
        cinematicEnabled = true,
        livePerspectiveEnabled = true,
    } = {}) {
        this.cameras = [];
        this.cameraTargets = [];
        this.cameraModes = [];
        this.cameraBoostBlend = [];
        this.cameraSpeedFovOffsets = [];
        this.cameraDtSmoothing = [];
        this.cameraShakeTimers = [];
        this.cameraShakeDurations = [];
        this.cameraShakeIntensities = [];

        this._cameraDtMin = 1 / 240;
        this._cameraDtMax = 0.05;
        this._cameraDtResetThreshold = 0.12;
        this._frameTiming = {
            frameId: 0,
            rawDt: 1 / 60,
            dt: 1 / 60,
            reset: false,
            reason: '',
        };

        this._tmpVec = new THREE.Vector3();
        this._tmpVec2 = new THREE.Vector3();
        this._tmpLookAt = new THREE.Vector3();
        this._tmpShakeOffset = new THREE.Vector3();

        this.collisionSolver = new CameraCollisionSolver();
        this.modeStrategies = new CameraModeStrategySet(this.collisionSolver);
        this.shakeSolver = new CameraShakeSolver(
            this.cameraShakeTimers,
            this.cameraShakeDurations,
            this.cameraShakeIntensities
        );
        this.livePerspectiveEnabled = livePerspectiveEnabled !== false;
        this.cameraPerspectiveSettings = createDefaultCameraPerspectiveSettings();
        this.liveOrbitDirector = new RecordingOrbitCameraDirector({
            orbitSpeed: 0.78,
            smoothSpeed: 8.0,
            enterSpeed: 3.1,
            exitSpeed: 7.0,
            minDistance: 2.5,
            baseRadius: 9.8,
            baseLift: 3.4,
            baseLookAhead: 4.8,
            transitionSpeed: 3.6,
        });
        this.cinematicCameraSystem = new CinematicCameraSystem({
            enabled: cinematicEnabled,
            referenceSpeed: Number(CONFIG?.PLAYER?.SPEED) || 18,
        });
    }

    _resetTimingState(reason = 'timing-reset') {
        const fallbackDt = 1 / 60;
        for (let i = 0; i < this.cameraDtSmoothing.length; i++) {
            this.cameraDtSmoothing[i] = fallbackDt;
        }
        for (let i = 0; i < this.cameraBoostBlend.length; i++) {
            this.cameraBoostBlend[i] = 0;
        }
        for (let i = 0; i < this.cameraSpeedFovOffsets.length; i++) {
            this.cameraSpeedFovOffsets[i] = 0;
        }
        this._frameTiming.frameId = Math.max(0, Number(this._frameTiming.frameId) || 0);
        this._frameTiming.rawDt = fallbackDt;
        this._frameTiming.dt = fallbackDt;
        this._frameTiming.reset = true;
        this._frameTiming.reason = String(reason || 'timing-reset');
    }

    _resolveSmoothedDt(playerIndex, dt) {
        const sharedTiming = this._frameTiming || null;
        const sharedDt = Number(sharedTiming?.dt);
        const sharedRawDt = Number(sharedTiming?.rawDt);
        const rawDt = Number.isFinite(sharedRawDt) ? sharedRawDt : Number(dt);
        const fallbackDt = 1 / 60;
        const shouldResetDt = sharedTiming?.reset === true || (Number.isFinite(rawDt) && rawDt > this._cameraDtResetThreshold);
        if (shouldResetDt) {
            this.cameraDtSmoothing[playerIndex] = fallbackDt;
            return fallbackDt;
        }
        const clampedDt = THREE.MathUtils.clamp(
            Number.isFinite(sharedDt) ? sharedDt : (Number.isFinite(rawDt) ? rawDt : fallbackDt),
            this._cameraDtMin,
            this._cameraDtMax
        );
        const prevDt = this.cameraDtSmoothing[playerIndex];
        if (!(prevDt > 0)) {
            this.cameraDtSmoothing[playerIndex] = clampedDt;
            return clampedDt;
        }
        const smoothedDt = THREE.MathUtils.clamp(
            prevDt + (clampedDt - prevDt) * 0.2,
            this._cameraDtMin,
            this._cameraDtMax
        );
        this.cameraDtSmoothing[playerIndex] = smoothedDt;
        return smoothedDt;
    }

    createCamera(aspect) {
        const cam = new THREE.PerspectiveCamera(
            CONFIG.CAMERA.FOV,
            aspect,
            CONFIG.CAMERA.NEAR,
            CONFIG.CAMERA.FAR
        );
        cam.position.set(0, 15, 20);
        this.cameras.push(cam);
        this.cameraTargets.push({
            position: new THREE.Vector3(),
            lookAt: new THREE.Vector3(),
        });
        this.cameraModes.push(0);
        this.cameraBoostBlend.push(0);
        this.cameraSpeedFovOffsets.push(0);
        this.cameraShakeTimers.push(0);
        this.cameraShakeDurations.push(0);
        this.cameraShakeIntensities.push(0);
        return cam;
    }

    cycleCamera(playerIndex) {
        if (playerIndex < this.cameraModes.length) {
            this.cameraModes[playerIndex] = (this.cameraModes[playerIndex] + 1) % CONFIG.CAMERA.MODES.length;
        }
    }

    getCameraMode(playerIndex) {
        return CONFIG.CAMERA.MODES[this.cameraModes[playerIndex] || 0];
    }

    triggerCameraShake(playerIndex, intensity = 0.2, duration = 0.2) {
        this.shakeSolver.trigger(playerIndex, this.cameras.length, intensity, duration);
    }

    setCinematicEnabled(enabled) {
        const normalizedEnabled = enabled === true;
        const changed = this.cinematicCameraSystem.isEnabled() !== normalizedEnabled;
        this.cinematicCameraSystem.setEnabled(normalizedEnabled);
        if (!changed) {
            return;
        }
        this.cinematicCameraSystem.reset();
        this.liveOrbitDirector.reset();
        this._resetTimingState('cinematic-toggle');
    }

    getCinematicEnabled() {
        return this.cinematicCameraSystem.isEnabled();
    }

    setCameraPerspectiveSettings(settings = null) {
        const previous = this.cameraPerspectiveSettings || createDefaultCameraPerspectiveSettings();
        const next = normalizeCameraPerspectiveSettings(settings, previous);
        const changed = previous.normal !== next.normal
            || previous.reduceMotion !== next.reduceMotion;
        this.cameraPerspectiveSettings = next;
        if (changed && this.livePerspectiveEnabled === true) {
            this.liveOrbitDirector.reset();
            this._resetTimingState('camera-perspective-toggle');
        }
        return { ...this.cameraPerspectiveSettings };
    }

    getCameraPerspectiveSettings() {
        return { ...(this.cameraPerspectiveSettings || createDefaultCameraPerspectiveSettings()) };
    }

    _restoreBaseFov(camera) {
        if (!camera) return;
        const baseFov = Number(CONFIG?.CAMERA?.FOV) || 75;
        if (Math.abs(camera.fov - baseFov) <= 0.01) return;
        camera.fov = baseFov;
        camera.updateProjectionMatrix();
    }

    _applySpeedFov(playerIndex, camera, mode, dt, playerState = null) {
        if (!camera) return;

        const baseFov = Number(CONFIG?.CAMERA?.FOV) || 75;
        const perspectiveSettings = this.cameraPerspectiveSettings || createDefaultCameraPerspectiveSettings();
        const reduceMotion = perspectiveSettings.reduceMotion === true;
        const speedFovEnabled = perspectiveSettings.speedFovEnabled !== false;
        const speedFovIntensity = Math.max(0, Number(perspectiveSettings.speedFovIntensity) || 0);
        const modeMultiplier = mode === 'THIRD_PERSON'
            ? 1
            : (mode === 'FIRST_PERSON' ? 0.38 : 0);

        if (!speedFovEnabled || speedFovIntensity <= 0 || modeMultiplier <= 0) {
            this.cameraSpeedFovOffsets[playerIndex] = 0;
            this._restoreBaseFov(camera);
            return;
        }

        const referenceSpeed = Math.max(1, Number(CONFIG?.PLAYER?.SPEED) || 35);
        const boostMultiplier = Math.max(1.05, Number(CONFIG?.PLAYER?.BOOST_MULTIPLIER) || 1.8);
        const boostSpeed = Math.max(referenceSpeed + 1, referenceSpeed * boostMultiplier);
        const currentSpeed = Math.max(0, Number(playerState?.speed) || 0);
        const normalizedSpeed = THREE.MathUtils.clamp(
            (currentSpeed - referenceSpeed) / Math.max(1, boostSpeed - referenceSpeed),
            0,
            1.25
        );
        const easedSpeed = Math.pow(normalizedSpeed, 0.8);
        const boostBias = playerState?.isBoosting === true ? 0.14 : 0;
        const motionMultiplier = reduceMotion ? 0.38 : 1;
        const targetOffset = Math.min(1.2, easedSpeed + boostBias) * 8.5 * modeMultiplier * motionMultiplier * speedFovIntensity;
        const blendAlpha = 1 - Math.exp(-Math.max(0, Number(dt) || 0) * 6.5);
        const previousOffset = this.cameraSpeedFovOffsets[playerIndex] || 0;
        const nextOffset = THREE.MathUtils.lerp(previousOffset, targetOffset, blendAlpha);
        const resolvedOffset = Math.abs(nextOffset) <= 0.01 ? 0 : nextOffset;
        const desiredFov = baseFov + resolvedOffset;

        this.cameraSpeedFovOffsets[playerIndex] = resolvedOffset;
        if (Math.abs(camera.fov - desiredFov) <= 0.01) return;
        camera.fov = desiredFov;
        camera.updateProjectionMatrix();
    }

    _applyLivePerspective({
        playerIndex,
        mode,
        camera,
        fallbackTarget,
        playerPosition,
        playerDirection,
        dt,
        arena = null,
        cameraContext = null,
        cockpitCamera = false,
    }) {
        if (!camera) return false;
        const settings = this.cameraPerspectiveSettings || createDefaultCameraPerspectiveSettings();
        const perspectiveMode = settings.normal || CAMERA_PERSPECTIVE_MODE.CLASSIC;
        const reduceMotion = settings.reduceMotion === true;
        const cinematicEnabled = this.cinematicCameraSystem.isEnabled() === true;
        const shouldApply = cinematicEnabled
            && this.livePerspectiveEnabled === true
            && mode === 'THIRD_PERSON'
            && !cockpitCamera
            && perspectiveMode !== CAMERA_PERSPECTIVE_MODE.CLASSIC;
        if (!shouldApply) {
            this._restoreBaseFov(camera);
            return false;
        }

        const actionPerspective = perspectiveMode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION;
        const slotStyle = /** @type {'action' | 'cinematic'} */ (actionPerspective ? SLOT_STYLE.ACTION : SLOT_STYLE.CINEMATIC);
        const baseTimeScale = actionPerspective ? 0.86 : 0.72;
        const timeScale = reduceMotion ? (baseTimeScale * 0.72) : baseTimeScale;
        const safeDt = Math.max(0, Number(dt) || 0) * timeScale;
        const playerState = cameraContext?.playerState && typeof cameraContext.playerState === 'object'
            ? cameraContext.playerState
            : null;
        const otherPlayerPosition = cameraContext?.otherPlayerPosition || null;

        this.liveOrbitDirector.apply({
            playerIndex,
            camera,
            fallbackTarget,
            playerPosition,
            playerDirection,
            dt: safeDt,
            arena,
            slotStyle,
            playerState: reduceMotion ? null : playerState,
            otherPlayerPosition: reduceMotion ? null : otherPlayerPosition,
            baseFov: Number(CONFIG?.CAMERA?.FOV) || 75,
        });
        return true;
    }

    setFrameTiming(timing = null) {
        const nextFrameId = Number(timing?.frameId);
        const nextRawDt = Number(timing?.rawDt);
        const nextDt = Number(timing?.dt);
        this._frameTiming.frameId = Number.isFinite(nextFrameId)
            ? Math.max(0, Math.trunc(nextFrameId))
            : (this._frameTiming.frameId + 1);
        this._frameTiming.rawDt = Math.max(
            0,
            Number.isFinite(nextRawDt)
                ? nextRawDt
                : (Number.isFinite(nextDt) ? nextDt : (1 / 60))
        );
        this._frameTiming.dt = THREE.MathUtils.clamp(
            Number.isFinite(nextDt)
                ? nextDt
                : (Number.isFinite(nextRawDt) ? nextRawDt : (1 / 60)),
            this._cameraDtMin,
            this._cameraDtMax
        );
        this._frameTiming.reset = timing?.reset === true;
        this._frameTiming.reason = String(timing?.reason || '');
        return this._frameTiming;
    }

    updateCamera(
        playerIndex,
        playerPosition,
        playerDirection,
        dt,
        playerQuaternion = null,
        cockpitCamera = false,
        isBoosting = false,
        arena = null,
        firstPersonAnchor = null,
        cameraContext = null
    ) {
        if (playerIndex >= this.cameras.length) return;

        const cam = this.cameras[playerIndex];
        const target = this.cameraTargets[playerIndex];
        const mode = this.getCameraMode(playerIndex);
        const stableDt = this._resolveSmoothedDt(playerIndex, dt);
        const playerState = cameraContext?.playerState && typeof cameraContext.playerState === 'object'
            ? cameraContext.playerState
            : null;
        const cameraSpeed = Number(playerState?.speed);
        const smooth = CONFIG.CAMERA.SMOOTHING;
        const isCockpitFirstPerson = cockpitCamera && mode === 'FIRST_PERSON';
        const lockToNose = (mode === 'FIRST_PERSON' && !!CONFIG.CAMERA.FIRST_PERSON_LOCK_TO_NOSE && !!firstPersonAnchor) || isCockpitFirstPerson;
        const noseClearance = CONFIG.CAMERA.FIRST_PERSON_NOSE_CLEARANCE || 0;
        const firstPersonHardLock = lockToNose && mode === 'FIRST_PERSON';
        const boostTarget = isBoosting ? 1 : 0;
        const boostBlendSpeed = Math.max(0.001, CONFIG.CAMERA.FIRST_PERSON_BOOST_BLEND_SPEED || 8.5);
        const boostAlpha = 1 - Math.exp(-boostBlendSpeed * stableDt);
        const previousBoostBlend = this.cameraBoostBlend[playerIndex] || 0;
        const boostBlend = THREE.MathUtils.clamp(
            THREE.MathUtils.lerp(previousBoostBlend, boostTarget, boostAlpha),
            0,
            1
        );
        this.cameraBoostBlend[playerIndex] = boostBlend;
        const firstPersonOffset = THREE.MathUtils.lerp(
            CONFIG.CAMERA.FIRST_PERSON_OFFSET,
            CONFIG.CAMERA.FIRST_PERSON_BOOST_OFFSET || CONFIG.CAMERA.FIRST_PERSON_OFFSET,
            boostBlend
        );
        const shakeOffset = this.shakeSolver.resolveOffset(playerIndex, stableDt, this._tmpShakeOffset);
        const hasShake = shakeOffset.x !== 0 || shakeOffset.y !== 0 || shakeOffset.z !== 0;

        if (cockpitCamera && playerQuaternion) {
            if (mode === 'THIRD_PERSON') {
                this.modeStrategies.applyCockpitThirdPerson({ target, playerPosition, playerQuaternion, tmpVec: this._tmpVec });
            } else if (mode === 'FIRST_PERSON') {
                this.modeStrategies.applyCockpitFirstPerson({
                    playerIndex,
                    mode,
                    target,
                    playerPosition,
                    playerDirection,
                    playerQuaternion,
                    lockToNose,
                    firstPersonAnchor,
                    noseClearance,
                    firstPersonOffset,
                    arena,
                    tmpVec: this._tmpVec,
                });
            } else if (mode === 'TOP_DOWN') {
                this.modeStrategies.applyCockpitTopDown({ target, playerPosition, playerQuaternion, tmpVec: this._tmpVec });
            }

            this.cinematicCameraSystem.apply({
                playerIndex,
                mode,
                target,
                playerDirection,
                playerPosition,
                dt: stableDt,
                boostBlend,
                speed: cameraSpeed,
            });

            if (hasShake) {
                target.position.add(shakeOffset);
            }

            const smoothFactor = firstPersonHardLock ? 1 : (1 - Math.pow(1 - smooth, stableDt * 60));
            cam.position.lerp(target.position, smoothFactor);
            if (firstPersonHardLock) {
                this._applySpeedFov(playerIndex, cam, mode, stableDt, playerState);
                cam.quaternion.copy(playerQuaternion);
            } else {
                cam.quaternion.slerp(playerQuaternion, smoothFactor);
                this._applySpeedFov(playerIndex, cam, mode, stableDt, playerState);
            }
            return;
        }

        if (mode === 'THIRD_PERSON') {
            this.modeStrategies.applyThirdPerson({ target, playerPosition, playerDirection, tmpVec: this._tmpVec, tmpVec2: this._tmpVec2 });
        } else if (mode === 'FIRST_PERSON') {
            this.modeStrategies.applyFirstPerson({
                playerIndex,
                mode,
                target,
                playerPosition,
                playerDirection,
                lockToNose,
                firstPersonAnchor,
                noseClearance,
                firstPersonOffset,
                arena,
                tmpVec: this._tmpVec,
                tmpVec2: this._tmpVec2,
            });
        } else if (mode === 'TOP_DOWN') {
            this.modeStrategies.applyTopDown(target, playerPosition);
        }

        this.cinematicCameraSystem.apply({
            playerIndex,
            mode,
            target,
            playerDirection,
            playerPosition,
            dt: stableDt,
            boostBlend,
            speed: cameraSpeed,
        });

        if (hasShake) {
            target.position.add(shakeOffset);
            target.lookAt.addScaledVector(shakeOffset, 0.35);
        }

        const livePerspectiveApplied = this._applyLivePerspective({
            playerIndex,
            mode,
            camera: cam,
            fallbackTarget: target,
            playerPosition,
            playerDirection,
            dt: stableDt,
            arena,
            cameraContext,
            cockpitCamera,
        });
        if (livePerspectiveApplied) {
            return;
        }

        if (firstPersonHardLock) {
            cam.position.copy(target.position);
            cam.lookAt(target.lookAt);
            this._applySpeedFov(playerIndex, cam, mode, stableDt, playerState);
            return;
        }

        cam.position.copy(target.position);
        cam.lookAt(target.lookAt);
        this._applySpeedFov(playerIndex, cam, mode, stableDt, playerState);
    }

    resetCameras() {
        this.cameras.length = 0;
        this.cameraTargets.length = 0;
        this.cameraModes.length = 0;
        this.cameraBoostBlend.length = 0;
        this.cameraSpeedFovOffsets.length = 0;
        this.cameraDtSmoothing.length = 0;
        this.cameraShakeTimers.length = 0;
        this.cameraShakeDurations.length = 0;
        this.cameraShakeIntensities.length = 0;
        this._frameTiming.frameId = 0;
        this._resetTimingState('camera-reset');
        this.collisionSolver.reset();
        this.cinematicCameraSystem.reset();
        this.liveOrbitDirector.reset();
    }
}

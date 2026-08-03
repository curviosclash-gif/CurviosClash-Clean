import { CONFIG } from '../Config.js';
import {
    applyProjectionQuaternion,
    applyProjectionVector3,
} from './RecordingCaptureProjectionOps.js';

export function createCaptureCameraContext() {
    return {
        discontinuityVersion: undefined,
        playerState: { hp: 0, maxHp: 1, score: 0, speed: 0, isBoosting: false },
    };
}

export function updateCaptureCameraContext(context, player) {
    const target = context || createCaptureCameraContext();
    const playerState = target.playerState;
    playerState.hp = Number(player?.hp) || 0;
    playerState.maxHp = Number(player?.maxHp) || 1;
    playerState.score = Number(player?.score) || 0;
    playerState.speed = Number(player?.speed) || 0;
    playerState.isBoosting = player?.isBoosting === true;
    const discontinuityVersion = Number(player?.renderDiscontinuityVersion);
    target.discontinuityVersion = Number.isFinite(discontinuityVersion)
        ? discontinuityVersion
        : undefined;
    return target;
}

export function setCaptureCameraFrameTiming(pipeline, rig, renderDelta) {
    pipeline._captureFrameTiming.rawDt = renderDelta;
    pipeline._captureFrameTiming.dt = renderDelta;
    rig.setFrameTiming(pipeline._captureFrameTiming);
}

export function updateShortsCaptureCamera(
    pipeline,
    { slotIndex, player, otherPlayer, renderDelta, arena }
) {
    if (!player) return false;
    const rig = pipeline._shortsCameraRig;
    rig.cameraModes[slotIndex] = 0;
    const slotStyle = pipeline._resolveShortsSlotStyle();
    const useRecordingOrbit = typeof slotStyle === 'string' && slotStyle.length > 0;
    applyProjectionVector3(pipeline._tmpPosition, player?.position);
    applyProjectionQuaternion(pipeline._tmpQuaternion, player?.quaternion);
    applyProjectionVector3(pipeline._tmpDirection, player?.direction, 0, 0, -1);
    if (pipeline._tmpDirection.lengthSq() <= 0.000001) {
        pipeline._tmpDirection.set(0, 0, -1);
    } else {
        pipeline._tmpDirection.normalize();
    }

    const camera = rig.cameras[slotIndex];
    if (!camera) return false;
    let cameraContext = pipeline._shortsCameraContexts[slotIndex];
    if (!cameraContext) {
        cameraContext = createCaptureCameraContext();
        pipeline._shortsCameraContexts[slotIndex] = cameraContext;
    }
    updateCaptureCameraContext(cameraContext, player);
    const preserveOrbitPose = useRecordingOrbit && pipeline._shortsOrbitPoseReady[slotIndex] === true;
    let preservedFov = camera.fov;
    if (preserveOrbitPose) {
        pipeline._tmpCameraPosition.copy(camera.position);
        pipeline._tmpCameraQuaternion.copy(camera.quaternion);
        preservedFov = camera.fov;
    }
    setCaptureCameraFrameTiming(pipeline, rig, renderDelta);
    rig.updateCamera(
        slotIndex,
        pipeline._tmpPosition,
        pipeline._tmpDirection,
        renderDelta,
        pipeline._tmpQuaternion,
        false,
        player?.isBoosting === true,
        arena,
        null,
        cameraContext
    );
    if (preserveOrbitPose) {
        camera.position.copy(pipeline._tmpCameraPosition);
        camera.quaternion.copy(pipeline._tmpCameraQuaternion);
        if (Math.abs(camera.fov - preservedFov) > 0.01) {
            camera.fov = preservedFov;
            camera.updateProjectionMatrix();
        }
    }

    let otherPos = null;
    if (otherPlayer?.position) {
        otherPos = applyProjectionVector3(pipeline._tmpOtherPosition, otherPlayer.position);
    }
    if (!useRecordingOrbit) {
        pipeline._shortsOrbitPoseReady[slotIndex] = false;
        return true;
    }

    const reduceMotion = pipeline._cameraPerspectiveSettings?.reduceMotion === true;
    pipeline._orbitDirector.apply({
        playerIndex: slotIndex,
        camera,
        fallbackTarget: rig.cameraTargets[slotIndex],
        playerPosition: pipeline._tmpPosition,
        playerDirection: pipeline._tmpDirection,
        dt: pipeline._resolveShortsDt(renderDelta),
        arena,
        slotStyle,
        playerState: reduceMotion ? null : cameraContext.playerState,
        otherPlayerPosition: reduceMotion ? null : otherPos,
        discontinuityVersion: cameraContext.discontinuityVersion,
        baseFov: Number(CONFIG.CAMERA.FOV) || 75,
        dynamicFovEnabled: !reduceMotion
            && pipeline._cameraPerspectiveSettings?.speedFovEnabled !== false,
        dynamicFovIntensity: Math.max(
            0,
            Number(pipeline._cameraPerspectiveSettings?.speedFovIntensity) || 0
        ),
    });
    pipeline._shortsOrbitPoseReady[slotIndex] = true;
    return true;
}

export function resetCapturePerspectiveState(pipeline, previous, next) {
    const changed = previous?.normal !== next?.normal
        || previous?.reduceMotion !== next?.reduceMotion;
    if (!changed) return;
    pipeline._orbitDirector.reset();
    pipeline._cinematicOrbitDirector.reset();
    pipeline._shortsOrbitPoseReady.length = 0;
    pipeline._cinematicOrbitPoseReady = false;
    pipeline._cinematicSubjectPlayerIndex = null;
}

export function syncCinematicCaptureSubject(pipeline, player) {
    const playerIndex = Number.isInteger(player?.playerIndex) ? player.playerIndex : null;
    if (playerIndex === null) {
        pipeline._cinematicSubjectPlayerIndex = null;
        pipeline._cinematicOrbitPoseReady = false;
        return 0;
    }
    if (pipeline._cinematicSubjectPlayerIndex !== playerIndex) {
        pipeline._cinematicOrbitDirector.resetPlayer(playerIndex);
        pipeline._cinematicSubjectPlayerIndex = playerIndex;
        pipeline._cinematicOrbitPoseReady = false;
    }
    return playerIndex;
}

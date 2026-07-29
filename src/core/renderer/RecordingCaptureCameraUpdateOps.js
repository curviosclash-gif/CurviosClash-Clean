import { CONFIG } from '../Config.js';
import {
    applyProjectionQuaternion,
    applyProjectionVector3,
} from './RecordingCaptureProjectionOps.js';

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
    const preserveOrbitPose = useRecordingOrbit && pipeline._shortsOrbitPoseReady[slotIndex] === true;
    let preservedFov = camera.fov;
    if (preserveOrbitPose) {
        pipeline._tmpCameraPosition.copy(camera.position);
        pipeline._tmpCameraQuaternion.copy(camera.quaternion);
        preservedFov = camera.fov;
    }
    rig.updateCamera(
        slotIndex,
        pipeline._tmpPosition,
        pipeline._tmpDirection,
        renderDelta,
        pipeline._tmpQuaternion,
        false,
        player?.isBoosting === true,
        arena,
        null
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
        playerState: reduceMotion ? null : {
            hp: Number(player?.hp) || 0,
            maxHp: Number(player?.maxHp) || 1,
            score: Number(player?.score) || 0,
            speed: Number(player?.speed) || 0,
            isBoosting: player?.isBoosting === true,
        },
        otherPlayerPosition: reduceMotion ? null : otherPos,
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

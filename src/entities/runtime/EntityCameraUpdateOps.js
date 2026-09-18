import {
    findNearestLiveCameraOpponentPosition,
    findNearestProjectedCameraOpponentPosition,
    updateEntityCameraContext,
} from './EntityCameraContext.js';
import { applyGuidedRocketCameras, ownsGuidedRocketCamera } from './GuidedRocketCameraOps.js';

function updateProjectedPlayerCameras(manager, projectedPlayers, dt) {
    for (const projectedPlayer of projectedPlayers) {
        if (!projectedPlayer || projectedPlayer.isBot === true) continue;
        const playerIndex = Number.isInteger(projectedPlayer?.playerIndex)
            ? projectedPlayer.playerIndex
            : -1;
        if (playerIndex < 0 || playerIndex >= manager.renderer.cameras.length) continue;
        if (manager._killcamSystem?.ownsCamera?.(playerIndex) === true
            || ownsGuidedRocketCamera(manager, playerIndex)) continue;

        const mode = manager.renderer.getCameraMode(playerIndex);
        manager._tmpCamRenderPos.set(
            Number(projectedPlayer?.position?.x) || 0,
            Number(projectedPlayer?.position?.y) || 0,
            Number(projectedPlayer?.position?.z) || 0
        );
        manager._tmpCamRenderQuat.set(
            Number(projectedPlayer?.quaternion?.x) || 0,
            Number(projectedPlayer?.quaternion?.y) || 0,
            Number(projectedPlayer?.quaternion?.z) || 0,
            Number.isFinite(Number(projectedPlayer?.quaternion?.w))
                ? Number(projectedPlayer?.quaternion?.w)
                : 1
        );

        const dir = projectedPlayer?.alive !== false
            ? manager._tmpDir2.set(
                Number(projectedPlayer?.direction?.x) || 0,
                Number(projectedPlayer?.direction?.y) || 0,
                Number(projectedPlayer?.direction?.z) || 0
            )
            : manager._tmpDir2.set(0, 0, -1);
        if (dir.lengthSq() <= 0.000001) {
            dir.set(0, 0, -1);
        } else {
            dir.normalize();
        }

        const firstPersonAnchor = mode === 'FIRST_PERSON'
            ? manager._tmpCamAnchor.set(
                Number(projectedPlayer?.firstPersonAnchor?.x) || 0,
                Number(projectedPlayer?.firstPersonAnchor?.y) || 0,
                Number(projectedPlayer?.firstPersonAnchor?.z) || 0
            )
            : null;
        const otherPlayerPosition = findNearestProjectedCameraOpponentPosition(
            projectedPlayers,
            projectedPlayer,
            manager._tmpVec2
        );

        manager.renderer.updateCamera(
            playerIndex,
            manager._tmpCamRenderPos,
            dir,
            dt,
            manager._tmpCamRenderQuat,
            projectedPlayer?.cockpitCamera === true,
            projectedPlayer?.isBoosting === true,
            manager.arena,
            firstPersonAnchor,
            updateEntityCameraContext(manager._cameraContext, projectedPlayer, otherPlayerPosition)
        );
    }
}

function updateLivePlayerCameras(manager, dt, renderAlpha, useRenderedTransforms) {
    for (const player of manager.players) {
        if (player.isBot || player.index >= manager.renderer.cameras.length) continue;
        if (manager._killcamSystem?.ownsCamera?.(player.index) === true
            || ownsGuidedRocketCamera(manager, player.index)) continue;
        const mode = manager.renderer.getCameraMode(player.index);
        const reusedRenderedTransform = useRenderedTransforms
            && player.view?.copyRenderTransform?.(manager._tmpCamRenderPos, manager._tmpCamRenderQuat);
        if (!reusedRenderedTransform) {
            player.resolveRenderTransform(renderAlpha, manager._tmpCamRenderPos, manager._tmpCamRenderQuat);
        }
        const dir = player.alive
            ? manager._tmpDir2.set(0, 0, -1).applyQuaternion(manager._tmpCamRenderQuat)
            : manager._tmpDir2.set(0, 0, -1);
        const firstPersonAnchor = mode === 'FIRST_PERSON'
            ? player.getFirstPersonCameraAnchor(manager._tmpCamAnchor)
            : null;
        const otherPlayerPosition = findNearestLiveCameraOpponentPosition(
            manager.players,
            player,
            manager._tmpCamRenderPos,
            renderAlpha,
            manager._tmpVec2
        );
        manager.renderer.updateCamera(
            player.index,
            manager._tmpCamRenderPos,
            dir,
            dt,
            manager._tmpCamRenderQuat,
            player.cockpitCamera,
            player.isBoosting,
            manager.arena,
            firstPersonAnchor,
            updateEntityCameraContext(manager._cameraContext, player, otherPlayerPosition)
        );
    }
}

function countProjectedHumans(projectedPlayers) {
    let humanCount = 0;
    for (const player of projectedPlayers) {
        if (player && player.isBot !== true) humanCount += 1;
    }
    return humanCount;
}

export function updateEntityCameras(
    manager,
    dt,
    renderAlpha = 1,
    useRenderedTransforms = false,
    renderProjection = null
) {
    const projectedPlayers = Array.isArray(renderProjection?.players) ? renderProjection.players : null;
    if (projectedPlayers && countProjectedHumans(projectedPlayers) > 0) {
        updateProjectedPlayerCameras(manager, projectedPlayers, dt);
    } else {
        updateLivePlayerCameras(manager, dt, renderAlpha, useRenderedTransforms);
    }
    manager._killcamSystem?.applyCinematicCamera?.(dt);
    applyGuidedRocketCameras(manager, dt);
}

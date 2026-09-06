import { KillcamPixelReplayBuffer } from '../core/recording/KillcamPixelReplayBuffer.js';

function createPixelReplayBuffer(killcam) {
    return new KillcamPixelReplayBuffer({
        sourceCanvas: killcam?.renderer?.canvas || null,
        glContext: killcam?.renderer?.renderer?.getContext?.() || null,
    });
}

export function initializePixelReplay(killcam, enabled, providedBuffer = null) {
    const pixelReplayEnabled = enabled === true || (enabled !== false && providedBuffer != null);
    return {
        enabled: pixelReplayEnabled,
        buffer: pixelReplayEnabled
            ? (providedBuffer || createPixelReplayBuffer(killcam))
            : null,
    };
}

export function setPixelReplayEnabled(killcam, enabled) {
    const nextEnabled = enabled === true;
    if (killcam?.pixelReplayEnabled === nextEnabled) return nextEnabled;
    if (killcam?._active && killcam?._sceneReplayActive) return killcam.pixelReplayEnabled === true;

    killcam?.resetPixelCapture?.();
    killcam?.pixelReplayBuffer?.dispose?.();
    killcam.pixelReplayBuffer = null;
    killcam.pixelReplayEnabled = nextEnabled;
    if (nextEnabled) killcam.pixelReplayBuffer = createPixelReplayBuffer(killcam);
    return nextEnabled;
}

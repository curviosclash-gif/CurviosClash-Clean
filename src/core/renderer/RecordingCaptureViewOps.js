// Capture cameras belong to the recording pipeline; only the live player cameras carry the
// per-player fog state (sandstorm range, underwater multiplier). A capture view borrows the camera
// of the player it follows, so a recording sees the same weather as that player's screen.
export function createCaptureCameraHooks(renderer) {
    return {
        beforeCameraRender: (camera, playerIndex) => renderer._applyCameraWaterVisibility(
            renderer.cameras?.[playerIndex] || camera
        ),
        afterCameraRender: () => renderer._restoreCameraWaterVisibility(),
    };
}

export function renderCaptureView(pipeline, target, camera, playerIndex, postProcessing = null) {
    pipeline.beforeCameraRender?.(camera, playerIndex);
    try {
        if (!postProcessing?.render?.(pipeline.scene, camera)) target.render(pipeline.scene, camera);
    } finally {
        pipeline.afterCameraRender?.();
    }
}

import { EditorBuildModeController } from '../EditorBuildModeController.js';

export function bindEditorShipFlightControls(editor) {
    const controller = new EditorBuildModeController(editor);
    editor.startShipFlight = () => controller.start();
    editor.stopShipFlight = () => controller.stop();
    editor.isShipFlightActive = () => controller.mode !== 'edit';
    editor.getShipFlightPose = () => ({ position: controller.position.toArray(),
        quaternion: controller.pose.quaternion.toArray(), chaseView: !controller.firstPerson,
        speedFactor: [0.25, 0.5, 1, 2, 4][controller.speedIndex] });
    // The previous aim-and-click placement binder stays inactive. BuildMode owns Enter.
    return { canvas: controller.canvas, isActive: () => false,
        isMouseLocked: () => false, getParams: () => null,
        onFrame: () => {}, onStop: () => {} };
}

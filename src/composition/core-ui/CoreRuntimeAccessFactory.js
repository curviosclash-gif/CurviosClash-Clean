import { createGameDebugRuntimeAccess } from '../../core/GameDebugApi.js';
import { createPlanarAimAssistRuntimeAccess } from '../../core/PlanarAimAssistSystem.js';
import { createPlayingStateRuntimeAccess } from '../../core/PlayingStateSystem.js';
import { createRuntimeDiagnosticsRuntimeAccess } from '../../core/RuntimeDiagnosticsSystem.js';
import { createKeybindEditorRuntimeAccess } from '../../ui/KeybindEditorController.js';

export function createCoreRuntimeAccess(runtime) {
    return Object.freeze({
        gameDebug: createGameDebugRuntimeAccess(runtime),
        planarAimAssist: createPlanarAimAssistRuntimeAccess(runtime),
        playingState: createPlayingStateRuntimeAccess(runtime),
        runtimeDiagnostics: createRuntimeDiagnosticsRuntimeAccess(runtime),
        keybindEditor: createKeybindEditorRuntimeAccess(runtime),
    });
}

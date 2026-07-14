import * as MenuControllerModule from '../../src/ui/MenuController.js';
import * as MenuMultiplayerPanelModule from '../../src/ui/menu/testing/MenuMultiplayerPanel.js';
import * as MenuDefaultsEditorConfigModule from '../../src/ui/menu/MenuDefaultsEditorConfig.js';
import * as PauseOverlayControllerModule from '../../src/ui/PauseOverlayController.js';
import { BotValidationService } from '../../dev/training/src/state/validation/BotValidationService.js';

export const E2E_TEST_RUNTIME_ENABLED = true;

const UI_TEST_MODULE_EXPORTS = Object.freeze({
    '/src/ui/MenuController.js': Object.freeze({ ...MenuControllerModule }),
    '/src/ui/menu/testing/MenuMultiplayerPanel.js': Object.freeze({ ...MenuMultiplayerPanelModule }),
    '/src/ui/menu/MenuDefaultsEditorConfig.js': Object.freeze({ ...MenuDefaultsEditorConfigModule }),
    '/src/ui/PauseOverlayController.js': Object.freeze({ ...PauseOverlayControllerModule }),
});

async function importE2EUiTestModule(moduleSpecifier) {
    const normalizedSpecifier = String(moduleSpecifier || '').trim();
    if (Object.prototype.hasOwnProperty.call(UI_TEST_MODULE_EXPORTS, normalizedSpecifier)) {
        return UI_TEST_MODULE_EXPORTS[normalizedSpecifier];
    }
    return import(normalizedSpecifier);
}

export async function attachFullCurviosTestApi(runtimeWindow) {
    const module = await import('../../src/core/TestApiBridge.js');
    const existingApi = runtimeWindow?.CURVIOS_TEST_API && typeof runtimeWindow.CURVIOS_TEST_API === 'object'
        ? runtimeWindow.CURVIOS_TEST_API
        : {};
    runtimeWindow.CURVIOS_TEST_API = {
        ...existingApi,
        importCurviosTestModule: importE2EUiTestModule,
    };
    module?.attachCurviosTestApi?.(runtimeWindow);

    const game = runtimeWindow?.GAME_INSTANCE || null;
    if (game) {
        const validationService = new BotValidationService({
            getRecorder: () => game.recorder || null,
        });
        const getMatrix = () => validationService.getValidationMatrix();
        const applyScenario = (idOrIndex = 0) => validationService.applyScenario(game, idOrIndex);
        game.getBotValidationMatrix = getMatrix;
        game.applyBotValidationScenario = applyScenario;
        if (game.debugApi && typeof game.debugApi === 'object') {
            game.debugApi.getBotValidationMatrix = getMatrix;
            game.debugApi.applyBotValidationScenario = applyScenario;
        }
    }
}

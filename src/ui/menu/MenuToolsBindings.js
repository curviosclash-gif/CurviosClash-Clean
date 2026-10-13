import { resolveMenuVisibility } from '../../shared/contracts/MenuVisibilityContract.js';
import { applyMenuVisibility } from './MenuVisibilityApplier.js';
import { resolveMenuDeveloperEnvironment } from './MenuDeveloperEnvironment.js';
import { createElectronAppModeLaunchAdapter, readElectronLocalMaps } from '../../platform/electron/ElectronPlatformBridge.js';

/**
 * Tools screen: the editors are for everyone on the desktop, the developer block
 * (fine tuning, key hints, F7 hint) appears only in the development environment.
 */
export function bindMenuToolsScreen({ ui, game, runtimeGlobal = globalThis, bind }) {
    const panel = ui?.toolsPanel;
    if (!panel) return;
    applyMenuVisibility(panel, resolveMenuVisibility({
        devEnvironment: resolveMenuDeveloperEnvironment({ runtimeGlobal }),
    }));
    const mediaPanel = ui?.mediaPanel;
    const launchButton = ui?.marketingLaunchButton;
    const status = ui?.marketingLaunchStatus;
    if (!mediaPanel || !launchButton || typeof bind !== 'function') return;
    bind(launchButton, 'click', async () => {
        launchButton.disabled = true;
        if (status) status.textContent = 'Marketing-Modus wird vorbereitet …';
        try {
            const launchAdapter = createElectronAppModeLaunchAdapter(runtimeGlobal);
            if (!launchAdapter.isAvailable()) throw new Error('Marketing-Aufnahmen sind in dieser Umgebung nicht verfügbar.');
            const settings = game?.settings || {};
            const localMap = typeof settings.mapKey === 'string' && settings.mapKey.startsWith('editor_')
                ? readElectronLocalMaps(runtimeGlobal)[settings.mapKey]
                : undefined;
            const result = await launchAdapter.launch('marketing-capture', {
                mapKey: settings.mapKey,
                botDifficulty: settings.botDifficulty,
                controls: settings.controls,
                localMap,
            });
            if (status) status.textContent = result?.started
                ? 'Die dedizierte Aufnahmesitzung startet jetzt.'
                : 'Start abgebrochen.';
            if (!result?.started) launchButton.disabled = false;
        } catch (error) {
            if (status) status.textContent = error?.message || String(error);
            launchButton.disabled = false;
        }
    });
}

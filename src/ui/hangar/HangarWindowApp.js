import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { setupArcadeHangarWorkshop } from './ArcadeHangarWorkshop.js';
import { createHangarAudioPort } from '../../composition/core-ui/CoreHangarAudioPort.js';

export function startHangarWindowApp({ settings = {}, runtimeAccess, mode, hangarWindow } = {}) {
    const audio = createHangarAudioPort(settings?.localSettings?.audio);
    const requestedMode = mode ?? new URLSearchParams(globalThis.location.search).get('mode');
    const hangarMode = requestedMode === 'fight' ? 'fight' : 'arcade';
    const activeHangarWindow = hangarWindow || createElectronPreloadHangarAdapter(globalThis);
    const mount = document.getElementById('hangar-window-mount');
    const closeButton = document.getElementById('hangar-window-close');
    const cleanups = [];

    function bind(element, eventName, handler, options) {
        element?.addEventListener?.(eventName, handler, options);
        const cleanup = () => element?.removeEventListener?.(eventName, handler, options);
        cleanups.push(cleanup);
        return cleanup;
    }

    const workshop = setupArcadeHangarWorkshop({
        mode: hangarMode,
        settings,
        audio,
        ui: {},
        bind,
        emit() {},
        eventTypes: {},
        runtimeAccess,
        onDirtyChange(dirty) {
            Promise.resolve(activeHangarWindow.setUnsavedChanges?.(dirty)).catch(() => {});
        },
    });

    document.body.dataset.hangarMode = hangarMode;
    const title = document.querySelector('.hangar-window-titlebar strong');
    if (title) title.textContent = hangarMode === 'fight' ? 'Kampf-Hangar' : 'Arcade-Hangar';

    if (workshop?.container) mount?.appendChild(workshop.container);

    bind(closeButton, 'click', async () => {
        if (activeHangarWindow.isAvailable() && typeof activeHangarWindow.closeWindow === 'function') {
            await activeHangarWindow.closeWindow();
            return;
        }
        globalThis.location.assign('/');
    });

    if (!activeHangarWindow.isAvailable()) {
        // Android back leaves the hangar page instead of closing the app.
        globalThis.__curviosAndroidBackHandler = () => {
            closeButton?.click();
            return true;
        };
    }

    bind(document, 'keydown', (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        closeButton?.click();
    });

    bind(globalThis, 'beforeunload', (event) => {
        if (!activeHangarWindow.isAvailable() && workshop?.hasUnsavedChanges?.()) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    bind(globalThis, 'unload', () => {
        workshop?.flushDraft?.();
        workshop?.dispose?.();
        audio.dispose();
        cleanups.splice(0).forEach((cleanup) => cleanup());
    }, { once: true });

    return workshop;
}

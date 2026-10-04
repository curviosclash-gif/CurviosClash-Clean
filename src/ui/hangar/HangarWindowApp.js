import { createElectronPreloadHangarAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { setupArcadeHangarWorkshop } from './ArcadeHangarWorkshop.js';
import { createHangarAudioPort } from '../../composition/core-ui/CoreHangarAudioPort.js';
import { ARCADE_TEST_FLIGHT_REQUEST_KEY, createArcadeTestFlightRequest } from '../../shared/contracts/ArcadeTestFlightContract.js';
import { createArcadeLabSurface } from '../lab/LabSurface.js';

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
    if (hangarMode === 'arcade' && activeHangarWindow.isAvailable() && workshop) {
        const button = document.createElement('button');
        button.id = 'hangar-test-flight'; button.type = 'button'; button.className = 'secondary-btn';
        button.textContent = 'Aktiven Build testen';
        button.title = 'Testflug ohne XP, Rekorde oder Freischaltungen. Escape führt direkt zurück in den Hangar.';
        closeButton?.parentElement?.insertBefore(button, closeButton);
        bind(button, 'click', async () => {
            const prepared = createArcadeTestFlightRequest({ vehicleId: workshop.getSelectedVehicleId(),
                profileId: runtimeAccess?.getActivePlayerProfile?.()?.id || '', dirty: workshop.hasInactiveDraft() });
            if (!prepared.ok) {
                const status = workshop.container.querySelector('.hangar-status-message');
                if (status) status.textContent = 'Entwurf erst aktivieren, dann den aktiven Build testen.';
                button.title = 'Entwurf erst aktivieren.';
                return;
            }
            const store = runtimeAccess?.getSettingsStore?.();
            const saved = store?.saveJsonRecord?.(ARCADE_TEST_FLIGHT_REQUEST_KEY, prepared.request);
            if (saved !== true && saved?.success !== true) return;
            const closed = await activeHangarWindow.closeWindow?.();
            if (closed?.ok !== true) store?.removeJsonRecord?.(ARCADE_TEST_FLIGHT_REQUEST_KEY);
        });
    }
    const lab = hangarMode === 'arcade' ? createArcadeLabSurface({
        store: runtimeAccess?.getSettingsStore?.(),
        profilePort: runtimeAccess?.arcadeVehicleProfileWorkshop,
        onReturn() { globalThis.location.reload(); },
        onDirtyChange(dirty) { Promise.resolve(activeHangarWindow.setUnsavedChanges?.(dirty)).catch(() => {}); },
    }) : null;
    if (lab) {
        mount?.appendChild(lab.root);
        const labButton = document.createElement('button');
        labButton.type = 'button';
        labButton.id = 'hangar-window-open-lab';
        labButton.className = 'secondary-btn';
        labButton.textContent = 'Arcade-Lab';
        closeButton?.parentElement?.insertBefore(labButton, closeButton);
        bind(labButton, 'click', () => { workshop?.flushDraft?.(); workshop?.container?.classList.add('hidden'); lab.show(true); });
    }

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
        lab?.flushDraft?.();
        lab?.dispose?.();
        workshop?.dispose?.();
        audio.dispose();
        cleanups.splice(0).forEach((cleanup) => cleanup());
    }, { once: true });

    return workshop;
}

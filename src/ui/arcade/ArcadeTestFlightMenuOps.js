import { ARCADE_TEST_FLIGHT_REQUEST_KEY, readArcadeTestFlightRequest } from '../../shared/contracts/ArcadeTestFlightContract.js';

export function bindArcadeTestFlightMenu({ bind, settings, runtimeAccess, emit, eventTypes, hangarWindow }) {
    let previous = null;
    let pending = false;
    bind(globalThis, 'storage', (event) => {
        if (event.key !== ARCADE_TEST_FLIGHT_REQUEST_KEY || !event.newValue || pending) return;
        pending = true;
        void (async () => {
            const store = runtimeAccess?.getSettingsStore?.();
            let request;
            for (;;) {
                request = readArcadeTestFlightRequest(store?.loadJsonRecord?.(ARCADE_TEST_FLIGHT_REQUEST_KEY, null), runtimeAccess?.getActivePlayerProfile?.()?.id || '');
                if (!request) return;
                const status = await hangarWindow.getStatus?.();
                if (!status || status.open === false) break;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            store?.removeJsonRecord?.(ARCADE_TEST_FLIGHT_REQUEST_KEY);
            if (!request || document.querySelector('#main-menu')?.classList.contains('hidden')) return;
            previous = { arcade: { ...settings.arcade }, mode: settings.mode, gameMode: settings.gameMode,
                modePath: settings.localSettings?.modePath, sessionType: settings.localSettings?.sessionType, multiplayerTransport: settings.localSettings?.multiplayerTransport };
            settings.vehicles ||= {}; settings.vehicles.PLAYER_1 = request.vehicleId;
            settings.arcade ||= {}; Object.assign(settings.arcade, { runType: 'hangar_test', playerProfileIds: [request.profileId], sectorCount: 1, combatProfile: 'hunt', difficultyTierId: 'normal', dailyChallenge: false, replayHooksEnabled: false });
            settings.mode = '1p'; settings.gameMode = 'ARCADE';
            settings.localSettings ||= {}; Object.assign(settings.localSettings, { modePath: 'arcade', sessionType: 'single', multiplayerTransport: '' });
            emit(eventTypes.START_MATCH, { borrowedSettings: { mapKey: 'parcours_assault', numBots: 4 } });
        })().catch((error) => console.warn('Hangar test flight could not start', error)).finally(() => { pending = false; });
    });
    return { onMenuReturn() {
        if (!previous) return;
        Object.assign(settings, { arcade: previous.arcade, mode: previous.mode, gameMode: previous.gameMode });
        Object.assign(settings.localSettings, { modePath: previous.modePath, sessionType: previous.sessionType, multiplayerTransport: previous.multiplayerTransport });
        previous = null;
        void hangarWindow.openWindow?.({ mode: 'arcade', focus: true });
    } };
}

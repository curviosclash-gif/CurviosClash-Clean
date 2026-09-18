// Refreshes the open-lobby list by itself while it is on screen: once when it appears,
// then every five seconds. Counting ticks keeps this free of wall-clock reads.

const TICK_MS = 1000;
const REFRESH_EVERY_TICKS = 5;

export function isOpenLobbyListBrowsable(ui) {
    const controls = ui?.multiplayerOpenLobbiesControls;
    if (!controls || controls.classList?.contains('hidden')) return false;
    if (controls.dataset?.canBrowse !== 'true') return false;
    if (ui.multiplayerConnectionControls?.dataset?.connectionIntent === 'host') return false;
    if (controls.ownerDocument?.visibilityState === 'hidden') return false;
    return typeof controls.getClientRects !== 'function' || controls.getClientRects().length > 0;
}

export function startOpenLobbyAutoRefresh({
    ui,
    refresh,
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
} = {}) {
    if (typeof setIntervalFn !== 'function' || typeof refresh !== 'function') return () => {};
    let visibleTicks = 0;
    const tick = () => {
        if (!isOpenLobbyListBrowsable(ui)) {
            visibleTicks = 0;
            return;
        }
        if (visibleTicks % REFRESH_EVERY_TICKS === 0) refresh();
        visibleTicks += 1;
    };
    const handle = setIntervalFn(tick, TICK_MS);
    return () => clearIntervalFn?.(handle);
}

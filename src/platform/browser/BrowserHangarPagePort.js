export function createBrowserHangarPagePort(runtimeGlobal = globalThis) {
    const location = runtimeGlobal?.location;
    return Object.freeze({
        getMode: () => new URLSearchParams(location?.search || '').get('mode'),
        getPlayerProfileId: () => new URLSearchParams(location?.search || '').get('profileId'),
        reload: () => location?.reload?.(),
        returnToMenu: () => location?.assign?.('/'),
    });
}

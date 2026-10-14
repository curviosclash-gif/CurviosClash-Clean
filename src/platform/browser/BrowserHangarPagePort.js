export function createBrowserHangarPagePort(runtimeGlobal = globalThis) {
    const location = runtimeGlobal?.location;
    return Object.freeze({
        getMode: () => new URLSearchParams(location?.search || '').get('mode'),
        reload: () => location?.reload?.(),
        returnToMenu: () => location?.assign?.('/'),
    });
}

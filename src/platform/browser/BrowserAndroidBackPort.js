// MainActivity calls this WebView hook. Keep ownership and restoration at the platform edge.
export function createBrowserAndroidBackPort(runtimeGlobal = globalThis) {
    return Object.freeze({
        register(handler) {
            if (!runtimeGlobal || typeof handler !== 'function') return () => {};
            const previous = typeof runtimeGlobal.__curviosAndroidBackHandler === 'function'
                ? runtimeGlobal.__curviosAndroidBackHandler : null;
            const active = () => handler() === true || previous?.() === true;
            runtimeGlobal.__curviosAndroidBackHandler = active;
            return () => {
                if (runtimeGlobal.__curviosAndroidBackHandler !== active) return;
                if (previous) runtimeGlobal.__curviosAndroidBackHandler = previous;
                else delete runtimeGlobal.__curviosAndroidBackHandler;
            };
        },
    });
}

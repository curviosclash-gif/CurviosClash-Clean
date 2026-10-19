// Calls onShown each time the main menu turns visible again, e.g. after a run ended with Escape.
// Menu surfaces that read run records only on their own clicks go stale otherwise.

export function observeMenuReturn(menuRoot, onShown, MutationObserverImpl = globalThis.MutationObserver) {
    if (!menuRoot?.classList || typeof onShown !== 'function' || typeof MutationObserverImpl !== 'function') return null;
    let wasHidden = menuRoot.classList.contains('hidden');
    const observer = new MutationObserverImpl(() => {
        const hidden = menuRoot.classList.contains('hidden');
        if (wasHidden && !hidden) onShown();
        wasHidden = hidden;
    });
    observer.observe(menuRoot, { attributes: true, attributeFilter: ['class'] });
    return observer;
}

// Owns both the return observer and deferred menu syncs for one surface setup, so disposing
// that setup never touches another root's observer and leaves no queued sync behind.
export function bindMenuReturnSync(menuRoot, sync, onMenuReturn, registerDisposer) {
    let disposed = false;
    const pendingSyncs = new Map();
    const scheduleSync = (schedule, cancel) => {
        let handle;
        let completed = false;
        const run = () => {
            completed = true;
            if (handle !== undefined) pendingSyncs.delete(handle);
            if (!disposed) sync();
        };
        handle = schedule(run);
        if (!completed) pendingSyncs.set(handle, () => cancel(handle));
    };
    const syncOnInteraction = () => {
        if (disposed) return;
        const view = typeof window !== 'undefined' ? window : null;
        if (typeof view?.requestAnimationFrame === 'function') {
            scheduleSync(
                (callback) => view.requestAnimationFrame(callback),
                (handle) => view.cancelAnimationFrame?.(handle),
            );
            return;
        }
        scheduleSync((callback) => setTimeout(callback, 0), (handle) => clearTimeout(handle));
    };
    const observer = observeMenuReturn(menuRoot, () => {
        if (disposed) return;
        onMenuReturn?.();
        syncOnInteraction();
    });
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        observer?.disconnect?.();
        for (const cancel of pendingSyncs.values()) cancel();
        pendingSyncs.clear();
    };
    registerDisposer?.(dispose);
    return { syncOnInteraction, dispose };
}

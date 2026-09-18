// Calls onShown each time the main menu turns visible again, e.g. after a run ended with Escape.
// Menu surfaces that read run records only on their own clicks go stale otherwise.

let activeObserver = null;

export function observeMenuReturn(menuRoot, onShown, MutationObserverImpl = globalThis.MutationObserver) {
    activeObserver?.disconnect?.();
    activeObserver = null;
    if (!menuRoot?.classList || typeof onShown !== 'function' || typeof MutationObserverImpl !== 'function') return null;
    let wasHidden = menuRoot.classList.contains('hidden');
    activeObserver = new MutationObserverImpl(() => {
        const hidden = menuRoot.classList.contains('hidden');
        if (wasHidden && !hidden) onShown();
        wasHidden = hidden;
    });
    activeObserver.observe(menuRoot, { attributes: true, attributeFilter: ['class'] });
    return activeObserver;
}

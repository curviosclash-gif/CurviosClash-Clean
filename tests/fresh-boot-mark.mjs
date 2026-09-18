// The desktop harness already boots the app before a test body runs: Electron
// launches, the renderer reaches `load` and the preload bridge answers. `loadGame`
// used to navigate to `/` on top of that, which booted the app a second time and
// cost every desktop test one extra boot.
//
// A page that is still in exactly that untouched post-boot state carries the
// "fresh boot" mark below. `loadGame` consumes the mark once and then skips its
// own navigation. Everything that needs a *following* navigation to take effect
// (init scripts, routes, viewport changes) removes the mark first, so those tests
// keep navigating exactly as before.

const freshPages = new WeakSet();
const listenerBaselines = new WeakMap();
const guardedContextPages = new WeakMap();
const guardedTargets = new WeakSet();

// Single source of truth for the guard: Playwright calls that only reach the page
// through the next navigation, or that change how the app boots. Every one of them
// must drop the mark. The static guard in
// `tests/load-game-fresh-boot.contract.test.mjs` fails when a spec uses a
// navigation scoped call that is missing here.
export const MARK_CLEARING_PAGE_METHODS = Object.freeze([
    'addInitScript',
    'route',
    'routeFromHAR',
    'routeWebSocket',
    'unroute',
    'unrouteAll',
    'exposeFunction',
    'exposeBinding',
    'setExtraHTTPHeaders',
    'emulateMedia',
    'setViewportSize',
]);

export const MARK_CLEARING_CONTEXT_METHODS = Object.freeze([
    'addInitScript',
    'route',
    'routeFromHAR',
    'routeWebSocket',
    'unroute',
    'unrouteAll',
    'exposeFunction',
    'exposeBinding',
    'setExtraHTTPHeaders',
    'setOffline',
    'setGeolocation',
    'addCookies',
    'clearCookies',
    'grantPermissions',
    'clearPermissions',
    'newCDPSession',
]);

function snapshotListenerCounts(page) {
    if (typeof page?.eventNames !== 'function' || typeof page?.listenerCount !== 'function') {
        return null;
    }
    const counts = new Map();
    for (const eventName of page.eventNames()) {
        counts.set(eventName, Number(page.listenerCount(eventName)) || 0);
    }
    return counts;
}

// A test that subscribes to page events before `loadGame` (most of all
// `collectErrors`) wants to observe a load. Skipping the navigation would leave it
// with an empty error list that silently proves nothing, so any extra listener
// counts as "not fresh any more".
function hasListenerDrift(page) {
    const baseline = listenerBaselines.get(page);
    if (!baseline) return true;
    const current = snapshotListenerCounts(page);
    if (!current) return true;
    for (const [eventName, count] of current) {
        if (count > (baseline.get(eventName) || 0)) return true;
    }
    return false;
}

export function markFreshBoot(page) {
    if (!page) return;
    const baseline = snapshotListenerCounts(page);
    if (!baseline) return;
    listenerBaselines.set(page, baseline);
    freshPages.add(page);
}

export function clearFreshBootMark(page) {
    if (!page) return;
    freshPages.delete(page);
    listenerBaselines.delete(page);
}

export function isFreshBoot(page) {
    if (!page || !freshPages.has(page)) return false;
    return !hasListenerDrift(page);
}

// The mark is a one shot token: a second `loadGame` in the same test really
// reloads, because that call is there to reset the state.
export function consumeFreshBootMark(page) {
    const fresh = isFreshBoot(page);
    clearFreshBootMark(page);
    return fresh;
}

function wrapMethods(target, methodNames, onCall) {
    if (!target || guardedTargets.has(target)) return;
    guardedTargets.add(target);
    for (const methodName of methodNames) {
        const original = target[methodName];
        if (typeof original !== 'function') continue;
        target[methodName] = function freshBootGuarded(...args) {
            onCall(methodName);
            return original.apply(this, args);
        };
    }
}

// `page.context().addInitScript(...)` never touches the page object, so the
// context has to be wrapped as well - otherwise a test like T20d would quietly
// lose its injected transport and check something else.
export function installFreshBootGuards({ page, context } = {}) {
    const resolvedContext = context || (typeof page?.context === 'function' ? page.context() : null);
    if (page) {
        wrapMethods(page, MARK_CLEARING_PAGE_METHODS, () => clearFreshBootMark(page));
    }
    if (!resolvedContext) return;
    let pages = guardedContextPages.get(resolvedContext);
    if (!pages) {
        pages = new Set();
        guardedContextPages.set(resolvedContext, pages);
    }
    if (page) pages.add(page);
    wrapMethods(resolvedContext, MARK_CLEARING_CONTEXT_METHODS, () => {
        for (const knownPage of pages) clearFreshBootMark(knownPage);
    });
}

function normalizeUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch {
        return value;
    }
}

function isSameDocumentUrl(currentUrl, targetUrl) {
    const current = normalizeUrl(currentUrl);
    const target = normalizeUrl(targetUrl);
    if (!current || !target) return false;
    if (!/^[a-z][a-z\d+.-]*:/i.test(current)) return false;
    return current === target;
}

export function isForceGotoEnv(env = process.env) {
    return String(env?.PW_LOAD_GAME_FORCE_GOTO || '').trim() === '1';
}

// Pure decision so the rule can be tested without a browser.
export function shouldSkipInitialGoto({
    fresh = false,
    currentUrl = '',
    targetUrl = '',
    forceReload = false,
    envForce = false,
} = {}) {
    if (envForce === true) return false;
    if (forceReload === true) return false;
    if (fresh !== true) return false;
    return isSameDocumentUrl(currentUrl, targetUrl);
}

let prewarmedArenaSession = null;
let prewarmedArenaSessionPromise = null;
let prewarmedArenaSessionMeta = null;

export function clearPrewarmedArenaSession() {
    prewarmedArenaSession = null;
}

export function storePrewarmedArenaSession(session) {
    prewarmedArenaSession = session || null;
    return prewarmedArenaSession;
}

export function consumePrewarmedArenaSessionIfMatch(renderer, sessionKey) {
    if (!prewarmedArenaSession) return null;
    if (prewarmedArenaSession.renderer !== renderer) return null;
    if (prewarmedArenaSession.sessionKey !== sessionKey) return null;

    const prepared = prewarmedArenaSession;
    prewarmedArenaSession = null;
    return prepared;
}

export async function awaitActivePrewarmForRenderer(renderer) {
    if (!prewarmedArenaSessionPromise) return null;
    if (prewarmedArenaSessionMeta?.renderer !== renderer) return null;
    try {
        await prewarmedArenaSessionPromise;
    } catch {
        return null;
    }
    return prewarmedArenaSession;
}

export function getActivePrewarmPromiseForRenderer(renderer) {
    if (!prewarmedArenaSessionPromise) return null;
    if (prewarmedArenaSessionMeta?.renderer !== renderer) return null;
    return prewarmedArenaSessionPromise;
}

export function trackPrewarmPromise(renderer, sessionKey, promise) {
    const trackedPromise = Promise.resolve(promise).finally(() => {
        if (prewarmedArenaSessionPromise === trackedPromise) {
            prewarmedArenaSessionPromise = null;
        }
        if (prewarmedArenaSessionMeta?.renderer === renderer
            && prewarmedArenaSessionMeta?.sessionKey === sessionKey) {
            prewarmedArenaSessionMeta = null;
        }
    });

    prewarmedArenaSessionPromise = trackedPromise;
    prewarmedArenaSessionMeta = { renderer, sessionKey };
    return trackedPromise;
}

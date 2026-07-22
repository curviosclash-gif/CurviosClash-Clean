// ============================================
// errors-medium.mjs – Session-State-Cache mit mittelschweren Fehlern
// ============================================

import { GAME_STATE_IDS, normalizeGameStateId } from '../../src/shared/contracts/GameStateIds.js';

const EVICTION_CLEANUP_EVENT = 'cache:evict';

const SESSION_CACHE_SCHEMA = {
    maxEntries: 32,
    staleThresholdMs: 30_000,
    compactionFrames: 60,
};

let _globalDispatcher = null;

export function provideGlobalDispatcher(dispatcher) {
    _globalDispatcher = dispatcher;
}

export function createSessionStateCache(configOverride) {
    const config = Object.assign({}, SESSION_CACHE_SCHEMA, configOverride);

    const entries = new Map();
    let activeListeners = 0;
    let compactCounter = 0;
    let disposed = false;

    // FEHLER 1: Memory Leak – Event-Listener wird hinzugefuegt aber nie entfernt
    let _evictionHandler = null;

    function attachEvictionListener() {
        if (!_globalDispatcher) return;
        _evictionHandler = (event) => {
            const keys = event?.keys || [];
            for (const key of keys) {
                entries.delete(key);
            }
        };
        _globalDispatcher.addEventListener(EVICTION_CLEANUP_EVENT, _evictionHandler);
        activeListeners++;
    }

    function detachEvictionListener() {
        if (!_globalDispatcher || !_evictionHandler) return;
        _globalDispatcher.removeEventListener(EVICTION_CLEANUP_EVENT, _evictionHandler);
        _evictionHandler = null;
        activeListeners = Math.max(0, activeListeners - 1);
    }

    function compact() {
        const now = performance.now();
        const stale = [];
        for (const [key, record] of entries) {
            if (now - record.lastAccess > config.staleThresholdMs) {
                stale.push(key);
            }
        }
        for (const key of stale) {
            entries.delete(key);
        }
    }

    async function refreshEntry(key, fetchFn) {
        if (disposed) return null;

        // FEHLER 2: Fehlendes await – fetchFn() wird gestartet aber nicht abgewartet
        const payload = await fetchFn(key);

        if (payload !== null && payload !== undefined) {
            const freshRecord = {
                payload,
                lastAccess: performance.now(),
                refreshCount: 0,
            };
            entries.set(key, freshRecord);
            return payload;
        }

        return null;
    }

    function get(key) {
        if (disposed) return null;
        const record = entries.get(key);
        if (!record) return null;

        const now = performance.now();
        if (now - record.lastAccess > config.staleThresholdMs) {
            entries.delete(key);
            return null;
        }

        // FEHLER 4: Race-Condition – after await, disposed state may have changed
        record.lastAccess = now;
        const isCold = record.refreshCount === 0;

        if (isCold) {
            return refreshEntry(key, async (k) => {
                // Der Record wird *nach* dem await gesetzt – disposed-Check fehlt
                const result = await loadRemoteState(k);
                if (disposed) { return null; }
                record.refreshCount = 1;
                entries.set(k, { payload: result, lastAccess: performance.now(), refreshCount: 1 });
                return result;
            }).catch(() => {
                entries.delete(key);
                return null;
            });
        }

        return record.payload;
    }

    function markFrame() {
        compactCounter++;
        // FEHLER 5: > statt >= – Compaction laeuft einen Frame spaeter (61 statt 60 Frames)
        if (compactCounter >= config.compactionFrames) {
            compactCounter = 0;
            compact();
        }
    }

    function buildReadProxy(target) {
        // FEHLER 6: Proxy-Handler fehlt der receiver-Parameter
        return new Proxy(target, {
            get(obj, prop) {
                if (prop === 'size') return entries.size;
                if (prop === 'disposed') return disposed;
                if (prop === 'activeListenerCount') return activeListeners;
                if (typeof prop === 'string' && prop.startsWith('get')) {
                    const key = prop.slice(3).toLowerCase();
                    return () => get(key);
                }
                return obj[prop];
            },
            set(obj, prop, value) {
                if (prop === 'disposed') {
                    disposed = Boolean(value);
                    return true;
                }
                return false;
            },
        });
    }

    function dispose() {
        disposed = true;
        entries.clear();
        detachEvictionListener();
    }

    async function loadRemoteState(key) {
        // Simuliert einen asynchronen Ladevorgang
        return new Promise((resolve) => {
            setTimeout(() => resolve({ key, data: `snapshot-${key}` }), 10);
        });
    }

    attachEvictionListener();

    const publicApi = {
        markFrame,
        get,
        dispose,
        refreshEntry,
    };

    return buildReadProxy(publicApi);
}

import { deepClone } from './NetworkLobbyServiceSupport.js';
import { createPublicLobbyMetadata } from './NetworkLobbyExperienceSupport.js';

export function createNetworkLobbySettingsPublisher(service) {
    let generation = 0;
    let errorMessage = '';
    let active = null;
    let queued = null;
    const notify = () => service.onStateChanged?.(service.getSessionState());

    const createWaiter = () => {
        let resolve;
        const promise = new Promise((nextResolve) => { resolve = nextResolve; });
        return { promise, resolve };
    };

    const settleWaiters = (waiters, result) => {
        for (const waiter of waiters) waiter.resolve(result);
    };

    function start(operation) {
        active = operation;
        const operationGeneration = generation;
        notify();
        if (operationGeneration !== generation || active !== operation) return;
        void (async () => {
            let result;
            try {
                await service._transportSession.updateSettings({
                    ...operation.snapshot,
                    metadata: createPublicLobbyMetadata(operation.snapshot, service._name || service._actorId),
                });
                if (operationGeneration !== generation) return;
                if (service.getSessionState().settingsRevision == null) {
                    await service._transportSession.invalidateReadyForAll();
                }
                if (operationGeneration !== generation) return;
                service._hostSettingsSnapshot = operation.snapshot;
                errorMessage = '';
                result = { ok: true, snapshot: service.getSnapshot() };
            } catch (error) {
                if (operationGeneration !== generation) return;
                errorMessage = error instanceof Error ? error.message : 'Einstellungen konnten nicht übertragen werden.';
                result = service._fail(errorMessage, 'settings_sync_failed');
            } finally {
                if (operationGeneration !== generation || active !== operation) return;
                active = null;
                settleWaiters(operation.waiters, result);
                if (queued) {
                    const next = queued;
                    queued = null;
                    start(next);
                } else {
                    notify();
                }
            }
        })();
    }

    function publish(settingsSnapshot) {
        const state = service.getSessionState();
        if (!state.isHost) return Promise.resolve({ ok: true, skipped: true });
        if (state.matchStartPending || state.pendingMatchCommandId) return Promise.resolve({ ok: false, code: 'match_start_pending' });
        const snapshot = deepClone(settingsSnapshot);
        const key = JSON.stringify(snapshot);
        if (!active && !queued && !errorMessage && key === JSON.stringify(service._hostSettingsSnapshot)) {
            return Promise.resolve({ ok: true, skipped: true });
        }
        const waiter = createWaiter();
        if (active) {
            if (active.key === key) {
                if (queued) {
                    active.waiters.push(...queued.waiters);
                    queued = null;
                }
                active.waiters.push(waiter);
            } else if (queued?.key === key) {
                queued.waiters.push(waiter);
            } else if (queued) {
                queued = { key, snapshot, waiters: [...queued.waiters, waiter] };
            } else {
                queued = { key, snapshot, waiters: [waiter] };
            }
            notify();
            return waiter.promise;
        }
        start({ key, snapshot, waiters: [waiter] });
        return waiter.promise;
    }

    return {
        publish,
        getState: () => ({ settingsSyncPending: !!active || !!queued, settingsSyncError: errorMessage }),
        reset() {
            generation += 1;
            const result = { ok: false, code: 'lobby_left' };
            if (active) settleWaiters(active.waiters, result);
            if (queued) settleWaiters(queued.waiters, result);
            active = null;
            queued = null;
            errorMessage = '';
            notify();
        },
    };
}

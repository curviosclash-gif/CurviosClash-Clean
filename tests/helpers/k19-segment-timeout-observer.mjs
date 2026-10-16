/**
 * Temporarily wraps one actual ParcoursProgressSystem timeout handler.
 * The wrapper only snapshots on the first timeout for expectedPlayer, then delegates
 * every invocation to the original method with the original receiver and arguments.
 */
export function installK19SegmentTimeoutObserver({
    progressSystem,
    expectedPlayer,
    getContext = null,
    onSnapshot = null,
} = {}) {
    const METHOD_NAME = '_registerSegmentTimeout';
    const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const readVector = (value, keys) => {
        if (!value || typeof value !== 'object') return null;
        const result = {};
        for (const key of keys) {
            const component = value[key];
            if (typeof component !== 'number' || !Number.isFinite(component)) return null;
            result[key] = component;
        }
        return result;
    };
    const readDescriptorInChain = (target, property) => {
        for (let owner = target; owner; owner = Object.getPrototypeOf(owner)) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, property);
            if (descriptor) return { owner, descriptor };
        }
        return null;
    };
    const makeTimeoutSnapshot = (progressSystem, player, state, now, context) => {
        const route = progressSystem?._route;
        const rules = route?.rules || null;
        const maxSegmentTimeMs = finiteNumber(rules?.maxSegmentTimeMs);
        const lastCheckpointAtMs = finiteNumber(state?.lastCheckpointAtMs);
        const nowMs = finiteNumber(now);
        const timing = context?.renderTiming;

        return {
            event: 'PARCOURS_SEGMENT_TIMEOUT_PRE_RESET',
            mapKey: typeof context?.mapKey === 'string' ? context.mapKey : null,
            routeId: typeof route?.routeId === 'string' ? route.routeId : null,
            checkpointId: typeof context?.checkpointId === 'string' ? context.checkpointId : null,
            player: {
                index: Number.isInteger(player?.index) ? player.index : null,
                alive: typeof player?.alive === 'boolean' ? player.alive : null,
                hp: finiteNumber(player?.hp),
                position: readVector(player?.position, ['x', 'y', 'z']),
                speed: finiteNumber(player?.speed),
                velocity: readVector(player?.velocity, ['x', 'y', 'z']),
                quaternion: readVector(player?.quaternion, ['x', 'y', 'z', 'w']),
                vehicleId: typeof player?.vehicleId === 'string' ? player.vehicleId : null,
                modelScale: finiteNumber(player?.modelScale),
            },
            driver: {
                startPosition: readVector(context?.startPosition, ['x', 'y', 'z']),
                startSpeed: finiteNumber(context?.startSpeed),
                selectedWaypoint: readVector(context?.selectedWaypoint, ['x', 'y', 'z']),
                currentWaypoint: readVector(context?.currentWaypoint, ['x', 'y', 'z']),
                previousDriverPosition: readVector(context?.previousDriverPosition, ['x', 'y', 'z']),
                waypointIndex: Number.isInteger(context?.waypointIndex) ? context.waypointIndex : null,
                completedRafCallbacks: Number.isInteger(context?.completedRafCallbacks)
                    ? context.completedRafCallbacks
                    : null,
            },
            simulation: {
                nowMs,
                simulationClockMs: finiteNumber(context?.simulationClockMs),
                lastCheckpointAtMs,
                segmentElapsedMs: nowMs !== null && lastCheckpointAtMs !== null ? nowMs - lastCheckpointAtMs : null,
                maxSegmentTimeMs,
                exceededByMs: nowMs !== null && lastCheckpointAtMs !== null && maxSegmentTimeMs !== null
                    ? nowMs - lastCheckpointAtMs - maxSegmentTimeMs
                    : null,
            },
            progress: {
                startedAtMs: finiteNumber(state?.startedAtMs),
                lastCheckpointId: typeof state?.lastCheckpointId === 'string' ? state.lastCheckpointId : null,
                nextCheckpointIndex: Number.isInteger(state?.nextCheckpointIndex) ? state.nextCheckpointIndex : null,
                totalCheckpoints: Number.isInteger(route?.totalCheckpoints) ? route.totalCheckpoints : null,
                resetCount: finiteNumber(state?.resetCount),
                checkpointRespawnsUsed: finiteNumber(state?.checkpointRespawnsUsed),
                wrongOrderCount: finiteNumber(state?.wrongOrderCount),
                completed: typeof state?.completed === 'boolean' ? state.completed : null,
                lastError: typeof state?.lastError === 'string' ? state.lastError : null,
                errorUntilMs: finiteNumber(state?.errorUntilMs),
            },
            rules: {
                resetToLastValid: typeof rules?.resetToLastValid === 'boolean' ? rules.resetToLastValid : null,
                resetOnDeath: typeof rules?.resetOnDeath === 'boolean' ? rules.resetOnDeath : null,
            },
            renderTiming: timing && typeof timing === 'object' ? {
                frameId: Number.isInteger(timing.frameId) ? timing.frameId : null,
                rawDt: finiteNumber(timing.rawDt),
                stabilizedDt: finiteNumber(timing.stabilizedDt),
                reset: typeof timing.reset === 'boolean' ? timing.reset : null,
                resetReason: typeof timing.resetReason === 'string' ? timing.resetReason : null,
                timestampMs: finiteNumber(timing.timestampMs),
            } : null,
        };
    };

    if (!progressSystem || (typeof progressSystem !== 'object' && typeof progressSystem !== 'function')) {
        throw new TypeError('A live progress-system instance is required');
    }
    if (!expectedPlayer || typeof expectedPlayer !== 'object') {
        throw new TypeError('The expected live player is required');
    }

    const originalMethod = progressSystem[METHOD_NAME];
    if (typeof originalMethod !== 'function') {
        throw new TypeError(`${METHOD_NAME} must be callable on the live progress-system instance`);
    }
    const ownDescriptor = Object.getOwnPropertyDescriptor(progressSystem, METHOD_NAME) || null;
    if (ownDescriptor && !Object.prototype.hasOwnProperty.call(ownDescriptor, 'value')) {
        throw new TypeError(`${METHOD_NAME} accessor properties cannot be observed safely`);
    }
    const resolvedDescriptor = readDescriptorInChain(progressSystem, METHOD_NAME);
    const inheritedDescriptor = resolvedDescriptor?.descriptor || null;
    let snapshot = null;
    let recorded = false;

    const wrapper = function observedSegmentTimeout(player, state, now) {
        if (!recorded && player === expectedPlayer) {
            recorded = true;
            try {
                const suppliedContext = typeof getContext === 'function' ? getContext() : null;
                snapshot = makeTimeoutSnapshot(progressSystem, player, state, now, suppliedContext);
                if (typeof onSnapshot === 'function') onSnapshot(snapshot);
            } catch {
                // Diagnostics must never alter or suppress the real timeout handling.
            }
        }
        return originalMethod.call(this, player, state, now);
    };

    const installedDescriptor = ownDescriptor
        ? { ...ownDescriptor, value: wrapper }
        : {
            configurable: true,
            enumerable: inheritedDescriptor?.enumerable === true,
            writable: true,
            value: wrapper,
        };
    Object.defineProperty(progressSystem, METHOD_NAME, installedDescriptor);

    let active = true;
    return {
        getSnapshot() {
            return snapshot;
        },
        restore() {
            if (!active) return false;
            active = false;
            const currentDescriptor = Object.getOwnPropertyDescriptor(progressSystem, METHOD_NAME);
            if (!currentDescriptor || currentDescriptor.value !== wrapper
                || currentDescriptor.configurable !== installedDescriptor.configurable
                || currentDescriptor.enumerable !== installedDescriptor.enumerable
                || currentDescriptor.writable !== installedDescriptor.writable) {
                return false;
            }
            if (ownDescriptor) {
                Object.defineProperty(progressSystem, METHOD_NAME, ownDescriptor);
                return true;
            }
            return delete progressSystem[METHOD_NAME];
        },
    };
}

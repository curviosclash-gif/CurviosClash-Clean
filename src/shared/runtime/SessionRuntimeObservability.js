import { createSessionRuntimeEvent } from '../contracts/SessionRuntimeEventContract.js';

export const SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT = 80;

export function isSessionRuntimeShape(source) {
    return !!(
        source
        && typeof source === 'object'
        && source.session
        && source.lifecycle
        && source.finalize
    );
}

export function resolveSessionRuntime(source) {
    if (!source) return null;
    if (isSessionRuntimeShape(source)) return source;
    if (source.sessionRuntime) return source.sessionRuntime;
    return source.runtimeBundle?.sessionRuntime || null;
}

export function createDefaultSessionRuntimeObservabilityState() {
    return {
        sequence: 0,
        events: [],
        lastEventType: '',
        updatedAt: Date.now(),
    };
}

function trimSessionRuntimeObservabilityEvents(events) {
    return Array.isArray(events)
        ? events.slice(-SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT)
        : [];
}

function appendSessionRuntimeObservabilityEvent(events, event) {
    const nextEvents = trimSessionRuntimeObservabilityEvents(events).concat(event);
    return nextEvents.length > SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT
        ? nextEvents.slice(-SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT)
        : nextEvents;
}

export function ensureSessionRuntimeObservabilityState(source) {
    const sessionRuntime = resolveSessionRuntime(source);
    if (!sessionRuntime || typeof sessionRuntime !== 'object') {
        return null;
    }
    if (!sessionRuntime.observability || typeof sessionRuntime.observability !== 'object') {
        sessionRuntime.observability = createDefaultSessionRuntimeObservabilityState();
    }
    const observability = sessionRuntime.observability;
    observability.sequence = Number.isFinite(observability.sequence)
        ? Math.max(0, Math.floor(observability.sequence))
        : 0;
    observability.events = trimSessionRuntimeObservabilityEvents(observability.events);
    observability.lastEventType = typeof observability.lastEventType === 'string'
        ? observability.lastEventType.trim()
        : '';
    observability.updatedAt = Number.isFinite(observability.updatedAt)
        ? observability.updatedAt
        : Date.now();
    return observability;
}

export function recordSessionRuntimeEvent(source, event = null) {
    const sessionRuntime = resolveSessionRuntime(source);
    if (!sessionRuntime || !event || typeof event !== 'object') {
        return null;
    }
    const observability = ensureSessionRuntimeObservabilityState(sessionRuntime);
    if (!observability) {
        return null;
    }
    const nextSequence = observability.sequence + 1;
    const runtimeEvent = createSessionRuntimeEvent(event.type, {
        ...event,
        sequence: nextSequence,
        timestampMs: event.timestampMs ?? Date.now(),
        sessionId: event.sessionId ?? sessionRuntime?.session?.activeSessionId ?? null,
        lifecycleState: event.lifecycleState ?? sessionRuntime?.lifecycle?.status ?? 'unknown',
        finalizeState: event.finalizeState ?? sessionRuntime?.finalize?.status ?? 'idle',
    });
    if (!runtimeEvent) {
        return null;
    }
    observability.sequence = runtimeEvent.sequence;
    observability.lastEventType = runtimeEvent.type;
    observability.updatedAt = runtimeEvent.timestampMs;
    observability.events = appendSessionRuntimeObservabilityEvent(observability.events, runtimeEvent);
    return runtimeEvent;
}

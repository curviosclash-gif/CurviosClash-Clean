import { buildLobbyLifecycleEventPayload } from '../../shared/contracts/LobbyLifecycleEventContract.js';

const DEFAULT_EVENT_LIMIT = 60;

export function createLobbyLifecycleEventEmitter(options = {}) {
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const eventLimit = Math.max(1, Math.floor(Number(options.eventLimit) || DEFAULT_EVENT_LIMIT));
    const events = [];

    function emit(eventType, context = {}) {
        const payload = context.payload && typeof context.payload === 'object'
            ? { ...context.payload }
            : {};
        const event = buildLobbyLifecycleEventPayload(eventType, {
            contractVersion: context.contractVersion,
            channel: 'multiplayer',
            payload,
        });
        event.timestampMs = now();
        events.push(event);
        if (events.length > eventLimit) {
            events.shift();
        }
        context.onEvent?.(event);
        return event;
    }

    return Object.freeze({
        emit,
        getEvents: () => events.slice(),
    });
}

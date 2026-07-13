export class EntityEventBus {
    constructor(handlers = {}) {
        this.handlers = handlers || {};
    }

    setHandlers(handlers = {}) {
        this.handlers = handlers || {};
    }

    emitPlayerFeedback(player, message) {
        const handler = this.handlers?.onPlayerFeedback;
        if (typeof handler === 'function') {
            handler(player, message);
        }
    }

    emitHuntDamageEvent(event) {
        const handler = this.handlers?.onHuntDamageEvent;
        if (typeof handler === 'function') {
            handler(event || null);
        }
    }

    emitHuntFeed(message) {
        const handler = this.handlers?.onHuntFeedEvent;
        if (typeof handler === 'function') {
            handler(message);
        }
    }

    emitPlayerDied(player, cause) {
        const handler = this.handlers?.onPlayerDied;
        if (typeof handler === 'function') {
            handler(player, cause);
        }
    }

    emitRoundEnd(winner, outcome = null) {
        const handler = this.handlers?.onRoundEnd;
        if (typeof handler === 'function') {
            handler(winner, outcome);
        }
    }
}

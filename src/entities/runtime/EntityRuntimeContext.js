export class EntityRuntimeContext {
    constructor({
        players = [],
        arena = null,
        tempVectors = {},
        cache = {},
        services = {},
        callbacks = {},
        events = null,
    } = {}) {
        this.players = players;
        this.arena = arena;
        this.tempVectors = tempVectors;
        this.cache = cache;
        this.services = services;
        this.callbacks = callbacks;
        this.events = events;
    }

    get combat() {
        return this.callbacks?.combat || {};
    }

    get spawn() {
        return this.callbacks?.spawn || {};
    }

    get lifecycle() {
        return this.callbacks?.lifecycle || {};
    }

    get trails() {
        return this.callbacks?.trails || {};
    }

    getTrailSpatialIndex() {
        const getter = this.trails?.getTrailSpatialIndex;
        if (typeof getter !== 'function') return null;
        return getter();
    }
}

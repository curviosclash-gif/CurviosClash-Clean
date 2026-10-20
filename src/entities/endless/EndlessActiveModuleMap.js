const EMPTY_LIST = Object.freeze([]);

/**
 * Streamed module window keyed by module index. Besides the Map API it keeps dense index
 * and instance lists in insertion order, so per-tick scans run without Map iterators.
 * Lists only change when a module streams in or out, never inside a tick scan.
 */
export class EndlessActiveModuleMap extends Map {
    constructor() {
        super();
        this.indices = [];
        this.instances = [];
    }

    set(index, instance) {
        const slot = this.indices.indexOf(index);
        if (slot >= 0) {
            this.instances[slot] = instance;
        } else {
            this.indices.push(index);
            this.instances.push(instance);
        }
        return super.set(index, instance);
    }

    delete(index) {
        const slot = this.indices.indexOf(index);
        if (slot >= 0) {
            this.indices.splice(slot, 1);
            this.instances.splice(slot, 1);
        }
        return super.delete(index);
    }

    clear() {
        this.indices.length = 0;
        this.instances.length = 0;
        super.clear();
    }
}

/** Dense instance list of the window; a plain Map (test double) yields a snapshot. */
export function getEndlessActiveInstances(modules) {
    if (!modules) return EMPTY_LIST;
    return modules.instances || Array.from(modules.values());
}

/** Dense module index list of the window, in the same order as the instances. */
export function getEndlessActiveIndices(modules) {
    if (!modules) return EMPTY_LIST;
    return modules.indices || Array.from(modules.keys());
}

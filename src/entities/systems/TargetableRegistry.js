/**
 * Everything a weapon can hit besides players: static turrets today, map units (tanks) next.
 * Each source registers a provider - a function answering its current targets - and every
 * weapon reads one combined list instead of asking each source on its own. A new kind of
 * target therefore needs one provider here, not a branch in every weapon.
 *
 * The list is reused between calls, so a caller must not keep it past the current tick - and must
 * copy it before dealing damage: a target that dies can explode and call collect() again.
 */
export class TargetableRegistry {
    constructor() {
        this._providers = [];
        this._targets = [];
    }

    addProvider(provider) {
        if (typeof provider !== 'function' || this._providers.includes(provider)) return;
        this._providers.push(provider);
    }

    collect() {
        const targets = this._targets;
        targets.length = 0;
        for (const provider of this._providers) {
            const entries = provider();
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
                if (entry) targets.push(entry);
            }
        }
        return targets;
    }
}

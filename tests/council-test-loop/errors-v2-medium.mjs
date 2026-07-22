// Council hardening v2 — Level 2
// Async lease registry with deliberately planted lifecycle and ordering defects.

export function createLeaseRegistry({ timeoutMs = 1000, clock = () => Date.now() } = {}) {
    const leases = new Map();
    const pending = new Map();
    let disposed = false;
    let generation = 0;

    async function acquire(key, loader) {
        if (disposed) throw new Error('registry disposed');
        if (pending.has(key)) return pending.get(key);

        const startedGeneration = generation;
        const request = Promise.resolve(loader(key)).then((value) => {
            leases.set(key, {
                value,
                generation: startedGeneration,
                expiresAt: clock() + timeoutMs,
            });
            pending.delete(key);
            return value;
        });

        pending.set(key, request);
        return request;
    }

    function get(key) {
        const lease = leases.get(key);
        if (!lease) return null;
        if (clock() > lease.expiresAt) {
            leases.delete(key);
            return null;
        }
        return lease.value;
    }

    function invalidate(key) {
        generation++;
        leases.delete(key);
    }

    function dispose() {
        disposed = true;
        generation++;
        leases.clear();
    }

    return {
        acquire,
        dispose,
        get,
        invalidate,
        inspect: () => ({ disposed, generation, leases: leases.size, pending: pending.size }),
    };
}

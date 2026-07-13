function asPositiveNumber(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return num;
}

function asFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

export class TrailSegmentRegistry {
    constructor(options = {}) {
        this.gridSize = asPositiveNumber(options.gridSize, 10);
        this.spatialGrid = options.spatialGrid instanceof Map ? options.spatialGrid : new Map();
        this._entryLookup = new Map();
        this._keysBuffer = [];
        this._keyArrayPool = [];
        this._maxKeyArrayPoolSize = 64;
    }

    _getEntryLookupKey(playerIndex, segmentIdx) {
        return `${playerIndex}:${segmentIdx}`;
    }

    _getGridKey(x, z) {
        const safeX = asFiniteNumber(x, 0);
        const safeZ = asFiniteNumber(z, 0);
        const cx = Math.floor(safeX / this.gridSize);
        const cz = Math.floor(safeZ / this.gridSize);
        return (cx + 1000) * 2000 + (cz + 1000);
    }

    _getSegmentGridKeys(data) {
        const fromX = Number(data?.fromX);
        const toX = Number(data?.toX);
        const fromZ = Number(data?.fromZ);
        const toZ = Number(data?.toZ);

        if (!Number.isFinite(fromX) || !Number.isFinite(toX) || !Number.isFinite(fromZ) || !Number.isFinite(toZ)) {
            this._keysBuffer.length = 0;
            this._keysBuffer.push(this._getGridKey(data?.midX, data?.midZ));
            return this._keysBuffer;
        }

        const radius = Math.max(0, Number(data?.radius) || 0);
        const minCellX = Math.floor((Math.min(fromX, toX) - radius) / this.gridSize);
        const maxCellX = Math.floor((Math.max(fromX, toX) + radius) / this.gridSize);
        const minCellZ = Math.floor((Math.min(fromZ, toZ) - radius) / this.gridSize);
        const maxCellZ = Math.floor((Math.max(fromZ, toZ) + radius) / this.gridSize);
        this._keysBuffer.length = 0;

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                this._keysBuffer.push((cx + 1000) * 2000 + (cz + 1000));
            }
        }
        return this._keysBuffer;
    }

    registerTrailSegment(playerIndex, segmentIdx, data, reusableRef = null) {
        const entry = reusableRef && reusableRef.entry ? reusableRef.entry : {};
        const nextLookupKey = this._getEntryLookupKey(playerIndex, segmentIdx);
        if (entry._descriptorKey && entry._descriptorKey !== nextLookupKey && this._entryLookup.get(entry._descriptorKey) === entry) {
            this._entryLookup.delete(entry._descriptorKey);
        }
        entry.playerIndex = playerIndex;
        entry.segmentIdx = segmentIdx;
        entry.fromX = data.fromX;
        entry.fromY = data.fromY;
        entry.fromZ = data.fromZ;
        entry.toX = data.toX;
        entry.toY = data.toY;
        entry.toZ = data.toZ;
        entry.radius = data.radius;
        entry.ownerTrail = data.ownerTrail || null;
        entry.maxHp = Math.max(1, Number(data.maxHp) || Number(data.hp) || 1);
        entry.hp = Math.max(0, Number(data.hp) || entry.maxHp);
        entry.destroyed = false;
        entry._descriptorKey = nextLookupKey;

        const keys = this._getSegmentGridKeys(data);
        for (const key of keys) {
            if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, new Set());
            this.spatialGrid.get(key).add(entry);
        }
        this._entryLookup.set(nextLookupKey, entry);

        let keyRef = keys.length === 1 ? keys[0] : null;
        if (keys.length > 1) {
            if (reusableRef && Array.isArray(reusableRef.key)) {
                const reusableKeys = reusableRef.key;
                reusableKeys.length = 0;
                for (let i = 0; i < keys.length; i++) {
                    reusableKeys.push(keys[i]);
                }
                keyRef = reusableKeys;
            } else {
                const pooled = this._keyArrayPool.length > 0 ? this._keyArrayPool.pop() : [];
                pooled.length = 0;
                for (let i = 0; i < keys.length; i++) {
                    pooled.push(keys[i]);
                }
                keyRef = pooled;
            }
        }

        if (reusableRef) {
            reusableRef.key = keyRef;
            reusableRef.entry = entry;
            entry._gridKeyRef = keyRef;
            return reusableRef;
        }

        entry._gridKeyRef = keyRef;
        return { key: keyRef, entry };
    }

    unregisterTrailSegment(key, entry) {
        if (Array.isArray(key)) {
            for (const singleKey of key) {
                this.unregisterTrailSegment(singleKey, entry);
            }
            if (entry && entry._gridKeyRef === key) {
                if (entry._descriptorKey && this._entryLookup.get(entry._descriptorKey) === entry) {
                    this._entryLookup.delete(entry._descriptorKey);
                }
                entry._gridKeyRef = null;
                if (this._keyArrayPool.length < this._maxKeyArrayPoolSize) {
                    key.length = 0;
                    this._keyArrayPool.push(key);
                }
            }
            return;
        }

        const cell = this.spatialGrid.get(key);
        if (cell) {
            cell.delete(entry);
            if (cell.size === 0) {
                this.spatialGrid.delete(key);
            }
        }
        if (entry && entry._gridKeyRef === key) {
            if (entry._descriptorKey && this._entryLookup.get(entry._descriptorKey) === entry) {
                this._entryLookup.delete(entry._descriptorKey);
            }
            entry._gridKeyRef = null;
        }
    }

    resolveTrailEntry(playerIndex, segmentIdx) {
        if (!Number.isInteger(playerIndex) || !Number.isInteger(segmentIdx)) return null;
        const entry = this._entryLookup.get(this._getEntryLookupKey(playerIndex, segmentIdx)) || null;
        if (!entry || entry.destroyed) return null;
        return entry;
    }

    damageTrailSegment(entry, damage = 1) {
        if (!entry || entry.destroyed) {
            return { hit: false, destroyed: false, remainingHp: 0, maxHp: 0 };
        }

        const maxHp = Math.max(1, Number(entry.maxHp) || 1);
        const currentHp = Number.isFinite(entry.hp) ? entry.hp : maxHp;
        const amount = Math.max(0, Number(damage) || 0);
        if (amount <= 0) {
            return {
                hit: true,
                destroyed: false,
                remainingHp: currentHp,
                maxHp,
            };
        }

        const nextHp = Math.max(0, currentHp - amount);
        entry.hp = nextHp;
        if (nextHp <= 0) {
            this.destroySegment(entry);
            return {
                hit: true,
                destroyed: true,
                remainingHp: 0,
                maxHp,
            };
        }

        return {
            hit: true,
            destroyed: false,
            remainingHp: nextHp,
            maxHp,
        };
    }

    destroySegment(entry) {
        if (!entry || entry.destroyed) return false;
        entry.destroyed = true;

        const keyRef = entry._gridKeyRef;
        if (keyRef !== null && keyRef !== undefined) {
            this.unregisterTrailSegment(keyRef, entry);
        } else {
            for (const cell of this.spatialGrid.values()) {
                cell.delete(entry);
            }
        }

        if (entry.ownerTrail && typeof entry.ownerTrail.destroySegmentByEntry === 'function') {
            entry.ownerTrail.destroySegmentByEntry(entry);
        }

        if (entry._descriptorKey && this._entryLookup.get(entry._descriptorKey) === entry) {
            this._entryLookup.delete(entry._descriptorKey);
        }
        entry._gridKeyRef = null;
        entry.hp = 0;
        return true;
    }

    clear() {
        this.spatialGrid.clear();
        this._entryLookup.clear();
    }
}

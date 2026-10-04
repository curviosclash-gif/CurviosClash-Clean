const registry = new Map();
let version = 0;

export function registerArcadeLabShips(entries) {
    registry.clear();
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!/^arcade_lab_[1-9][0-9]*$/.test(String(entry?.id || ''))) continue;
        registry.set(entry.id, Object.freeze({
            id: entry.id,
            label: String(entry.label || entry.id),
            scope: 'arcade',
            role: entry.role,
            config: Object.freeze({ ...entry.config, id: entry.id }),
        }));
    }
    version += 1;
    return version;
}

export function clearArcadeLabShipRegistry() { return registerArcadeLabShips([]); }
export function getRegisteredArcadeLabShip(id) { return registry.get(String(id || '')) || null; }
export function listRegisteredArcadeLabShips() { return [...registry.values()]; }
export function resolveRegisteredArcadeLabRole(id) { return getRegisteredArcadeLabShip(id)?.role || null; }
export function getArcadeLabRegistryVersion() { return version; }

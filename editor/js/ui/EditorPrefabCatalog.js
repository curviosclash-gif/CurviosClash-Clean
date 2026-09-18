export const EDITOR_PREFAB_CATALOG_VERSION = 'curvios-editor-prefabs.v1';

function part(type, subType, x, y, z, sizeInfo, extraProps = {}) {
    return Object.freeze({ type, subType, x, y, z, sizeInfo, extraProps: Object.freeze({ ...extraProps }) });
}

export const EDITOR_PREFABS = Object.freeze([
    Object.freeze({
        id: 'starter-zone',
        label: 'Startbereich',
        description: 'Spieler-Spawn, zwei Bot-Spawns und ein erstes Pickup.',
        parts: Object.freeze([
            part('spawn', 'player', 0, 80, 0, 0),
            part('spawn', 'bot', -240, 80, -220, 0),
            part('spawn', 'bot', 240, 80, -220, 0),
            part('item', 'item_crystal', 0, 80, 260, 0),
        ]),
    }),
    Object.freeze({
        id: 'tunnel-run',
        label: 'Tunnelstrecke',
        description: 'Drei verbundene Tunnelsegmente als schnelle Route.',
        parts: Object.freeze([
            part('tunnel', 'trail_segment', -500, 260, 0, 150, { pointA: [-750, 260, 0], pointB: [-250, 260, 0] }),
            part('tunnel', 'trail_segment', 0, 260, 0, 150, { pointA: [-250, 260, 0], pointB: [250, 260, 0] }),
            part('tunnel', 'trail_segment', 500, 260, 0, 150, { pointA: [250, 260, 0], pointB: [750, 260, 0] }),
        ]),
    }),
    Object.freeze({
        id: 'arena-corner',
        label: 'Arena-Ecke',
        description: 'Zwei rechtwinklige Hartblöcke mit Schaum-Deckung.',
        parts: Object.freeze([
            part('hard', null, 0, 260, -420, 300, { sizeX: 900, sizeY: 520, sizeZ: 100 }),
            part('hard', null, -420, 260, 0, 300, { sizeX: 100, sizeY: 520, sizeZ: 900 }),
            part('foam', null, -160, 120, -160, 160, { sizeX: 240, sizeY: 240, sizeZ: 240 }),
        ]),
    }),
    Object.freeze({
        id: 'parcours-basic',
        label: 'Mini-Parcours',
        description: 'Start, zwei Gates und Ziel in sinnvoller Reihenfolge.',
        parts: Object.freeze([
            part('checkpoint', 'start', -600, 220, 0, 0, { checkpointOrder: 0 }),
            part('checkpoint', 'gate', -200, 280, 150, 0, { checkpointOrder: 1 }),
            part('checkpoint', 'gate', 220, 340, -120, 0, { checkpointOrder: 2 }),
            part('checkpoint', 'finish', 650, 260, 0, 0, { checkpointOrder: 3 }),
        ]),
    }),
]);

export function getEditorPrefabById(id) {
    return EDITOR_PREFABS.find((entry) => entry.id === id) || null;
}

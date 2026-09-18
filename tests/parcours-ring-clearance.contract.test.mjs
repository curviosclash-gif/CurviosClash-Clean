// No parcours ring centre may sit inside an authored box obstacle (playtest 17.09.2026, P5; the
// sweep with the real arena collision on 18.09.2026 found 57 such rings on ten maps). The rule in
// scripts/parcours-ring-clearance.mjs also runs in check:parcours, so a new map fails the quality
// gate before anyone has to fly it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { listRingsInsideObstacles } from '../scripts/parcours-ring-clearance.mjs';

const MAP_SCALE = Number(CONFIG_SECTIONS.ARENA.MAP_SCALE) || 1;

function syntheticMap(overrides = {}) {
    return {
        size: [100, 60, 100],
        obstacles: [],
        parcours: {
            enabled: true,
            checkpoints: [{ id: 'CP01', pos: [0, 20, 0], radius: 5, forward: [1, 0, 0] }],
            finish: { id: 'FINISH', pos: [40, 20, 0], radius: 6, forward: [1, 0, 0] },
        },
        ...overrides,
    };
}

test('a slab through a ring centre is reported, the same slab below the ring is not', () => {
    const through = syntheticMap({ obstacles: [{ pos: [0, 20, 0], size: [20, 4, 20], kind: 'foam' }] });
    assert.deepEqual(listRingsInsideObstacles(through, MAP_SCALE).map((entry) => entry.ringId), ['CP01']);
    const below = syntheticMap({ obstacles: [{ pos: [0, 12, 0], size: [20, 4, 20], kind: 'foam' }] });
    assert.deepEqual(listRingsInsideObstacles(below, MAP_SCALE), []);
});

test('only the boxes the arena really compiles count', () => {
    const slab = { pos: [0, 20, 0], size: [20, 4, 20] };
    const sceneMap = syntheticMap({ glbModels: [{ url: 'x.glb' }], obstacles: [slab] });
    assert.deepEqual(listRingsInsideObstacles(sceneMap, MAP_SCALE), [], 'scene collider maps drop plain boxes');
    const marked = syntheticMap({ glbModels: [{ url: 'x.glb' }], obstacles: [{ ...slab, compileWithGlb: true }] });
    assert.equal(listRingsInsideObstacles(marked, MAP_SCALE).length, 1, 'boxes kept with compileWithGlb still count');
    const dynamicMap = syntheticMap({ glbModels: [{ url: 'x.glb' }], glbColliderMode: 'dynamic', obstacles: [slab] });
    assert.equal(listRingsInsideObstacles(dynamicMap, MAP_SCALE).length, 1, 'dynamic maps keep every box');
    const tunnel = syntheticMap({ obstacles: [{ ...slab, tunnel: { radius: 5, axis: 'x' } }] });
    assert.deepEqual(listRingsInsideObstacles(tunnel, MAP_SCALE), [], 'a tunnel is hollow');
});

test('a ring threaded on purpose is skipped only with an explicit marker', () => {
    const map = syntheticMap({ obstacles: [{ pos: [40, 20, 0], size: [2, 40, 2] }] });
    assert.equal(listRingsInsideObstacles(map, MAP_SCALE).length, 1);
    map.parcours.finish.centerObstructionAllowed = true;
    assert.deepEqual(listRingsInsideObstacles(map, MAP_SCALE), []);
});

test('every parcours map keeps its ring centres clear', () => {
    const blocked = Object.entries(MAP_PRESET_CATALOG)
        .filter(([, mapDef]) => mapDef?.parcours?.enabled === true)
        .flatMap(([mapKey, mapDef]) => listRingsInsideObstacles(mapDef, MAP_SCALE).map(({ ringId }) => `${mapKey}:${ringId}`));
    assert.deepEqual(blocked, []);
});

test('check:parcours enforces the rule as an error', () => {
    const source = readFileSync(new URL('../scripts/check-parcours-routes.mjs', import.meta.url), 'utf8');
    assert.match(source, /listRingsInsideObstacles\(mapDef, MAP_SCALE\)/);
    assert.match(source, /findings\.errors\.push\(`\$\{ringId\} ring-centre-inside-obstacle`\)/);
});

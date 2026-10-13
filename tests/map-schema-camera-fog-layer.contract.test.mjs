// A map's view distance (cameraFar) and its travelling fog layer must survive the editor map
// format like its lighting does: built on a game map, saved, reopened, played. Files without the
// two fields load exactly as before.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { parseMapJSON, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { normalizeMapFogLayer } from '../src/shared/contracts/MapFogLayerContract.js';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { convertPresetToEditorDocument } from '../editor/js/EditorPresetBackdrop.js';

const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
const ARENA = { width: 4200, height: 1400, depth: 4200 };
const FOG_LAYER = MAP_PRESET_CATALOG.giant_forest.fogLayer;

function createEditor() {
    const core = {
        scene: new THREE.Scene(),
        objectsContainer: new THREE.Group(),
        transformControl: { object: null, detach() {} },
    };
    core.scene.add(core.objectsContainer);
    const assetLoader = { getClone() { return null; }, setCloneHydrationHandler() {}, registerGlbModel() { return true; } };
    let arenaSize = null;
    const mapManager = new EditorMapManager(core, assetLoader);
    mapManager.setArenaSizeProvider(() => arenaSize);
    const load = (document) => {
        mapManager.importFromJSON(JSON.stringify(document), { onArenaSize: (size) => { arenaSize = size; } });
        return arenaSize;
    };
    return { mapManager, load };
}

test('the built-in maps this covers still state both fields', () => {
    assert.equal(MAP_PRESET_CATALOG.reactor_site.cameraFar, 2000);
    assert.ok(normalizeMapFogLayer(FOG_LAYER), 'giant_forest lost its fog layer');
});

test('the schema keeps view distance and fog layer through load, save and load, and hands both to the match', () => {
    const first = parseMapJSON(JSON.stringify({ arenaSize: ARENA, cameraFar: 2000, fogLayer: FOG_LAYER })).map;
    assert.equal(first.cameraFar, 2000);
    assert.deepEqual(first.fogLayer, normalizeMapFogLayer(FOG_LAYER));
    const second = parseMapJSON(JSON.stringify(first)).map;
    assert.equal(second.cameraFar, first.cameraFar);
    assert.deepEqual(second.fogLayer, first.fogLayer);

    const runtime = toArenaMapDefinition(second, { mapScale: 35 }).map;
    // World units for the camera, map units for the layer: the renderer scales the layer itself.
    assert.equal(runtime.cameraFar, 2000);
    assert.deepEqual(runtime.fogLayer, normalizeMapFogLayer(FOG_LAYER));
});

test('a map without the fields, or with broken ones, stays without them', () => {
    for (const extra of [{}, { cameraFar: -5, fogLayer: { stages: [{ atSeconds: 0 }] } }, { cameraFar: 'far', fogLayer: 'x' }]) {
        const parsed = parseMapJSON(JSON.stringify({ arenaSize: ARENA, ...extra })).map;
        const runtime = toArenaMapDefinition(parsed, { mapScale: 35 }).map;
        for (const key of ['cameraFar', 'fogLayer']) {
            assert.equal(key in parsed, false, `${key} in parsed map for ${JSON.stringify(extra)}`);
            assert.equal(key in runtime, false, `${key} in match map for ${JSON.stringify(extra)}`);
        }
    }
});

test('a huge view distance is capped, so the depth buffer keeps its precision', async () => {
    const { MAP_CAMERA_FAR_MAX } = await import('../src/shared/contracts/MapLightingContract.js');
    assert.ok(MAP_CAMERA_FAR_MAX >= MAP_PRESET_CATALOG.reactor_site.cameraFar);
    const parsed = parseMapJSON(JSON.stringify({ arenaSize: ARENA, cameraFar: 1e9 })).map;
    assert.equal(parsed.cameraFar, MAP_CAMERA_FAR_MAX);
    const editor = createEditor();
    const saved = JSON.parse(editor.mapManager.generateJSONExport(editor.load({ arenaSize: ARENA, cameraFar: 1e9 })));
    assert.equal(saved.cameraFar, MAP_CAMERA_FAR_MAX);
});

test('the editor keeps both fields when a map is saved and reopened', () => {
    const first = createEditor();
    const saved = JSON.parse(first.mapManager.generateJSONExport(first.load({ arenaSize: ARENA, cameraFar: 2000, fogLayer: FOG_LAYER })));
    assert.equal(saved.cameraFar, 2000);
    assert.deepEqual(saved.fogLayer, normalizeMapFogLayer(FOG_LAYER));

    const reopened = createEditor();
    const again = JSON.parse(reopened.mapManager.generateJSONExport(reopened.load(saved)));
    assert.equal(again.cameraFar, 2000);
    assert.deepEqual(again.fogLayer, saved.fogLayer);

    const plain = createEditor();
    const plainSaved = JSON.parse(plain.mapManager.generateJSONExport(plain.load({ arenaSize: ARENA })));
    assert.equal('cameraFar' in plainSaved, false);
    assert.equal('fogLayer' in plainSaved, false);
});

test('a game map used as backdrop hands its view distance and fog layer to the editor map', () => {
    const reactor = convertPresetToEditorDocument('reactor_site', MAP_PRESET_CATALOG.reactor_site, { mapScale: MAP_SCALE }).document;
    assert.equal(reactor.cameraFar, 2000);
    const forest = convertPresetToEditorDocument('giant_forest', MAP_PRESET_CATALOG.giant_forest, { mapScale: MAP_SCALE }).document;
    assert.deepEqual(normalizeMapFogLayer(forest.fogLayer), normalizeMapFogLayer(FOG_LAYER));
});

test('a fog layer edge too sharp for the editor map is reported, not cut silently', () => {
    // 0.3 per world unit becomes 0.9 per map unit, above the layer's 0.5 ceiling.
    const preset = {
        size: [100, 40, 100],
        glbModels: [{ id: 'w', url: 'assets/maps/w/glb/w.glb', position: [0, 0, 0] }],
        fogLayer: { stages: [
            { atSeconds: 0, ceiling: 60, ceilingFalloff: 0.3, floor: -30, floorFalloff: 0 },
            { atSeconds: 90, ceiling: 120, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 },
        ] },
    };
    const { warnings } = convertPresetToEditorDocument('plain', preset, { mapScale: MAP_SCALE });
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.match(warnings[0], /fogLayer/);
    const forest = convertPresetToEditorDocument('giant_forest', MAP_PRESET_CATALOG.giant_forest, { mapScale: MAP_SCALE });
    assert.deepEqual(forest.warnings, []);
});

test('fog layer heights of a map without scaled anchors stay at the same world height', () => {
    const stages = [
        { atSeconds: 0, ceiling: 60, ceilingFalloff: 0.03, floor: -30, floorFalloff: 0 },
        { atSeconds: 90, ceiling: 120, ceilingFalloff: 0.06, floor: 0, floorFalloff: 0.01 },
    ];
    const preset = {
        size: [100, 40, 100],
        glbModels: [{ id: 'w', url: 'assets/maps/w/glb/w.glb', position: [0, 0, 0] }],
        fogLayer: { stages },
    };
    const { document } = convertPresetToEditorDocument('plain', preset, { mapScale: MAP_SCALE });
    // The editor map scales its anchors, so the renderer multiplies these heights by MAP_SCALE
    // and divides the falloffs by it; the preset stated world units.
    const layer = normalizeMapFogLayer(document.fogLayer);
    stages.forEach((stage, index) => {
        const converted = layer.stages[index];
        assert.ok(Math.abs(converted.ceiling * MAP_SCALE - stage.ceiling) < 1e-9, `ceiling ${index}`);
        assert.ok(Math.abs(converted.floor * MAP_SCALE - stage.floor) < 1e-9, `floor ${index}`);
        assert.ok(Math.abs(converted.ceilingFalloff / MAP_SCALE - stage.ceilingFalloff) < 1e-9, `ceiling falloff ${index}`);
        assert.ok(Math.abs(converted.floorFalloff / MAP_SCALE - stage.floorFalloff) < 1e-9, `floor falloff ${index}`);
    });
});

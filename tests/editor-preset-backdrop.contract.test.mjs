// A built-in map loaded as backdrop must come back unchanged when the editor exports it: the
// world model, the spawns and their scale convention. Objects placed on top are handed out in
// the preset's own coordinates, so they can be pasted into the preset file.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { getCustomMapConversionScale } from '../src/entities/CustomMapLoader.js';
import { parseMapJSON, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { resolveMapLighting } from '../src/shared/contracts/MapLightingContract.js';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { bindEditorBackdropControls } from '../editor/js/ui/EditorBackdropControls.js';
import {
    BACKDROP_ID_PREFIX,
    PRESET_EDITOR_UNITS_PER_MAP_UNIT,
    convertPresetToEditorDocument,
    exportPlacementsInPresetFormat,
    isBackdropObject,
    listBackdropPresets,
} from '../editor/js/EditorPresetBackdrop.js';

const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;

function createEditor() {
    const core = {
        scene: new THREE.Scene(),
        objectsContainer: new THREE.Group(),
        transformControl: { object: null, detach() {} },
    };
    core.scene.add(core.objectsContainer);
    const assetLoader = {
        getClone() { return null; },
        setCloneHydrationHandler() {},
        registerGlbModel() { return true; },
    };
    let arenaSize = null;
    const mapManager = new EditorMapManager(core, assetLoader);
    mapManager.setArenaSizeProvider(() => arenaSize);
    const load = (document) => {
        mapManager.importFromJSON(JSON.stringify(document), { onArenaSize: (size) => { arenaSize = size; } });
        return arenaSize;
    };
    return { mapManager, load };
}

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);

test('the backdrop list holds the built-in maps with a world model, all converted with one scale', () => {
    const entries = listBackdropPresets(MAP_PRESET_CATALOG);
    assert.ok(entries.some((entry) => entry.key === 'toybox_titan'));
    assert.ok(entries.length >= 10, `only ${entries.length} backdrops`);
    for (const entry of entries) {
        const { document } = convertPresetToEditorDocument(entry.key, MAP_PRESET_CATALOG[entry.key], { mapScale: MAP_SCALE });
        assert.equal(getCustomMapConversionScale(document).scale, PRESET_EDITOR_UNITS_PER_MAP_UNIT, entry.key);
    }
});

test('a block-only catalog map is offered and round-trips authored geometry through the editor', () => {
    const preset = MAP_PRESET_CATALOG.glass_serpent;
    assert.ok(preset);
    assert.equal(preset.glbModels?.length || 0, 0);
    assert.ok(preset.obstacles.length > 0);

    const entries = listBackdropPresets(MAP_PRESET_CATALOG);
    assert.ok(entries.some((entry) => entry.key === 'glass_serpent'));

    const { document } = convertPresetToEditorDocument('glass_serpent', preset, { mapScale: MAP_SCALE });
    assert.equal(getCustomMapConversionScale(document).scale, PRESET_EDITOR_UNITS_PER_MAP_UNIT);
    assert.deepEqual(
        [document.arenaSize.width, document.arenaSize.height, document.arenaSize.depth],
        preset.size.map((value) => value * PRESET_EDITOR_UNITS_PER_MAP_UNIT),
    );
    assert.equal(document.glbModels.length, 0);
    assert.ok(document.hardBlocks.length + document.foamBlocks.length + document.tunnels.length > 0);
    const firstHardBlock = preset.obstacles.find((obstacle) => !obstacle.shape && obstacle.kind !== 'foam');
    assert.equal(document.hardBlocks[0].width, firstHardBlock.size[0] * PRESET_EDITOR_UNITS_PER_MAP_UNIT);
    assert.ok(document.portals.length > 0);
    assert.equal(document.items.length, preset.items.length);
    assert.equal(document.botSpawns.length, preset.botSpawns.length);

    const { mapManager, load } = createEditor();
    const arenaSize = load(document);
    assert.ok(mapManager.getObjectCount() > 0);
    // Every block, tube, portal and item of the game map is backdrop: locked on load, left out
    // of a copy unless asked for.
    const placed = mapManager.core.objectsContainer.children;
    assert.ok(placed.filter((object) => !String(object.userData.type).startsWith('spawn')).every(isBackdropObject));
    const copy = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE });
    for (const key of ['obstacles', 'portals', 'items', 'gates']) assert.equal(copy[key], undefined, `${key} copied along`);
    const ownBlock = mapManager.createMesh('hard', null, 350, 700, -1050, 70, { sizeX: 70, sizeY: 70, sizeZ: 70 });
    const withOwnBlock = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE });
    assert.equal(withOwnBlock.obstacles.length, 1);
    near(withOwnBlock.obstacles[0].pos[0], 10, 'own block x in map units');

    mapManager.removeObject(ownBlock, { updateUi: false });
    const exported = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    const signature = (obstacle) => JSON.stringify({
        kind: obstacle.kind || 'hard',
        shape: obstacle.shape || '',
        pos: obstacle.pos?.map((value) => Math.round(value * 1e6) / 1e6) || [],
        size: obstacle.size?.map((value) => Math.round(value * 1e6) / 1e6) || [],
        start: obstacle.start?.map((value) => Math.round(value * 1e6) / 1e6) || [],
        end: obstacle.end?.map((value) => Math.round(value * 1e6) / 1e6) || [],
        radius: Number.isFinite(Number(obstacle.radius)) ? Math.round(Number(obstacle.radius) * 1e6) / 1e6 : null,
    });
    assert.deepEqual(exported.obstacles.map(signature).sort(), preset.obstacles.map(signature).sort());
    assert.equal(exported.portals.length, preset.portals.length);
    assert.equal(exported.items.length, preset.items.length);
    assert.equal(exported.botSpawns.length, preset.botSpawns.length);
    assert.equal(exported.glbModels, undefined);
    near(exported.playerSpawn.x, preset.playerSpawn.x, 'player spawn x');
    near(exported.playerSpawn.y, preset.playerSpawn.y, 'player spawn y');
    near(exported.playerSpawn.z, preset.playerSpawn.z, 'player spawn z');
});
test('invalid block-only sizes are rejected without dereferencing a missing GLB list', () => {
    assert.throws(
        () => convertPresetToEditorDocument('invalid-block-map', { obstacles: [{ pos: [0, 0, 0], size: [1, 1, 1] }] }),
        /size of three numbers/,
    );
    assert.throws(
        () => convertPresetToEditorDocument('invalid-block-map', {
            size: [Number.NaN, 10, 10],
            obstacles: [{ pos: [0, 0, 0], size: [1, 1, 1] }],
        }),
        /size of three numbers/,
    );
    assert.equal(listBackdropPresets({ invalid: { size: [Number.NaN, 10, 10], obstacles: [{}] } }).length, 0);
});

test('the toybox backdrop round-trips its world and spawns through the editor export', () => {
    const preset = MAP_PRESET_CATALOG.toybox_titan;
    const { document } = convertPresetToEditorDocument('toybox_titan', preset, { mapScale: MAP_SCALE });
    // The toybox scales its anchors, so its lighting is taken over as it is.
    assert.deepEqual(document.lighting, preset.lighting);
    assert.deepEqual(
        [document.arenaSize.width, document.arenaSize.height, document.arenaSize.depth],
        preset.size.map((value) => value * PRESET_EDITOR_UNITS_PER_MAP_UNIT),
    );

    const { mapManager, load } = createEditor();
    const arenaSize = load(document);
    const backdrop = mapManager.core.objectsContainer.children.filter((object) => String(object.userData.id).startsWith(BACKDROP_ID_PREFIX));
    assert.equal(backdrop.length, preset.glbModels.length);

    const exported = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    near(exported.playerSpawn.x, preset.playerSpawn.x, 'spawn x');
    near(exported.playerSpawn.y, preset.playerSpawn.y, 'spawn y');
    near(exported.playerSpawn.z, preset.playerSpawn.z, 'spawn z');
    assert.equal(exported.botSpawns.length, preset.botSpawns.length);
    near(exported.glbModels[0].scale, 1, 'world scale');
    assert.deepEqual(exported.glbModels[0].position, preset.glbModels[0].position);
});

test('a map without scaled anchors keeps its spawns in world units both ways', () => {
    const preset = {
        size: [100, 40, 100],
        glbModels: [{ id: 'w', url: 'assets/maps/w/glb/w.glb', position: [2, 0, -4] }],
        playerSpawn: { x: 30, y: 9, z: -60 },
        botSpawns: [{ x: -30, y: 9, z: 60 }],
    };
    const { document } = convertPresetToEditorDocument('plain', preset, { mapScale: MAP_SCALE });
    near(document.playerSpawn.x, 30 / MAP_SCALE * PRESET_EDITOR_UNITS_PER_MAP_UNIT, 'editor spawn x');

    const { mapManager, load } = createEditor();
    const arenaSize = load(document);
    const exported = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    near(exported.playerSpawn.x, 30, 'spawn x back in world units');
    near(exported.botSpawns[0].z, 60, 'bot z back in world units');
    assert.equal(exported.scaleAuthoredAnchors, undefined);
});

test('aircraft and turrets placed on a map without scaled anchors are handed out in world units', () => {
    const preset = {
        size: [100, 40, 100],
        glbModels: [{ id: 'w', url: 'assets/maps/w/glb/w.glb', position: [0, 0, 0] }],
        playerSpawn: { x: 0, y: 9, z: 0 },
    };
    const { document } = convertPresetToEditorDocument('plain', preset, { mapScale: MAP_SCALE });
    const units = PRESET_EDITOR_UNITS_PER_MAP_UNIT;
    document.aircraft = [{ id: 'jet_1', jetId: 'ship1', x: 10 * units, y: 20 * units, z: -30 * units, scale: 2 * units }];
    document.staticTurrets = [{ id: 'turret_1', pos: [4 * units, 5 * units, 6 * units], range: 20 * units }];
    const { mapManager, load } = createEditor();
    const arenaSize = load(document);

    // The editor map scales its anchors, so the match puts these at map units x MAP_SCALE; the
    // preset does not, so it has to state that world position itself.
    const exported = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE });
    near(exported.aircraft[0].x, 10 * MAP_SCALE, 'aircraft x in world units');
    near(exported.aircraft[0].z, -30 * MAP_SCALE, 'aircraft z in world units');
    near(exported.aircraft[0].scale, 2 * MAP_SCALE, 'aircraft scale in world units');
    near(exported.staticTurrets[0].pos[1], 5 * MAP_SCALE, 'turret y in world units');
    near(exported.staticTurrets[0].range, 20 * MAP_SCALE, 'turret range in world units');

    const scaled = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset: { ...preset, scaleAuthoredAnchors: true }, mapScale: MAP_SCALE });
    near(scaled.aircraft[0].x, 10, 'aircraft x stays in map units for a map that scales anchors');
});

test('a reopened map still copies placements with its backdrop map\'s anchor rule', async () => {
    const preset = MAP_PRESET_CATALOG.toybox_titan;
    assert.equal(preset.scaleAuthoredAnchors, true);
    const { document } = convertPresetToEditorDocument('toybox_titan', preset, { mapScale: MAP_SCALE });
    const first = createEditor();
    const savedJson = first.mapManager.generateJSONExport(first.load(document));

    // Reopened in a fresh editor: nothing but the saved file says which game map it was built on.
    const reopened = createEditor();
    const arenaSize = reopened.load(JSON.parse(savedJson));
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({}) };
    try {
        const editor = {
            core: reopened.mapManager.core,
            dom: { jsonOutput: { value: '' } },
            mapManager: reopened.mapManager,
            getArenaSizeForExport: () => arenaSize,
            notify: () => {},
        };
        bindEditorBackdropControls(editor);
        const copied = JSON.parse(await editor.copyPlacementsInPresetFormat());
        assert.equal(copied.scaleAuthoredAnchors, true);
        near(copied.playerSpawn.x, preset.playerSpawn.x, 'spawn x in the preset\'s map units');
        near(copied.playerSpawn.z, preset.playerSpawn.z, 'spawn z in the preset\'s map units');
    } finally {
        globalThis.document = previousDocument;
    }
});

test('a copy warns where a map without scaled anchors would cut a value to its world limits', () => {
    const preset = {
        size: [100, 40, 100],
        glbModels: [{ id: 'w', url: 'assets/maps/w/glb/w.glb', position: [0, 0, 0] }],
        playerSpawn: { x: 0, y: 9, z: 0 },
    };
    const { document } = convertPresetToEditorDocument('plain', preset, { mapScale: MAP_SCALE });
    const units = PRESET_EDITOR_UNITS_PER_MAP_UNIT;
    // 70 map units of range are 210 world units; such a map allows turrets at most 180.
    document.staticTurrets = [
        { id: 'far_turret', pos: [0, 5 * units, 0], range: 70 * units },
        { id: 'near_turret', pos: [10 * units, 5 * units, 0], range: 20 * units },
    ];
    const { mapManager, load } = createEditor();
    const arenaSize = load(document);

    const warnings = [];
    exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE, warnings });
    assert.equal(warnings.length, 1, warnings.join(' | '));
    assert.match(warnings[0], /far_turret/);
    assert.match(warnings[0], /range/);

    const scaledWarnings = [];
    exportPlacementsInPresetFormat(mapManager, arenaSize, {
        preset: { ...preset, scaleAuthoredAnchors: true }, mapScale: MAP_SCALE, warnings: scaledWarnings,
    });
    assert.deepEqual(scaledWarnings, []);
});

test('a copy says so when the saved backdrop map is no longer in the catalog', async () => {
    const reopened = createEditor();
    const arenaSize = reopened.load({ arenaSize: { width: 4200, height: 1400, depth: 4200 }, editorBackdrop: 'gone_map' });
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({}) };
    try {
        const notes = [];
        const editor = {
            core: reopened.mapManager.core,
            dom: { jsonOutput: { value: '' } },
            mapManager: reopened.mapManager,
            getArenaSizeForExport: () => arenaSize,
            notify: (message, type) => notes.push({ message, type }),
        };
        bindEditorBackdropControls(editor);
        await editor.copyPlacementsInPresetFormat();
        assert.ok(notes.some((note) => note.type === 'warn' && note.message.includes('gone_map')), JSON.stringify(notes));
    } finally {
        globalThis.document = previousDocument;
    }
});

/** Lighting of the map the match builds from an editor export. */
function exportedMatchLighting(mapManager, arenaSize) {
    const parsed = parseMapJSON(mapManager.generateJSONExport(arenaSize));
    const conversion = getCustomMapConversionScale(parsed.map).scale;
    return toArenaMapDefinition(parsed.map, { mapScale: conversion }).map;
}

test('a map saved on a backdrop keeps the backdrop lighting in the match', () => {
    const preset = MAP_PRESET_CATALOG.toybox_titan;
    const { document } = convertPresetToEditorDocument('toybox_titan', preset, { mapScale: MAP_SCALE });
    const { mapManager, load } = createEditor();
    const arenaSize = load(document);
    const matchMap = exportedMatchLighting(mapManager, arenaSize);
    assert.deepEqual(resolveMapLighting(matchMap.lighting), resolveMapLighting(preset.lighting));
});

test('fog heights of a map without scaled anchors stay at the same world height', () => {
    const preset = {
        size: [100, 40, 100],
        glbModels: [{ id: 'w', url: 'assets/maps/w/glb/w.glb', position: [0, 0, 0] }],
        playerSpawn: { x: 0, y: 9, z: 0 },
        lighting: { fog: { height: 30, heightFalloff: 0.02, near: 60, far: 220 } },
    };
    const { document } = convertPresetToEditorDocument('plain', preset, { mapScale: MAP_SCALE });
    const { mapManager, load } = createEditor();
    const matchMap = exportedMatchLighting(mapManager, load(document));
    // The editor map scales its anchors, so the match multiplies its fog height by MAP_SCALE
    // and divides the falloff by it; the preset did neither.
    const fog = resolveMapLighting(matchMap.lighting).fog;
    near(fog.height * MAP_SCALE, 30, 'world fog height');
    near(fog.heightFalloff / MAP_SCALE, 0.02, 'world fog falloff');
    near(fog.far, 220, 'fog distance stays in world units');
});

test('objects placed on the backdrop are handed out without the backdrop itself', () => {
    const preset = MAP_PRESET_CATALOG.toybox_titan;
    const { document } = convertPresetToEditorDocument('toybox_titan', preset, { mapScale: MAP_SCALE });
    const { mapManager, load } = createEditor();
    const arenaSize = load(document);
    mapManager.createMesh('item', 'item_star', 350, 700, -1050, 0, { id: 'star_1' });

    const exported = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE });
    assert.equal(exported.glbModels, undefined);
    assert.equal(exported.items.length, 1);
    near(exported.items[0].x, 10, 'item x in map units');
    near(exported.items[0].y, 20, 'item y in map units');
    near(exported.items[0].z, -30, 'item z in map units');
});

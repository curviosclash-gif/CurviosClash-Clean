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
import {
    BACKDROP_ID_PREFIX,
    PRESET_EDITOR_UNITS_PER_MAP_UNIT,
    convertPresetToEditorDocument,
    exportPlacementsInPresetFormat,
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

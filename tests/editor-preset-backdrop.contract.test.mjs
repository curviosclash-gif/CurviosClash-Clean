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
import { normalizeGLBModelCollection } from '../src/entities/GLBMapLoader.js';
import { computeCollectionPlacement } from '../src/entities/GLBCollectionPlacement.js';
import { isParcoursActiveForGameMode } from '../src/shared/contracts/MapModeContract.js';
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

for (const [key, portalPairs, checkpoints] of [['orbital_shipyard', 2, 19], ['neon_carnival', 4, 13], ['cherry_grove', 2, 0]]) {
    test(`${key}: GLB backdrop keeps authored portals and course through save and reopen`, () => {
        const preset = MAP_PRESET_CATALOG[key], before = structuredClone(preset);
        assert.equal(preset.portals.length, portalPairs);
        assert.equal(preset.parcours?.checkpoints?.length || 0, checkpoints);
        const { document } = convertPresetToEditorDocument(key, preset, { mapScale: MAP_SCALE });
        assert.equal(document.portals?.length || 0, portalPairs * 2, 'both portal ends must reach the editor');
        assert.equal(document.parcours?.checkpoints?.length || 0, checkpoints, 'all authored course checkpoints must reach the editor');
        const first = createEditor(), arena = first.load(document);
        if (checkpoints) assert.ok(first.mapManager.core.objectsContainer.children
            .filter(object => object.userData.type === 'checkpoint').every(object => isBackdropObject(object, preset)));
        const reopened = createEditor(), reopenedArena = reopened.load(JSON.parse(first.mapManager.generateJSONExport(arena)));
        const output = exportPlacementsInPresetFormat(reopened.mapManager, reopenedArena, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
        assert.equal(output.portals.length, portalPairs);
        for (let index = 0; index < portalPairs; index++) if (preset.portals[index].color !== undefined) assert.equal(output.portals[index].color, preset.portals[index].color);
        assert.equal(output.aircraft?.length || 0, preset.aircraft?.length || 0);
        for (let index = 0; index < (preset.aircraft?.length || 0); index++) {
            const actual = output.aircraft[index], source = preset.aircraft[index];
            assert.equal(actual.id, source.id); assert.equal(actual.jetId, source.jetId);
            for (const key of ['x', 'y', 'z', 'scale']) near(actual[key], source[key], `aircraft ${index}.${key}`);
        }
        for (let index = 0; index < portalPairs; index++) for (const side of ['a', 'b']) {
            output.portals[index][side].forEach((value, axis) => near(value, preset.portals[index][side][axis], `${key} portal ${index}.${side}.${axis}`));
        }
        if (checkpoints) {
            assert.deepEqual(output.parcours.checkpoints.map(cp => cp.id), preset.parcours.checkpoints.map(cp => cp.id));
            for (let index = 0; index < checkpoints; index++) {
                const source = preset.parcours.checkpoints[index], actual = output.parcours.checkpoints[index];
                source.pos.forEach((value, axis) => near(actual.pos[axis], value, `${key} ${source.id} position ${axis}`));
                near(actual.radius, source.radius, `${key} ${source.id} radius`);
                assert.deepEqual(actual.nextIds || [], source.nextIds || (source.nextId ? [source.nextId] : []));
                assert.equal(actual.aliasOf || '', source.aliasOf || '');
            }
            preset.parcours.finish.pos.forEach((value, axis) => near(output.parcours.finish.pos[axis], value, `${key} finish ${axis}`));
        }
        assert.deepEqual(preset, before, 'conversion never mutates catalog originals');
    });
}

test('the backdrop list holds the built-in maps with a world model, all converted with one scale', () => {
    const entries = listBackdropPresets(MAP_PRESET_CATALOG);
    assert.ok(entries.some((entry) => entry.key === 'toybox_titan'));
    assert.ok(entries.length >= 10, `only ${entries.length} backdrops`);
    for (const entry of entries) {
        const { document } = convertPresetToEditorDocument(entry.key, MAP_PRESET_CATALOG[entry.key], { mapScale: MAP_SCALE });
        assert.equal(getCustomMapConversionScale(document).scale, PRESET_EDITOR_UNITS_PER_MAP_UNIT, entry.key);
    }
});

test('copying additions excludes original course nodes but retains a new node and its authored references', () => {
    const preset = MAP_PRESET_CATALOG.orbital_shipyard;
    const { document } = convertPresetToEditorDocument('orbital_shipyard', preset, { mapScale: MAP_SCALE });
    const { mapManager, load } = createEditor(), arena = load(document);
    mapManager.createMesh('checkpoint', 'gate', 350, 700, -1050, 0, { id: 'OWN_CP', cpRadius: 140,
        cpForward: [1, 0, 0], nextIds: [preset.parcours.checkpoints[0].id] });
    const copied = exportPlacementsInPresetFormat(mapManager, arena, { preset, mapScale: MAP_SCALE });
    assert.deepEqual(copied.parcours.checkpoints.map(cp => cp.id), ['OWN_CP']);
    assert.deepEqual(copied.parcours.checkpoints[0].nextIds, [preset.parcours.checkpoints[0].id]);
    assert.equal(copied.parcours.finish, undefined);
    near(copied.parcours.checkpoints[0].pos[0], 10, 'own checkpoint x');
    const full = exportPlacementsInPresetFormat(mapManager, arena, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    assert.equal(full.parcours.checkpoints.length, preset.parcours.checkpoints.length + 1);
});

test('an authored Hunt-only course keeps its activation rule through the editor and match schema', () => {
    const preset = { ...MAP_PRESET_CATALOG.orbital_shipyard,
        parcours: { ...MAP_PRESET_CATALOG.orbital_shipyard.parcours, gameModes: ['HUNT'] } };
    const { document } = convertPresetToEditorDocument('hunt-course', preset, { mapScale: MAP_SCALE });
    const editor = createEditor(), arena = editor.load(document);
    const parsed = parseMapJSON(editor.mapManager.generateJSONExport(arena)).map;
    const output = toArenaMapDefinition(parsed, { mapScale: PRESET_EDITOR_UNITS_PER_MAP_UNIT }).map;
    assert.equal(isParcoursActiveForGameMode(output, 'HUNT'), true);
    assert.equal(isParcoursActiveForGameMode(output, 'CLASSIC'), false);
    assert.equal(isParcoursActiveForGameMode(output, 'ARCADE'), false);
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
    assert.ok(placed.filter((object) => !String(object.userData.type).startsWith('spawn')).every(object => isBackdropObject(object, preset)));
    const copy = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE });
    for (const key of ['obstacles', 'portals', 'items', 'gates']) assert.equal(copy[key], undefined, `${key} copied along`);
    assert.equal(copy.parcours, undefined, 'authored checkpoints retain IDs but stay out of a placement-only copy');
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
    const backdrop = mapManager.core.objectsContainer.children.filter(object => object.userData.type === 'glb' && isBackdropObject(object, preset));
    assert.equal(backdrop.length, preset.glbModels.length);

    const exported = exportPlacementsInPresetFormat(mapManager, arenaSize, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    near(exported.playerSpawn.x, preset.playerSpawn.x, 'spawn x');
    near(exported.playerSpawn.y, preset.playerSpawn.y, 'spawn y');
    near(exported.playerSpawn.z, preset.playerSpawn.z, 'spawn z');
    assert.equal(exported.botSpawns.length, preset.botSpawns.length);
    near(exported.glbModels[0].scale, 1, 'world scale');
    assert.deepEqual(exported.glbModels[0].position, preset.glbModels[0].position);
});

test('GLB backdrop retains collision flags, original model IDs and inherited animation timing in the match', () => {
    const preset = { size: [100, 40, 100], scaleAuthoredAnchors: true, glbColliderMode: 'dynamic',
        glbAuthoredObstaclesCollisionOnly: true,
        glbAnimationClock: { beatSeconds: 8, playbackRate: 1.2, phaseOffsetBeats: 0.25, clipName: 'Main', mode: 'loop' },
        glbModels: [
            { id: 'collider', url: 'assets/a.glb', position: [2, 3, 4], targetSize: 20, collisionOnly: true, role: 'required' },
            { id: 'fall', url: 'assets/b.glb', position: [5, 6, 7], scale: 2, collision: false, maxRenderDistance: 120,
                hiddenUntilTriggered: true, fixedTriggeredPlacement: true, animationClock: { clipName: 'Fall', mode: 'once', phaseOffsetBeats: 0.5 } },
        ] };
    const { document } = convertPresetToEditorDocument('timed', preset, { mapScale: MAP_SCALE });
    const first = createEditor(), arena = first.load(document), reopened = createEditor();
    const secondArena = reopened.load(JSON.parse(first.mapManager.generateJSONExport(arena)));
    const saved = parseMapJSON(reopened.mapManager.generateJSONExport(secondArena)).map;
    const output = toArenaMapDefinition(saved, { mapScale: PRESET_EDITOR_UNITS_PER_MAP_UNIT }).map;
    assert.equal(output.glbAuthoredObstaclesCollisionOnly, true);
    assert.equal(output.glbColliderMode, 'dynamic');
    const expected = normalizeGLBModelCollection(preset.glbModels, { animationClock: preset.glbAnimationClock });
    const signature = models => models.map(model => ({ ...model, scale: model.targetSize > 0 ? 1 : model.scale }));
    const actual = normalizeGLBModelCollection(output.glbModels, { animationClock: output.glbAnimationClock });
    // targetSize determines the fit independently of the unused raw scale; compare actual placement too.
    const bounds = new THREE.Box3(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 8, 1));
    for (let index = 0; index < actual.length; index++) assert.deepEqual(
        computeCollectionPlacement(bounds, actual[index], MAP_SCALE), computeCollectionPlacement(bounds, expected[index], MAP_SCALE));
    assert.deepEqual(signature(actual), signature(expected));
    const copied = exportPlacementsInPresetFormat(reopened.mapManager, secondArena, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    assert.deepEqual(signature(normalizeGLBModelCollection(copied.glbModels, { animationClock: preset.glbAnimationClock })), signature(expected));
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


test('preset aircraft resolves the editor asset alias without changing its runtime jet ID', () => {
    const { mapManager } = createEditor(); const requested = [];
    mapManager.assetLoader.getClone = id => { requested.push(id); return new THREE.Group(); };
    for (const id of ['ship4', 'jet_ship4']) {
        const object = mapManager.createMesh('aircraft', id, 10, 20, 30, 0, { modelScale: 50 });
        assert.equal(object.userData.subType, id);
        assert.equal(JSON.parse(mapManager.generateJSONExport({width:2800,height:950,depth:2400})).aircraft.at(-1).jetId, id);
    }
    assert.deepEqual(requested, ['jet_ship4', 'jet_ship4']);
});

/** A course template: two gates, a finish, its own route ID, rules and a guidance path. */
function createCourseTemplate() {
    return {
        size: [100, 40, 100],
        scaleAuthoredAnchors: true,
        glbModels: [{ id: 'w', url: 'assets/maps/w/glb/w.glb', position: [0, 0, 0] }],
        playerSpawn: { x: 0, y: 9, z: 0 },
        parcours: {
            enabled: true,
            routeId: 'template_route_v3',
            checkpoints: [
                { id: 'CP_A', pos: [10, 10, 0], radius: 4, nextIds: ['CP_B'] },
                { id: 'CP_B', pos: [20, 10, 0], radius: 4, nextIds: ['FIN'] },
            ],
            finish: { id: 'FIN', pos: [30, 10, 0], radius: 5 },
            guidancePaths: [{ branchCheckpointId: 'CP_A', endCheckpointId: 'FIN', points: [[10, 10, 0], [30, 10, 0]] }],
            guidanceBranchCheckpointIds: ['CP_A'],
            rules: { ordered: true, maxSegmentTimeMs: 9000 },
        },
    };
}

test('a placement-only copy hands out new checkpoints without the template route around them', () => {
    const preset = createCourseTemplate();
    const { document } = convertPresetToEditorDocument('course', preset, { mapScale: MAP_SCALE });
    const { mapManager, load } = createEditor(), arena = load(document);
    mapManager.createMesh('checkpoint', 'gate', 350, 350, 0, 0, { id: 'OWN_CP', cpRadius: 140,
        cpForward: [1, 0, 0], nextIds: ['CP_B', 'GONE'] });

    const warnings = [];
    const copied = exportPlacementsInPresetFormat(mapManager, arena, { preset, mapScale: MAP_SCALE, warnings });
    assert.deepEqual(Object.keys(copied.parcours), ['checkpoints'],
        'route ID, rules and guidance paths stay with the template route');
    assert.deepEqual(copied.parcours.checkpoints.map((cp) => cp.id), ['OWN_CP']);
    assert.deepEqual(copied.parcours.checkpoints[0].nextIds, ['CP_B'],
        'a link into the template survives, a link to no checkpoint at all does not');
    assert.ok(warnings.some((warning) => warning.includes('parcours.checkpoints')),
        'the author learns to add the checkpoints to the route instead of replacing it');

    const full = exportPlacementsInPresetFormat(mapManager, arena, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    assert.equal(full.parcours.routeId, 'template_route_v3', 'a full copy keeps the whole route');
    assert.equal(full.parcours.guidancePaths.length, 1);
});

test('template models without their own ID keep distinct IDs in the editor export and the copy', () => {
    const preset = {
        size: [100, 40, 100],
        scaleAuthoredAnchors: true,
        glbModels: [
            { url: 'assets/maps/w/glb/w.glb', position: [0, 0, 0] },
            { url: 'assets/maps/w/glb/tower.glb', position: [10, 0, 0], hiddenUntilTriggered: true },
        ],
        playerSpawn: { x: 0, y: 9, z: 0 },
    };
    const { document } = convertPresetToEditorDocument('anonymous', preset, { mapScale: MAP_SCALE });
    const { mapManager, load } = createEditor(), arena = load(document);
    const saved = parseMapJSON(mapManager.generateJSONExport(arena)).map;
    const matchIds = toArenaMapDefinition(saved, { mapScale: PRESET_EDITOR_UNITS_PER_MAP_UNIT }).map.glbModels.map((model) => model.id);
    assert.deepEqual(matchIds, ['model-1', 'model-2'], 'the match sees the IDs the template would get by itself');
    const copied = exportPlacementsInPresetFormat(mapManager, arena, { preset, mapScale: MAP_SCALE, includeBackdrop: true });
    assert.equal(new Set(copied.glbModels.map((model) => model.id)).size, 2, 'the copy names both models apart');
});

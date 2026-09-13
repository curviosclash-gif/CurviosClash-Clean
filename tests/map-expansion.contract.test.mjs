import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { Arena } from '../src/entities/Arena.js';
import { ArenaExpansionController } from '../src/entities/arena/ArenaExpansionController.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import { formatMapExpansionStatus } from '../src/ui/MapExpansionStatusText.js';
import {
    MAP_EXPANSION_PHASES,
    MAP_EXPANSION_RANGES,
    createMapExpansionState,
    normalizeMapExpansion,
    resolveMapExpansionState,
} from '../src/shared/contracts/MapExpansionContract.js';

// A core of 40, a wide stage at 30 s and a tall one at 60 s that opens without warning.
const EXPANSION_SOURCE = Object.freeze({
    stages: [
        { id: 'core', size: [40, 20, 40] },
        { id: 'wide', atSeconds: 30, telegraphSeconds: 8, openSeconds: 2, size: [100, 20, 100] },
        { id: 'tall', atSeconds: 60, telegraphSeconds: 0, openSeconds: 0, size: [100, 60, 100] },
    ],
});

test('anything that is not a growing map normalizes to null', () => {
    for (const source of [undefined, null, [], 'abc', 42, { stages: 'x' }, { stages: [] }]) {
        assert.equal(normalizeMapExpansion(source), null);
    }
    assert.equal(normalizeMapExpansion({ stages: [{ size: [10, 10, 10] }] }), null, 'one stage never grows');
});

test('stages are sorted, never shrink and drop what cannot be a stage', () => {
    const expansion = normalizeMapExpansion({
        stages: [
            { id: 'sky', atSeconds: 200, telegraphSeconds: 10, openSeconds: 3, size: [280, 110, 280], label: '  Himmel  ' },
            { id: 'core', atSeconds: 5, telegraphSeconds: 9, openSeconds: 9, size: [120, 50, 120] },
            { id: 'north_south', atSeconds: 60, size: [100, 50, 280] },
            { id: 'twin', atSeconds: 60, size: [300, 50, 300] },
            { id: 'no_size', atSeconds: 90 },
            { id: 'bad_size', atSeconds: 120, size: [10, 'x', 10] },
            { id: 'null_size', atSeconds: 130, size: [10, null, 10] },
            'garbage',
        ],
    });

    assert.deepEqual(expansion.stages.map((stage) => stage.id), ['core', 'north_south', 'sky']);
    assert.deepEqual(
        { ...expansion.stages[0], size: [...expansion.stages[0].size] },
        { id: 'core', label: '', atSeconds: 0, telegraphSeconds: 0, openSeconds: 0, size: [120, 50, 120] },
        'the first stage is the starting size',
    );
    assert.deepEqual([...expansion.stages[1].size], [120, 50, 280], 'a smaller width is raised to the previous one');
    assert.equal(expansion.stages[1].telegraphSeconds, 8);
    assert.equal(expansion.stages[1].openSeconds, 2);
    assert.equal(expansion.stages[2].label, 'Himmel');
    assert.equal(Object.isFrozen(expansion), true);
    assert.equal(Object.isFrozen(expansion.stages), true);
    assert.equal(Object.isFrozen(expansion.stages[1]), true);
    assert.equal(Object.isFrozen(expansion.stages[1].size), true);
});

test('ranges clamp both ends and an announcement never overlaps the previous stage', () => {
    const clamped = normalizeMapExpansion({
        stages: [
            { size: [1, 99999, 10] },
            { atSeconds: 99999, telegraphSeconds: -5, openSeconds: 50, size: [1, 1, 1] },
        ],
    });
    assert.deepEqual([...clamped.stages[0].size], [MAP_EXPANSION_RANGES.size.min, MAP_EXPANSION_RANGES.size.max, 10]);
    assert.equal(clamped.stages[1].atSeconds, MAP_EXPANSION_RANGES.atSeconds.max);
    assert.equal(clamped.stages[1].telegraphSeconds, MAP_EXPANSION_RANGES.telegraphSeconds.min);
    assert.equal(clamped.stages[1].openSeconds, MAP_EXPANSION_RANGES.openSeconds.max);
    assert.equal(clamped.stages[1].id, 'expansion_stage_1');

    const tight = normalizeMapExpansion({
        stages: [
            { size: [10, 10, 10] },
            { atSeconds: 5, telegraphSeconds: 10, openSeconds: 3, size: [20, 10, 20] },
            { atSeconds: 6, telegraphSeconds: 4, openSeconds: 4, size: [30, 10, 30] },
        ],
    });
    assert.deepEqual(
        tight.stages.slice(1).map((stage) => [stage.telegraphSeconds, stage.openSeconds]),
        [[2, 3], [0, 1]],
    );

    const many = normalizeMapExpansion({
        stages: Array.from({ length: 12 }, (_, index) => ({ atSeconds: index * 10, size: [10 + index, 10, 10] })),
    });
    assert.equal(many.stages.length, MAP_EXPANSION_RANGES.stageCount.max);
});

test('the state follows the match time through announcement, opening and completion', () => {
    const expansion = normalizeMapExpansion(EXPANSION_SOURCE);
    const at = (seconds) => ({ ...resolveMapExpansionState(expansion, seconds) });

    assert.deepEqual(at(0), { stageIndex: 0, nextStageIndex: 1, phase: MAP_EXPANSION_PHASES.IDLE, phaseProgress: 0, secondsUntilOpen: 30 });
    assert.equal(at(19.9).phase, MAP_EXPANSION_PHASES.IDLE);
    assert.deepEqual([at(20).phase, at(20).phaseProgress], [MAP_EXPANSION_PHASES.TELEGRAPH, 0]);
    assert.deepEqual([at(24).phase, at(24).phaseProgress], [MAP_EXPANSION_PHASES.TELEGRAPH, 0.5]);
    assert.deepEqual([at(28).phase, at(28).phaseProgress], [MAP_EXPANSION_PHASES.OPENING, 0]);
    assert.deepEqual(at(29), { stageIndex: 0, nextStageIndex: 1, phase: MAP_EXPANSION_PHASES.OPENING, phaseProgress: 0.5, secondsUntilOpen: 1 });
    assert.deepEqual(at(30), { stageIndex: 1, nextStageIndex: 2, phase: MAP_EXPANSION_PHASES.IDLE, phaseProgress: 0, secondsUntilOpen: 30 });
    assert.equal(at(59.5).phase, MAP_EXPANSION_PHASES.IDLE, 'a stage without announcement stays idle until it opens');
    assert.deepEqual(at(60), { stageIndex: 2, nextStageIndex: -1, phase: MAP_EXPANSION_PHASES.COMPLETE, phaseProgress: 1, secondsUntilOpen: 0 });
    assert.deepEqual(at(Number.NaN), at(0));
    assert.deepEqual(at(-5), at(0));
    assert.deepEqual({ ...resolveMapExpansionState(null, 99) }, createMapExpansionState());

    const target = createMapExpansionState();
    assert.equal(resolveMapExpansionState(expansion, 24, target), target, 'the per-frame caller does not allocate');
    assert.equal(target.phase, MAP_EXPANSION_PHASES.TELEGRAPH);
});

test('the controller holds stages to the built map and leaves foreign bounds alone', () => {
    const full = Object.freeze({ minX: -50, maxX: 50, minY: 0, maxY: 40, minZ: -50, maxZ: 50 });

    const zoneArena = { bounds: { ...full }, openFaces: ['maxY'] };
    const zoneController = new ArenaExpansionController(zoneArena);
    assert.equal(zoneController.build({ expansion: EXPANSION_SOURCE }, 1), false, 'exclusion-zone maps do not grow');
    assert.deepEqual(zoneArena.bounds, full);

    const arena = { bounds: { ...full }, openFaces: [] };
    const controller = new ArenaExpansionController(arena);
    assert.equal(controller.build({}, 1), false);
    assert.equal(controller.active, false);
    assert.equal(controller.build({ expansion: EXPANSION_SOURCE }, 1), true);
    assert.equal(controller.active, true);
    assert.deepEqual(arena.bounds, { minX: -20, maxX: 20, minY: 0, maxY: 20, minZ: -20, maxZ: 20 });
    assert.deepEqual(controller.outerBounds, full);

    const streamingBounds = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 };
    arena._staticStreamingSnapshot = { bounds: { ...arena.bounds } };
    arena.bounds = streamingBounds;
    controller.update(45);
    assert.equal(arena.bounds, streamingBounds, 'static streaming owns the bounds while it runs');
    arena.bounds = arena._staticStreamingSnapshot.bounds;
    arena._staticStreamingSnapshot = null;
    controller.update(45);
    assert.deepEqual(arena.bounds, { minX: -50, maxX: 50, minY: 0, maxY: 20, minZ: -50, maxZ: 50 });

    controller.update(61);
    assert.equal(arena.bounds.maxY, 40, 'a stage taller than the built map is held to it');
});

test('a growing arena opens with the match clock and follows host and restart overrides', async () => {
    const coverage = [];
    const arena = new Arena({
        addToScene() {}, removeFromScene() {}, setMapLighting() {},
        setShadowCoverage(bounds) { coverage.push({ ...bounds }); },
        getGraphicsStyle() { return 'modern'; }, getMaxAnisotropy() { return 1; },
    });
    arena.runtimeMapKey = 'growing-probe';
    arena.entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_SECTIONS);
    arena.runtimeMapDefinition = {
        size: [100, 40, 100],
        obstacles: [],
        portals: [],
        gates: [],
        expansion: {
            stages: [
                { size: [40, 20, 40] },
                { atSeconds: 10, size: [100, 40, 100] },
            ],
        },
    };
    const { scale } = await arena.build(arena.runtimeMapKey);

    const beyondCoreWall = new Vector3(30 * scale, 10 * scale, 0);
    const aboveCoreRoof = new Vector3(0, 30 * scale, 0);
    const blocked = () => [
        arena.checkCollisionFast(beyondCoreWall, 1),
        arena.checkCollisionFast(aboveCoreRoof, 1),
    ];

    assert.equal(arena.bounds.maxX, 20 * scale);
    assert.equal(coverage.at(-1).maxX, 50 * scale, 'shadows are sized for the fully grown map');
    assert.deepEqual(blocked(), [true, true]);

    arena.update(9.9);
    assert.deepEqual(blocked(), [true, true], 'the core still closes while the stage is opening');
    arena.update(0.2);
    assert.deepEqual(blocked(), [false, false]);

    arena.setGlbAnimationElapsedSeconds(0);
    assert.deepEqual(blocked(), [true, true], 'a round restart shrinks back to the core');

    arena.setGlbAnimationElapsedSeconds(25);
    assert.deepEqual(blocked(), [false, false], 'a host time jump lands on the same stage as playing through');
});

test('stage walls announce, sink away and hand their faces over to the next stage', () => {
    const added = [];
    const removed = [];
    const arena = {
        bounds: { minX: -50, maxX: 50, minY: 0, maxY: 60, minZ: -50, maxZ: 50 },
        openFaces: [],
        renderer: { addToScene: (object) => added.push(object), removeFromScene: (object) => removed.push(object) },
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_SECTIONS),
    };
    const controller = new ArenaExpansionController(arena);
    controller.build({
        expansion: {
            stages: [
                { size: [40, 20, 40] },
                { atSeconds: 30, telegraphSeconds: 8, openSeconds: 2, size: [100, 20, 100] },
                { atSeconds: 60, telegraphSeconds: 4, openSeconds: 2, size: [100, 60, 100] },
            ],
        },
    }, 1);

    assert.equal(added.length, 1);
    const group = added[0];
    const wall = (stage, face) => group.getObjectByName(`map-expansion-wall-${stage}-${face}`);
    const visible = () => group.children.filter((mesh) => mesh.visible).map((mesh) => mesh.name).sort();
    const { idleMaterial, warningMaterial } = controller.walls;
    const coreWalls = ['maxX', 'maxY', 'maxZ', 'minX', 'minZ'].map((face) => `map-expansion-wall-0-${face}`);

    assert.equal(group.children.length, 6, 'five core walls and the low roof of the wide stage; nothing on the outer bounds');
    assert.deepEqual(visible(), coreWalls);
    assert.equal(wall(0, 'maxX').position.x, 21, 'the wall stands just outside the collision bounds');
    assert.equal(wall(0, 'maxX').material, idleMaterial);

    controller.update(24);
    assert.equal(wall(0, 'maxX').material, warningMaterial);
    assert.equal(wall(0, 'maxY').material, idleMaterial, 'the roof does not move when the next stage keeps the height');
    assert.ok(warningMaterial.emissiveIntensity > idleMaterial.emissiveIntensity);

    controller.update(29);
    assert.equal(wall(0, 'maxX').position.y, -1, 'half way through the opening the side wall has sunk half its travel');
    assert.equal(wall(0, 'maxY').visible, false);
    assert.equal(wall(1, 'maxY').visible, true, 'the incoming stage already stands on the face that does not move');
    assert.equal(arena.bounds.maxX, 20, 'the core still collides while its walls sink');

    controller.update(30);
    assert.deepEqual(visible(), ['map-expansion-wall-1-maxY']);
    assert.equal(wall(1, 'maxY').material, idleMaterial);

    controller.update(59);
    assert.equal(wall(1, 'maxY').material, warningMaterial);
    assert.equal(wall(1, 'maxY').position.y, 41, 'the roof lifts towards the tall stage');

    controller.update(60);
    assert.deepEqual(visible(), []);

    controller.update(0);
    assert.deepEqual(visible(), coreWalls, 'a restart shows the core again');
    assert.equal(wall(0, 'maxX').position.y, 10);

    controller.clear();
    controller.clear();
    assert.deepEqual(removed, [group]);
});

test('the HUD announcement is projected from the arena and reads as a countdown', () => {
    const arena = { bounds: { minX: -50, maxX: 50, minY: 0, maxY: 40, minZ: -50, maxZ: 50 }, openFaces: [] };
    const controller = new ArenaExpansionController(arena);
    controller.build({
        expansion: {
            stages: [
                { size: [40, 20, 40] },
                { atSeconds: 30, telegraphSeconds: 8, openSeconds: 2, label: 'Nord/Süd', size: [100, 20, 100] },
            ],
        },
    }, 1);
    const projectAt = (seconds) => {
        controller.update(seconds);
        return createMatchRuntimePlayerProjection({ playerIndex: 0, mapExpansion: controller.getHudState() }).mapExpansion;
    };
    const inactive = { active: false, phase: 'IDLE', secondsUntilOpen: 0, label: '' };

    assert.deepEqual(projectAt(10), inactive);
    assert.deepEqual(projectAt(24), { active: true, phase: 'TELEGRAPH', secondsUntilOpen: 6, label: 'Nord/Süd' });
    assert.equal(formatMapExpansionStatus(projectAt(24)), 'SEKTOR NORD/SÜD · ÖFFNET IN 6 s');
    assert.equal(formatMapExpansionStatus(projectAt(29)), 'SEKTOR NORD/SÜD · ÖFFNET');
    assert.deepEqual(projectAt(30), inactive);
    assert.equal(formatMapExpansionStatus(projectAt(30)), '');

    assert.deepEqual(createMatchRuntimePlayerProjection({ playerIndex: 0 }).mapExpansion, inactive);
    assert.deepEqual(
        createMatchRuntimePlayerProjection({ playerIndex: 0, mapExpansion: { active: true, phase: 'COMPLETE', label: 'x' } }).mapExpansion,
        inactive,
    );
    assert.equal(
        formatMapExpansionStatus({ active: true, phase: 'TELEGRAPH', secondsUntilOpen: 3.2, label: '  ' }),
        'NEUER SEKTOR · ÖFFNET IN 4 s',
    );
    assert.equal(formatMapExpansionStatus(null), '');
});

test('the runtime projection carries the arena announcement to every player HUD', async () => {
    const arena = new Arena({
        addToScene() {}, removeFromScene() {}, setMapLighting() {}, setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; }, getMaxAnisotropy() { return 1; },
    });
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_SECTIONS);
    arena.runtimeMapKey = 'growing-hud-probe';
    arena.entityRuntimeConfig = entityRuntimeConfig;
    arena.runtimeMapDefinition = {
        size: [100, 40, 100],
        obstacles: [],
        portals: [],
        gates: [],
        expansion: {
            stages: [
                { size: [40, 20, 40] },
                { atSeconds: 30, telegraphSeconds: 8, openSeconds: 2, label: 'Nord', size: [100, 40, 100] },
            ],
        },
    };
    await arena.build(arena.runtimeMapKey);
    const players = [0, 1].map((index) => ({
        index,
        alive: true,
        cameraMode: 0,
        position: { x: 0, y: 5, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        entityRuntimeConfig,
    }));
    const projectAt = (seconds) => {
        // The same seam a host snapshot or a replay uses to set the map time.
        arena.setGlbAnimationElapsedSeconds(seconds);
        return buildMatchRuntimeProjection({ game: { entityManager: { players, arena } } })
            .players.map((player) => player.mapExpansion);
    };
    const announced = { active: true, phase: 'TELEGRAPH', secondsUntilOpen: 6, label: 'Nord' };
    const inactive = { active: false, phase: 'IDLE', secondsUntilOpen: 0, label: '' };

    assert.deepEqual(projectAt(24), [announced, announced]);
    assert.deepEqual(projectAt(30), [inactive, inactive]);
});

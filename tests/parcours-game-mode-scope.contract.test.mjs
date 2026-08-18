import assert from 'node:assert/strict';
import test from 'node:test';

import { CheckpointRingRuntime } from '../src/entities/arena/portal/CheckpointRingRuntime.js';
import { KINETIC_TIDE_MAP } from '../src/core/config/maps/presets/kinetic_tide.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

function createParcoursDefinition(overrides = {}) {
    return {
        enabled: true,
        routeId: 'mode_scope_route',
        ...overrides,
        checkpoints: [
            { id: 'CP01', type: 'entry', pos: [0, 0, 0], radius: 1.2, forward: [1, 0, 0] },
            { id: 'CP02', type: 'gate', pos: [10, 0, 0], radius: 1.2, forward: [1, 0, 0] },
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [20, 0, 0], radius: 1.3, forward: [1, 0, 0] },
        rules: { ordered: true, cooldownMs: 450 },
    };
}

/**
 * Steht für Arena samt PortalGateSystem: Die Ringe hängen als schlichte Liste an der Arena,
 * genau wie PortalLayoutBuilder sie dort ablegt. Die Meshes sind Attrappen mit nur den
 * Feldern, die CheckpointRingRuntime anfasst — ein echtes THREE-Mesh bräuchte einen
 * Renderer und würde am geprüften Verhalten nichts ändern.
 */
function createHarness(parcoursDefinition, activeGameMode) {
    const arena = {
        currentMapDefinition: { parcours: parcoursDefinition },
        checkpointRings: [
            { routeIndex: 0, checkpointId: 'CP01', mesh: { visible: true, userData: {} } },
            { routeIndex: 1, checkpointId: 'CP02', mesh: { visible: true, userData: {} } },
            { routeIndex: -1, checkpointId: 'FINISH', isFinish: true, mesh: { visible: true, userData: {} } },
        ],
    };
    arena._portalGateSystem = { checkpointRingRuntime: new CheckpointRingRuntime(arena) };

    const player = { index: 0, isBot: false, alive: true, hitboxRadius: 0.8, position: { x: -1, y: 0, z: 0 } };
    const entityManager = {
        activeGameMode,
        arena,
        players: [player],
        recorder: { logEvent() {} },
        _notifyPlayerFeedback() {},
    };

    const system = new ParcoursProgressSystem(entityManager, { nowProvider: () => 0 });
    system.startRound([player]);
    return { arena, player, system };
}

function ringVisibility(arena) {
    return arena.checkpointRings.map((entry) => entry.mesh.visible);
}

test('a parcours map played in hunt keeps its route and rings out of the match', () => {
    const harness = createHarness(createParcoursDefinition(), 'HUNT');

    assert.equal(harness.system.isEnabled(), false, 'hunt does not arm the parcours route');
    assert.equal(harness.system.getPlayerHudState(0), null, 'hunt shows no parcours panel');
    assert.deepEqual(ringVisibility(harness.arena), [false, false, false], 'hunt hides the checkpoint rings');
});

test('the same map played in arcade keeps route and rings', () => {
    const harness = createHarness(createParcoursDefinition(), 'ARCADE');

    assert.equal(harness.system.isEnabled(), true, 'arcade still runs the parcours route');
    assert.ok(harness.system.getPlayerHudState(0), 'arcade still shows the parcours panel');
    assert.deepEqual(ringVisibility(harness.arena), [true, true, true], 'arcade still shows the checkpoint rings');
});

test('a map that declares hunt as a parcours mode keeps its route there', () => {
    const harness = createHarness(
        createParcoursDefinition({ gameModes: ['CLASSIC', 'HUNT', 'ARCADE'] }),
        'HUNT'
    );

    assert.equal(harness.system.isEnabled(), true, 'the declared hunt route stays armed');
    assert.deepEqual(ringVisibility(harness.arena), [true, true, true], 'the declared hunt route keeps its rings');
});

test('only the assault parcours declares hunt among the shipped routes', () => {
    assert.deepEqual(
        PARCOURS_MAPS.parcours_assault.parcours.gameModes,
        ['CLASSIC', 'HUNT', 'ARCADE'],
        'the assault parcours is authored as a combat route'
    );
    assert.equal(
        KINETIC_TIDE_MAP.kinetic_tide.parcours.gameModes,
        undefined,
        'an adventure map that also carries a route stays a parcours-mode-only route'
    );
});

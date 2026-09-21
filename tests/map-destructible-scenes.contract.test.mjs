import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    MAP_DESTRUCTIBLE_LIMITS,
    applyMapDestructibleDamage,
    applyMapDestructibleNetworkState,
    createMapDestructibleState,
    normalizeMapDestructibles,
    serializeMapDestructibleState,
    resolveMapDestructibleBreakScene,
    resolveMapDestructibleSceneTimeline,
} from '../src/shared/contracts/MapDestructibleContract.js';

const SEGMENTS = [
    { id: 'leg_a', kind: 'leg_lower', hp: 40, meshPrefixes: ['tower_leg_a'], anchor: [10, 0, 10] },
    { id: 'summit', kind: 'summit', hp: 10, meshPrefixes: ['tower_summit'] },
];

// The heading the Eiffel scenes are baked falling towards: world (+X, -Z), read as atan2(x, z).
const BAKED_HEADING = Math.atan2(1, -1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Where the baked fall points after the slot has been turned by the timeline's yaw. */
function fallDirection(yaw) {
    return new THREE.Vector3(1, 0, -1).normalize().applyAxisAngle(Y_AXIS, yaw);
}

/** Angles are compared the short way round, so 0 and 2pi read as the same turn. */
function assertHeading(actual, expected, message) {
    let delta = (actual - expected) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    assert.ok(Math.abs(delta) < 1e-9, `${message}: ${actual} is not ${expected}`);
}

function assertFallsTowards(yaw, x, z, message) {
    const direction = fallDirection(yaw);
    const expected = new THREE.Vector3(x, 0, z).normalize();
    assert.ok(
        direction.distanceTo(expected) < 1e-6,
        `${message}: falls towards (${direction.x.toFixed(3)}, ${direction.z.toFixed(3)})`,
    );
}

function towerWithScenes(overrides = {}) {
    return normalizeMapDestructibles({
        segments: SEGMENTS,
        pieces: ['lower', 'mid', 'shaft', 'summit'],
        breakScenes: [
            {
                id: 'summit_kind',
                trigger: { kind: 'summit' },
                modelId: 'eiffel-fall-summit-generic',
                pieces: ['summit'],
            },
            {
                id: 'summit_exact',
                trigger: { segmentId: 'summit' },
                modelId: 'eiffel-fall-summit',
                pieces: ['summit'],
                hideModelIds: ['eiffel-summit'],
            },
            {
                id: 'topple_lower',
                trigger: { kind: 'leg_lower' },
                modelId: 'eiffel-fall-lower',
                pieces: ['lower', 'mid', 'shaft', 'summit'],
                hideModelIds: ['eiffel-legs-lower', 'eiffel-shaft', 'eiffel-summit'],
            },
        ],
        ...overrides,
    });
}

test('a map without break scenes still normalizes into a usable definition', () => {
    const plain = normalizeMapDestructibles({ segments: SEGMENTS });
    assert.deepEqual([...(plain?.pieces ?? ['x'])], []);
    assert.deepEqual([...(plain?.breakScenes ?? ['x'])], []);
    assert.equal(resolveMapDestructibleBreakScene(plain, { segmentId: 'summit', kind: 'summit' }), null);
    assert.deepEqual(resolveMapDestructibleSceneTimeline(plain, [{ segmentId: 'summit', kind: 'summit' }]), []);
});

test('scene normalization keeps what can play and drops what cannot', () => {
    const definition = normalizeMapDestructibles({
        segments: SEGMENTS,
        pieces: ['  lower  ', 'lower', '', 42, 'summit'],
        breakScenes: [
            'not an object',
            { trigger: { kind: 'leg_lower' } },
            { trigger: {}, modelId: 'no-trigger' },
            { trigger: { kind: 'rubble' }, modelId: 'unknown-kind' },
            // Naming both would leave two readings of the same event, so it is refused.
            { trigger: { kind: 'summit', segmentId: 'summit' }, modelId: 'ambiguous' },
            { trigger: 'summit', modelId: 'trigger-not-an-object' },
            {
                id: '  keeper  ',
                trigger: { segmentId: '  summit  ' },
                modelId: '  eiffel-fall-summit  ',
                pieces: ['summit', 'summit', 'mid', 7],
                hideModelIds: ['  eiffel-summit  ', 'eiffel-summit', ''],
                yawFromEvent: false,
            },
            { id: 'keeper', trigger: { kind: 'leg_lower' }, modelId: 'duplicate-id' },
            { trigger: { kind: 'leg_mid' }, modelId: 'fallback-id' },
        ],
    });

    assert.ok(definition);
    // Trimmed, de-duplicated, and the non-string entry is gone.
    assert.deepEqual([...definition.pieces], ['lower', 'summit']);
    assert.deepEqual(definition.breakScenes.map((scene) => scene.id), ['keeper', 'break_scene_8']);

    const keeper = definition.breakScenes[0];
    assert.deepEqual({ ...keeper.trigger }, { kind: '', segmentId: 'summit' });
    assert.equal(keeper.modelId, 'eiffel-fall-summit');
    // 'mid' is not one of the map's pieces, so it cannot be animated by a scene.
    assert.deepEqual([...keeper.pieces], ['summit']);
    assert.deepEqual([...keeper.hideModelIds], ['eiffel-summit']);
    assert.equal(keeper.yawFromEvent, false);
    assert.equal(definition.breakScenes[1].yawFromEvent, true);
    assert.deepEqual({ ...definition.breakScenes[1].trigger }, { kind: 'leg_mid', segmentId: '' });
    assert.equal(Object.isFrozen(definition.breakScenes), true);
    assert.equal(Object.isFrozen(keeper), true);
});

test('pieces and scenes are capped instead of growing without bound', () => {
    const definition = normalizeMapDestructibles({
        segments: SEGMENTS,
        pieces: Array.from({ length: 30 }, (_value, index) => `piece_${index}`),
        breakScenes: Array.from({ length: 30 }, (_value, index) => ({
            id: `scene_${index}`,
            trigger: { kind: 'leg_mid' },
            modelId: `model_${index}`,
            hideModelIds: Array.from({ length: 30 }, (_entry, hidden) => `hide_${hidden}`),
        })),
    });

    assert.equal(definition?.pieces.length, MAP_DESTRUCTIBLE_LIMITS.maxPieces);
    assert.equal(definition?.breakScenes.length, MAP_DESTRUCTIBLE_LIMITS.maxBreakScenes);
    assert.equal(definition?.breakScenes[0].hideModelIds.length, MAP_DESTRUCTIBLE_LIMITS.maxHideModelIds);
});

test('a scene that names the exact segment beats one that only names the kind', () => {
    const definition = towerWithScenes();

    // The generic summit scene is listed first and still loses.
    assert.equal(
        resolveMapDestructibleBreakScene(definition, { segmentId: 'summit', kind: 'summit' })?.id,
        'summit_exact',
    );
    // A different segment of the same kind falls back to the generic scene.
    assert.equal(
        resolveMapDestructibleBreakScene(definition, { segmentId: 'antenna', kind: 'summit' })?.id,
        'summit_kind',
    );
    assert.equal(
        resolveMapDestructibleBreakScene(definition, { segmentId: 'leg_a', kind: 'leg_lower' })?.id,
        'topple_lower',
    );
    assert.equal(resolveMapDestructibleBreakScene(definition, { segmentId: 'mid_a', kind: 'leg_mid' }), null);
    assert.equal(resolveMapDestructibleBreakScene(definition, { kind: 'nonsense' }), null);
    assert.equal(resolveMapDestructibleBreakScene(definition, 'summit'), null);
    assert.equal(resolveMapDestructibleBreakScene(null, { kind: 'summit' }), null);
});

test('a piece that already fell is hidden in every later scene', () => {
    const definition = towerWithScenes();
    const timeline = resolveMapDestructibleSceneTimeline(definition, [
        { segmentId: 'summit', kind: 'summit', atSeconds: 12.5, yaw: Math.PI },
        // No scene answers a mid leg on this map, so the event leaves no trace.
        { segmentId: 'mid_a', kind: 'leg_mid', atSeconds: 15, yaw: 0 },
        { segmentId: 'leg_a', kind: 'leg_lower', atSeconds: 20, yaw: Math.PI / 2 },
    ]);

    assert.equal(timeline.length, 2);
    assert.deepEqual(timeline[0], {
        sceneId: 'summit_exact',
        modelId: 'eiffel-fall-summit',
        atSeconds: 12.5,
        yaw: Math.PI,
        yawFromEvent: true,
        hideModelIds: ['eiffel-summit'],
        attachedModels: [],
        hiddenPieceIds: [],
    });
    // The summit is already lying on the esplanade, so the toppling tower must not carry it.
    assert.deepEqual(timeline[1].hiddenPieceIds, ['summit']);
    assert.equal(timeline[1].sceneId, 'topple_lower');
    assert.equal(timeline[1].atSeconds, 20);
    assert.equal(timeline[1].yaw, Math.PI / 2);
});

test('the timeline keeps its order and reads nothing but the events it is given', () => {
    const definition = towerWithScenes();
    const events = [
        { segmentId: 'leg_a', kind: 'leg_lower', atSeconds: 4, yaw: 0 },
        { segmentId: 'summit', kind: 'summit', atSeconds: 9, yaw: 1 },
    ];

    const first = resolveMapDestructibleSceneTimeline(definition, events);
    const second = resolveMapDestructibleSceneTimeline(definition, events);
    assert.deepEqual(first, second);
    // The tower went first here, so it carries the summit and the later summit scene has
    // nothing left to hide - the opposite of the run above, from the same two events.
    assert.deepEqual(first.map((entry) => entry.sceneId), ['topple_lower', 'summit_exact']);
    assert.deepEqual(first[0].hiddenPieceIds, []);
    assert.deepEqual(first[1].hiddenPieceIds, ['summit']);
});

test('a scene is turned from where it was baked onto where the break points', () => {
    // The whole point of the baked heading: one clip, authored falling one way, serves every leg
    // and every shot direction. Without it the tower would land 135 degrees off its own corner.
    const definition = normalizeMapDestructibles({
        pieces: ['lower', 'shaft'],
        segments: [
            { id: 'leg_se', kind: 'leg_lower', hp: 10, meshPrefixes: ['legs_lower'], anchor: [37.5, 0, -37.5] },
            { id: 'leg_ne', kind: 'leg_lower', hp: 10, meshPrefixes: ['legs_lower'], anchor: [37.5, 0, 37.5] },
            { id: 'shaft', kind: 'shaft', hp: 10, meshPrefixes: ['shaft_iron'] },
        ],
        breakScenes: [
            { id: 'topple_lower', trigger: { kind: 'leg_lower' }, modelId: 'topple-lower', pieces: ['lower'], bakedHeading: BAKED_HEADING },
            { id: 'topple_shaft', trigger: { kind: 'shaft' }, modelId: 'topple-shaft', pieces: ['shaft'], bakedHeading: BAKED_HEADING },
        ],
    });
    assert.equal(definition?.breakScenes[0].bakedHeading, BAKED_HEADING);

    const breakYaw = (segmentId, hitDirection) => {
        const state = createMapDestructibleState(definition);
        applyMapDestructibleDamage(state, definition, segmentId, 10, { atSeconds: 5, hitDirection });
        return resolveMapDestructibleSceneTimeline(definition, state.events)[0].yaw;
    };

    // A shot flying towards +X throws the shaft towards +X, away from the shooter.
    assertFallsTowards(breakYaw('shaft', { x: 1, y: 0, z: 0 }), 1, 0, 'a shaft hit from -X');
    assertFallsTowards(breakYaw('shaft', { x: 0, y: 0, z: -1 }), 0, -1, 'a shaft hit from +Z');

    // The south-eastern leg stands exactly where the clip already falls, so nothing is turned.
    assertHeading(breakYaw('leg_se'), 0, 'the SE leg needs no turn');
    assertFallsTowards(breakYaw('leg_se'), 1, -1, 'the SE leg');
    // The north-eastern leg is three quarter turns away from it, counted inside [0, 2pi).
    assertFallsTowards(breakYaw('leg_ne'), 1, 1, 'the NE leg');
    assertHeading(breakYaw('leg_ne'), (3 * Math.PI) / 2, 'the NE leg');
    assert.ok(breakYaw('leg_ne') >= 0 && breakYaw('leg_ne') < Math.PI * 2, 'yaw stays inside [0, 2pi)');

    // A scene that names no baked heading is read as falling towards +Z, so it turns by the
    // heading itself - the behaviour every map without a baked clip still relies on.
    const plain = normalizeMapDestructibles({
        pieces: ['shaft'],
        segments: [{ id: 'shaft', kind: 'shaft', hp: 10, meshPrefixes: ['shaft_iron'] }],
        breakScenes: [{ id: 'fall', trigger: { kind: 'shaft' }, modelId: 'fall', pieces: ['shaft'] }],
    });
    assert.equal(plain?.breakScenes[0].bakedHeading, 0);
    const plainState = createMapDestructibleState(plain);
    applyMapDestructibleDamage(plainState, plain, 'shaft', 10, { hitDirection: { x: 1, y: 0, z: 0 } });
    assert.equal(resolveMapDestructibleSceneTimeline(plain, plainState.events)[0].yaw, Math.PI / 2);
});

test('a baked heading is folded into one range however the preset writes it', () => {
    const headingOf = (bakedHeading) => normalizeMapDestructibles({
        segments: SEGMENTS,
        pieces: ['summit'],
        breakScenes: [{ id: 'fall', trigger: { kind: 'summit' }, modelId: 'fall', bakedHeading }],
    })?.breakScenes[0].bakedHeading;

    assert.equal(headingOf(undefined), 0);
    assert.equal(headingOf('nonsense'), 0);
    assert.equal(headingOf(0), 0);
    assertHeading(headingOf(-Math.PI / 2), (3 * Math.PI) / 2, 'a negative heading folds forward');
    assertHeading(headingOf(Math.PI * 2.5), Math.PI / 2, 'more than a full turn folds back');
    assertHeading(headingOf(-Math.PI * 4), 0, 'two full turns back are no turn');
    for (const value of [-Math.PI / 2, Math.PI * 2.5, -Math.PI * 4, 3]) {
        const folded = headingOf(value);
        assert.ok(folded >= 0 && folded < Math.PI * 2, `${value} folds into [0, 2pi)`);
    }
});

test('a collapse takes every segment standing in the pieces it carries away', () => {
    // The summit sits on the shaft. Once the shaft is falling, the summit is gone with it - it
    // must not stay in the state as something a player could still shoot at.
    const definition = normalizeMapDestructibles({
        pieces: ['shaft', 'summit'],
        segments: [
            { id: 'shaft', kind: 'shaft', hp: 20, meshPrefixes: ['shaft_iron'] },
            { id: 'summit', kind: 'summit', hp: 20, meshPrefixes: ['summit_iron'] },
        ],
        breakScenes: [
            { id: 'topple_shaft', trigger: { kind: 'shaft' }, modelId: 'topple-shaft', pieces: ['shaft', 'summit'] },
        ],
    });
    const state = createMapDestructibleState(definition);
    applyMapDestructibleDamage(state, definition, 'summit', 12, { atSeconds: 3 });
    applyMapDestructibleDamage(state, definition, 'shaft', 20, { atSeconds: 7 });

    const [shaft, summit] = state.segments;
    assert.equal(shaft.destroyed, true);
    assert.equal(shaft.collapsed, false, 'the shaft was shot, not carried away');
    assert.equal(summit.destroyed, true);
    assert.equal(summit.collapsed, true);
    assert.equal(summit.hp, 0);
    assert.equal(summit.destroyedAtSeconds, 7);
    // One break, one scene: the summit rides the shaft's collapse rather than starting its own.
    assert.equal(state.events.length, 1);
    assert.equal(resolveMapDestructibleSceneTimeline(definition, state.events).length, 1);

    // Nothing is left to shoot at, and a second hit on the summit changes nothing.
    assert.equal(applyMapDestructibleDamage(state, definition, 'summit', 5, { atSeconds: 8 }).applied, false);

    // A replica has to learn that the summit is gone, not just that the shaft broke.
    const replica = createMapDestructibleState(definition);
    applyMapDestructibleNetworkState(replica, JSON.parse(JSON.stringify(serializeMapDestructibleState(state))));
    assert.deepEqual(serializeMapDestructibleState(replica), serializeMapDestructibleState(state));
    assert.equal(replica.segments[1].collapsed, true);

    // A scene without pieces carries nothing away, so the rest of the tower stays up.
    const loose = normalizeMapDestructibles({
        pieces: ['shaft', 'summit'],
        segments: [
            { id: 'shaft', kind: 'shaft', hp: 20, meshPrefixes: ['shaft_iron'] },
            { id: 'summit', kind: 'summit', hp: 20, meshPrefixes: ['summit_iron'] },
        ],
        breakScenes: [{ id: 'topple_shaft', trigger: { kind: 'shaft' }, modelId: 'topple-shaft' }],
    });
    const looseState = createMapDestructibleState(loose);
    applyMapDestructibleDamage(looseState, loose, 'shaft', 20, { atSeconds: 2 });
    assert.equal(looseState.segments[1].destroyed, false);
});

test('junk events and junk timings never reach the runtime', () => {
    const definition = towerWithScenes();
    const timeline = resolveMapDestructibleSceneTimeline(definition, [
        'nope',
        null,
        { segmentId: 'summit', kind: 'summit' },
    ]);

    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].atSeconds, 0);
    assert.equal(timeline[0].yaw, 0);
    assert.deepEqual(resolveMapDestructibleSceneTimeline(definition, 'nope'), []);
    assert.deepEqual(resolveMapDestructibleSceneTimeline(null, []), []);
});

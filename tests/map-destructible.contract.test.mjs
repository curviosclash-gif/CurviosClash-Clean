import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAP_DESTRUCTIBLE_DAMAGE,
    MAP_DESTRUCTIBLE_HUD,
    MAP_DESTRUCTIBLE_KINDS,
    MAP_DESTRUCTIBLE_LIMITS,
    applyMapDestructibleDamage,
    applyMapDestructibleNetworkState,
    createMapDestructibleState,
    isMapDestructibleModeAllowed,
    normalizeMapDestructibles,
    resolveMapDestructibleHudState,
    resolveMapDestructibleKindRule,
    resolveMapDestructibleSegmentByHit,
    resolveMapDestructibleSegmentByMeshName,
    serializeMapDestructibleState,
} from '../src/shared/contracts/MapDestructibleContract.js';

// Four legs of an intact tower: the GLB exports one mesh per material, so every leg answers to
// the same names and only the anchor - the foot of the leg - tells them apart.
function fourLegDefinition(anchorScale = 1) {
    const legs = [
        { id: 'leg_pp', anchor: [10, 0, 10] },
        { id: 'leg_pm', anchor: [10, 0, -10] },
        { id: 'leg_mp', anchor: [-10, 0, 10] },
        { id: 'leg_mm', anchor: [-10, 0, -10] },
    ];
    return normalizeMapDestructibles({
        segments: legs.map((leg, index) => ({
            id: leg.id,
            label: `Bein ${index + 1}`,
            kind: 'leg_lower',
            hp: 100,
            meshPrefixes: ['legs_lower_iron', 'legs_lower_irondark'],
            anchor: leg.anchor.map((axis) => axis * anchorScale),
        })),
    });
}

function towerDefinition() {
    return normalizeMapDestructibles({
        segments: [
            { id: 'leg_a', label: 'Bein A', kind: 'leg_lower', hp: 40, meshPrefixes: ['Tower_Leg_A'], anchor: [10, 0, 10] },
            { id: 'leg_b', label: 'Bein B', kind: 'leg_lower', hp: 40, meshPrefixes: ['Tower_Leg_B'], anchor: [-10, 0, 10] },
            { id: 'mid_a', label: 'Mitte A', kind: 'leg_mid', hp: 30, meshPrefixes: ['tower_mid_a'], anchor: [-5, 0, -5] },
            { id: 'shaft', label: 'Schaft', kind: 'shaft', hp: 25, meshPrefixes: ['tower_shaft'] },
            { id: 'summit', label: 'Spitze', kind: 'summit', hp: 10, meshPrefixes: ['tower_summit'] },
        ],
    });
}

test('kind rules seal only for a lower leg and pick the yaw source per kind', () => {
    assert.equal(MAP_DESTRUCTIBLE_KINDS.leg_lower.sealsTower, true);
    assert.equal(MAP_DESTRUCTIBLE_KINDS.leg_mid.sealsTower, false);
    assert.equal(MAP_DESTRUCTIBLE_KINDS.shaft.sealsTower, false);
    assert.equal(MAP_DESTRUCTIBLE_KINDS.summit.sealsTower, false);
    assert.equal(MAP_DESTRUCTIBLE_KINDS.landmark.sealsTower, true);
    assert.equal(MAP_DESTRUCTIBLE_KINDS.leg_lower.yawFrom, 'segment');
    assert.equal(MAP_DESTRUCTIBLE_KINDS.leg_mid.yawFrom, 'segment');
    assert.equal(MAP_DESTRUCTIBLE_KINDS.shaft.yawFrom, 'hit');
    assert.equal(MAP_DESTRUCTIBLE_KINDS.summit.yawFrom, 'hit');
    assert.equal(MAP_DESTRUCTIBLE_KINDS.landmark.yawFrom, 'hit');
    // Each kind names the piece of the tower it stands in, so a collapse knows what it takes along.
    assert.deepEqual(
        Object.values(MAP_DESTRUCTIBLE_KINDS).map((rule) => rule.piece),
        ['lower', 'mid', 'shaft', 'summit', 'masonry', 'landmark'],
    );
    assert.equal(MAP_DESTRUCTIBLE_KINDS.masonry.sealsTower, false);
    assert.equal(resolveMapDestructibleKindRule('masonry'), MAP_DESTRUCTIBLE_KINDS.masonry);
    assert.equal(MAP_DESTRUCTIBLE_DAMAGE.MG, 5);
    assert.equal(resolveMapDestructibleKindRule('nope'), null);
    assert.equal(resolveMapDestructibleKindRule(7), null);
    assert.equal(resolveMapDestructibleKindRule('shaft'), MAP_DESTRUCTIBLE_KINDS.shaft);
    assert.equal(resolveMapDestructibleKindRule('landmark'), MAP_DESTRUCTIBLE_KINDS.landmark);
});

test('normalization clamps, trims and drops what can never be hit', () => {
    const definition = normalizeMapDestructibles({
        segments: [
            {
                id: `  ${'x'.repeat(200)}  `,
                kind: 'leg_lower',
                hp: 1e9,
                meshPrefixes: ['  Leg_A  ', '', 42, 'leg_a', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
                piece: '  Lower  ',
                anchor: [99999, 'nope', -99999, 12],
            },
            { id: 'no_kind', kind: 'rubble', meshPrefixes: ['rubble'] },
            { id: 'no_prefix', kind: 'shaft', meshPrefixes: [] },
            { id: 'dupe', kind: 'shaft', hp: -5, meshPrefixes: ['dupe'] },
            { id: ' dupe ', kind: 'summit', meshPrefixes: ['dupe_two'] },
            'not an object',
            { kind: 'summit', meshPrefixes: ['fallback_id'] },
        ],
    });

    assert.ok(definition);
    // An unknown kind, a segment without mesh prefixes, a repeated id and a non-object are gone.
    assert.deepEqual(definition.segments.map((segment) => segment.id.slice(0, 12)), [
        'xxxxxxxxxxxx',
        'dupe',
        'destructible',
    ]);

    const first = definition.segments[0];
    assert.equal(first.id.length, MAP_DESTRUCTIBLE_LIMITS.idMaxLength);
    assert.equal(first.label.length, MAP_DESTRUCTIBLE_LIMITS.labelMaxLength);
    assert.equal(first.hp, MAP_DESTRUCTIBLE_LIMITS.hp.max);
    // An authored piece is trimmed and lower-cased like every other id in this contract.
    assert.equal(first.piece, 'lower');
    assert.deepEqual([...first.anchor], [4000, 0, -4000]);
    assert.deepEqual([...first.meshPrefixes], ['leg_a', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
    assert.equal(definition.segments[1].hp, MAP_DESTRUCTIBLE_LIMITS.hp.min);
    assert.equal(definition.segments[2].id, 'destructible_6');
    assert.equal(Object.isFrozen(definition.segments), true);
    assert.equal(Object.isFrozen(first), true);
});

test('normalization caps the segment count and reports an empty block as null', () => {
    const segments = Array.from({ length: 20 }, (_value, index) => ({
        id: `seg_${index}`,
        kind: 'shaft',
        meshPrefixes: [`seg_${index}`],
    }));
    const definition = normalizeMapDestructibles({ segments });
    assert.equal(definition?.segments.length, MAP_DESTRUCTIBLE_LIMITS.maxSegments);

    assert.equal(normalizeMapDestructibles(null), null);
    assert.equal(normalizeMapDestructibles({ segments: 'nope' }), null);
    assert.equal(normalizeMapDestructibles({ segments: [{ id: 'a', kind: 'shaft' }] }), null);
    assert.equal(normalizeMapDestructibles([]), null);
});

test('default hp, piece and anchor apply when the preset states none', () => {
    const definition = normalizeMapDestructibles({
        segments: [
            { id: 'shaft', kind: 'shaft', meshPrefixes: ['shaft'] },
            { id: 'leg', kind: 'leg_mid', meshPrefixes: ['leg'] },
        ],
    });
    assert.equal(definition?.segments[0].hp, MAP_DESTRUCTIBLE_LIMITS.hp.fallback);
    // The piece a segment stands in follows from its kind, so a preset only states the exceptions.
    assert.equal(definition?.segments[0].piece, 'shaft');
    assert.equal(definition?.segments[1].piece, 'mid');
    assert.deepEqual([...(definition?.segments[0].anchor ?? [])], [0, 0, 0]);
});

test('a map may restrict which modes its geometry can be shot apart in', () => {
    const everywhere = towerDefinition();
    assert.deepEqual([...everywhere.gameModes], []);
    // No list at all means every mode, including one nobody asked about.
    assert.equal(isMapDestructibleModeAllowed(everywhere, 'CLASSIC'), true);
    assert.equal(isMapDestructibleModeAllowed(everywhere, ''), true);
    assert.equal(isMapDestructibleModeAllowed(null, 'HUNT'), true);

    const huntOnly = normalizeMapDestructibles({
        gameModes: ['  hunt  ', 'HUNT', '', 42, 'Arcade'],
        segments: [{ id: 'shaft', kind: 'shaft', meshPrefixes: ['shaft_iron'] }],
    });
    // Trimmed, upper-cased and de-duplicated, and the junk entries are gone.
    assert.deepEqual([...(huntOnly?.gameModes ?? [])], ['HUNT', 'ARCADE']);
    assert.equal(Object.isFrozen(huntOnly?.gameModes), true);
    assert.equal(isMapDestructibleModeAllowed(huntOnly, 'hunt'), true);
    assert.equal(isMapDestructibleModeAllowed(huntOnly, 'ARCADE'), true);
    assert.equal(isMapDestructibleModeAllowed(huntOnly, 'CLASSIC'), false);
    // A stated list needs a known mode: without one the map stays whole rather than breakable.
    assert.equal(isMapDestructibleModeAllowed(huntOnly, ''), false);
    assert.equal(isMapDestructibleModeAllowed(huntOnly, null), false);

    const capped = normalizeMapDestructibles({
        gameModes: Array.from({ length: 20 }, (_value, index) => `mode_${index}`),
        segments: [{ id: 'shaft', kind: 'shaft', meshPrefixes: ['shaft_iron'] }],
    });
    assert.equal(capped?.gameModes.length, MAP_DESTRUCTIBLE_LIMITS.maxGameModes);
});

test('mesh names resolve case-insensitively and the longest prefix wins', () => {
    const definition = normalizeMapDestructibles({
        segments: [
            { id: 'leg', kind: 'leg_lower', meshPrefixes: ['tower_leg'] },
            { id: 'leg_lower_a', kind: 'leg_lower', meshPrefixes: ['tower_leg_a_lower'] },
        ],
    });

    assert.equal(resolveMapDestructibleSegmentByMeshName(definition, 'TOWER_LEG_B_MID_01')?.id, 'leg');
    assert.equal(resolveMapDestructibleSegmentByMeshName(definition, 'Tower_Leg_A_Lower_003')?.id, 'leg_lower_a');
    assert.equal(resolveMapDestructibleSegmentByMeshName(definition, 'ground_plane'), null);
    assert.equal(resolveMapDestructibleSegmentByMeshName(definition, '   '), null);
    assert.equal(resolveMapDestructibleSegmentByMeshName(definition, 17), null);
    assert.equal(resolveMapDestructibleSegmentByMeshName(null, 'tower_leg'), null);
});

test('damage destroys a leg onto its own corner and seals the tower', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);
    assert.equal(state.sealed, false);
    assert.equal(state.segments[1].hp, 40);
    assert.equal(state.segments[1].destroyedAtSeconds, -1);

    const partial = applyMapDestructibleDamage(state, definition, 'leg_b', 15, { atSeconds: 4 });
    assert.equal(partial.applied, true);
    assert.equal(partial.destroyed, false);
    assert.equal(partial.event, null);
    assert.equal(state.segments[1].hp, 25);
    assert.equal(state.sealed, false);

    const killing = applyMapDestructibleDamage(state, definition, 'leg_b', 1000, { atSeconds: 9.5 });
    assert.equal(killing.destroyed, true);
    assert.equal(killing.event?.kind, 'leg_lower');
    assert.equal(killing.event?.segmentId, 'leg_b');
    assert.equal(killing.event?.atSeconds, 9.5);
    // The leg stands at (-10, 10), so the tower comes down onto that corner: atan2(-10, 10).
    assert.equal(killing.event?.yaw, -Math.PI / 4);
    assert.equal(state.segments[1].hp, 0);
    assert.equal(state.segments[1].destroyed, true);
    assert.equal(state.segments[1].destroyedAtSeconds, 9.5);
    assert.equal(state.sealed, true);
    assert.equal(state.events.length, 1);
});

test('a mid leg break does not seal, and shaft and summit take the yaw from the hit', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);

    const mid = applyMapDestructibleDamage(state, definition, 'mid_a', 30, {
        atSeconds: -3,
        hitDirection: { x: 1, y: 0, z: 0 },
    });
    assert.equal(mid.destroyed, true);
    // A leg follows its own corner (-5, -5), never the shot that felled it.
    assert.equal(mid.event?.yaw, Math.atan2(-5, -5));
    assert.equal(mid.event?.atSeconds, 0);
    assert.equal(state.sealed, false);

    const shaft = applyMapDestructibleDamage(state, definition, 'shaft', 25, {
        atSeconds: 12,
        hitDirection: { x: 1, y: 5, z: 0 },
    });
    assert.equal(shaft.event?.yaw, Math.PI / 2);

    const summit = applyMapDestructibleDamage(state, definition, 'summit', 10, {
        atSeconds: 13,
        hitDirection: [0, -1, 0],
    });
    assert.equal(summit.event?.yaw, 0);
    assert.equal(state.events.map((event) => event.segmentId).join(','), 'mid_a,shaft,summit');
});

test('damage is ignored after the seal, on destroyed segments and for junk input', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);

    assert.equal(applyMapDestructibleDamage(state, definition, 'nope', 10).applied, false);
    assert.equal(applyMapDestructibleDamage(state, definition, '', 10).applied, false);
    assert.equal(applyMapDestructibleDamage(state, definition, 7, 10).applied, false);
    assert.equal(applyMapDestructibleDamage(state, definition, 'shaft', 0).applied, false);
    assert.equal(applyMapDestructibleDamage(state, definition, 'shaft', -5).applied, false);
    assert.equal(applyMapDestructibleDamage(state, definition, 'shaft', 'viel').applied, false);
    assert.equal(applyMapDestructibleDamage(null, definition, 'shaft', 5).applied, false);
    assert.equal(state.segments[3].hp, 25);

    applyMapDestructibleDamage(state, definition, 'shaft', 25, { atSeconds: 1 });
    assert.equal(applyMapDestructibleDamage(state, definition, 'shaft', 25).applied, false);

    applyMapDestructibleDamage(state, definition, 'leg_a', 40, { atSeconds: 2 });
    assert.equal(state.sealed, true);
    assert.equal(applyMapDestructibleDamage(state, definition, 'summit', 10).applied, false);
    assert.equal(state.segments[4].hp, 10);
    assert.equal(state.events.length, 2);
});

test('a segment the definition does not describe falls back to hit-derived yaw', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);
    state.segments.push({ id: 'ghost', hp: 5, maxHp: 5, destroyed: false, destroyedAtSeconds: -1, yaw: 0 });

    const result = applyMapDestructibleDamage(state, definition, 'ghost', 5, {
        hitDirection: { x: 0, z: -1 },
    });
    assert.equal(result.destroyed, true);
    assert.equal(result.event?.kind, 'shaft');
    assert.equal(result.event?.yaw, Math.PI);
});

test('serialize and apply round trip without loss', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);
    applyMapDestructibleDamage(state, definition, 'shaft', 10, { atSeconds: 3 });
    applyMapDestructibleDamage(state, definition, 'summit', 10, { atSeconds: 6, hitDirection: { x: -1, z: 0 } });
    applyMapDestructibleDamage(state, definition, 'leg_a', 40, { atSeconds: 8 });

    const wire = JSON.parse(JSON.stringify(serializeMapDestructibleState(state)));
    const replica = createMapDestructibleState(definition);
    applyMapDestructibleNetworkState(replica, wire);

    assert.deepEqual(serializeMapDestructibleState(replica), serializeMapDestructibleState(state));
    assert.equal(replica.sealed, true);
    assert.equal(replica.events.length, 2);

    // Applying the same wire block twice must not accumulate.
    applyMapDestructibleNetworkState(replica, wire);
    assert.deepEqual(serializeMapDestructibleState(replica), serializeMapDestructibleState(state));
});

test('network state ignores junk entries and an empty payload clears the tower', () => {
    const definition = towerDefinition();
    const replica = createMapDestructibleState(definition);
    applyMapDestructibleNetworkState(replica, {
        sealed: 'yes',
        segments: [
            'nope',
            { id: '   ' },
            { id: 'shaft', hp: 9999, maxHp: 25, destroyed: false, yaw: 'links' },
            { id: 'summit', hp: 7, maxHp: 10, destroyed: true, destroyedAtSeconds: -4, yaw: 1 },
        ],
        events: [
            'nope',
            { segmentId: 'summit', kind: 'unknown', atSeconds: 2, yaw: 1 },
            { segmentId: '', kind: 'summit', atSeconds: 2, yaw: 1 },
            { segmentId: 'summit', kind: 'summit', atSeconds: 'spaet', yaw: 1 },
        ],
    });

    assert.equal(replica.sealed, false);
    assert.equal(replica.segments.length, 2);
    assert.equal(replica.segments[0].hp, 25);
    assert.equal(replica.segments[0].destroyedAtSeconds, -1);
    assert.equal(replica.segments[0].yaw, 0);
    assert.equal(replica.segments[1].hp, 0);
    assert.equal(replica.segments[1].destroyedAtSeconds, 0);
    assert.equal(replica.events.length, 1);
    assert.equal(replica.events[0].atSeconds, 0);

    applyMapDestructibleNetworkState(replica, null);
    assert.deepEqual(serializeMapDestructibleState(replica), { sealed: false, segments: [], events: [] });
    assert.equal(serializeMapDestructibleState(null).segments.length, 0);
});

test('hud projection reports labels and remaining ratios', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);
    applyMapDestructibleDamage(state, definition, 'shaft', 5, { atSeconds: 2 });

    const hud = resolveMapDestructibleHudState(state, definition, 2);
    assert.equal(hud.active, true);
    assert.equal(hud.sealed, false);
    assert.equal(hud.segments.length, 5);
    assert.equal(hud.segments[0].label, 'Bein A');
    assert.equal(hud.segments[0].ratio, 1);
    assert.equal(hud.segments[3].ratio, 0.8);

    applyMapDestructibleDamage(state, definition, 'leg_a', 40, { atSeconds: 4 });
    assert.equal(resolveMapDestructibleHudState(state, definition, 4).sealed, true);

    const empty = resolveMapDestructibleHudState(createMapDestructibleState(null), null);
    assert.deepEqual(empty, {
        active: false,
        sealed: false,
        focusSegment: null,
        breakingSecondsRemaining: 0,
        segments: [],
    });

    const orphan = resolveMapDestructibleHudState({
        segments: [{ id: 'orphan', hp: 5, maxHp: 0, destroyed: false, destroyedAtSeconds: -1, yaw: 0 }],
        events: [],
        sealed: false,
    }, definition);
    assert.equal(orphan.segments[0].label, 'orphan');
    assert.equal(orphan.segments[0].ratio, 0);
});

test('a hit tells identically named legs apart by the nearest anchor', () => {
    const definition = fourLegDefinition();

    const nearest = (point) => resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', point)?.id;
    assert.equal(nearest([9, 30, 8]), 'leg_pp');
    assert.equal(nearest({ x: 12, y: 5, z: -11 }), 'leg_pm');
    assert.equal(nearest([-30, 0, 4]), 'leg_mp');
    assert.equal(nearest({ x: -6, y: 60, z: -40 }), 'leg_mm');
    // The second material of the same part resolves exactly like the first.
    assert.equal(
        resolveMapDestructibleSegmentByHit(definition, 'legs_lower_irondark_001', [9, 30, 8])?.id,
        'leg_pp',
    );

    // Without a usable point the first matching segment answers, exactly like by mesh name.
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron')?.id, 'leg_pp');
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', 'nope')?.id, 'leg_pp');
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', { x: 'a' })?.id, 'leg_pp');
    assert.equal(resolveMapDestructibleSegmentByMeshName(definition, 'legs_lower_iron')?.id, 'leg_pp');

    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'ground', [0, 0, 0]), null);
    assert.equal(resolveMapDestructibleSegmentByHit(null, 'legs_lower_iron', [0, 0, 0]), null);
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 42, [0, 0, 0]), null);

    // Equal distance keeps the declaration order.
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', [0, 0, 0])?.id, 'leg_pp');
});

test('a scaled map measures the hit against scaled anchors', () => {
    // Two segments on the same axis; at map scale 3 their feet stand at 30 and 90 instead of
    // 10 and 30, so one and the same impact belongs to a different one of them.
    const definition = normalizeMapDestructibles({
        segments: [
            { id: 'near', kind: 'leg_lower', meshPrefixes: ['legs_lower'], anchor: [10, 0, 0] },
            { id: 'far', kind: 'leg_lower', meshPrefixes: ['legs_lower'], anchor: [30, 0, 0] },
        ],
    });
    const hit = [40, 0, 0];

    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', hit, 1)?.id, 'far');
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', hit, 3)?.id, 'near');
    // Anchors authored at the built size and a factor of 3 come out the same way.
    assert.equal(
        resolveMapDestructibleSegmentByHit(fourLegDefinition(3), 'legs_lower_iron', [27, 90, 33])?.id,
        resolveMapDestructibleSegmentByHit(fourLegDefinition(), 'legs_lower_iron', [27, 90, 33], 3)?.id,
    );

    // A junk factor falls back to 1 instead of collapsing every anchor onto the origin.
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', hit, 0)?.id, 'far');
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron', hit, 'x')?.id, 'far');
});

test('a longer mesh prefix beats a nearer anchor', () => {
    const definition = normalizeMapDestructibles({
        segments: [
            { id: 'legs', kind: 'leg_lower', meshPrefixes: ['legs_lower'], anchor: [10, 0, 10] },
            { id: 'legs_far', kind: 'leg_lower', meshPrefixes: ['legs_lower'], anchor: [-10, 0, -10] },
            { id: 'leg_named', kind: 'leg_lower', meshPrefixes: ['legs_lower_iron'], anchor: [-999, 0, -999] },
        ],
    });

    // The named segment sits far away from the hit and still wins: naming a piece exactly is
    // the stronger statement than standing close to it.
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_iron_01', [10, 0, 10])?.id, 'leg_named');
    // A name only the shared prefix covers is decided by the anchor again.
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_wood', [10, 0, 10])?.id, 'legs');
    assert.equal(resolveMapDestructibleSegmentByHit(definition, 'legs_lower_wood', [-10, 0, -10])?.id, 'legs_far');
});

test('the hud focuses the segment under fire and announces every break for a while', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);
    const hudAt = (seconds) => resolveMapDestructibleHudState(state, definition, seconds);

    // An untouched tower has nothing to report.
    assert.deepEqual(hudAt(1).focusSegment, null);
    assert.equal(hudAt(1).active, false);

    applyMapDestructibleDamage(state, definition, 'shaft', 5, { atSeconds: 2 });
    assert.deepEqual(hudAt(2).focusSegment, { id: 'shaft', label: 'Schaft', ratio: 0.8 });
    assert.equal(hudAt(2).active, true);

    // The harder hit segment takes the line over.
    applyMapDestructibleDamage(state, definition, 'leg_b', 30, { atSeconds: 3 });
    assert.equal(hudAt(3).focusSegment?.id, 'leg_b');

    // Equally hurt segments are decided by the newer hit, in either order.
    applyMapDestructibleDamage(state, definition, 'summit', 7.5, { atSeconds: 4 });
    assert.equal(hudAt(4).focusSegment?.ratio, 0.25);
    assert.equal(hudAt(4).focusSegment?.id, 'summit');

    const swapped = createMapDestructibleState(definition);
    applyMapDestructibleDamage(swapped, definition, 'summit', 7.5, { atSeconds: 4 });
    applyMapDestructibleDamage(swapped, definition, 'leg_b', 30, { atSeconds: 5 });
    assert.equal(resolveMapDestructibleHudState(swapped, definition, 5).focusSegment?.id, 'leg_b');

    // A break is announced for eight seconds and then makes way for the next damaged segment.
    applyMapDestructibleDamage(state, definition, 'summit', 10, { atSeconds: 6 });
    assert.equal(MAP_DESTRUCTIBLE_HUD.breakingAnnounceSeconds, 8);
    assert.equal(hudAt(6).breakingSecondsRemaining, 8);
    assert.deepEqual(hudAt(6).focusSegment, { id: 'summit', label: 'Spitze', ratio: 0 });
    assert.equal(hudAt(10).breakingSecondsRemaining, 4);
    assert.equal(hudAt(14).breakingSecondsRemaining, 0);
    assert.equal(hudAt(14).focusSegment?.id, 'leg_b');
    // A destroyed segment never takes the focus, even though nothing is left of it.
    assert.equal(hudAt(14).segments[4].ratio, 0);

    // The break alone keeps the HUD active once every standing segment is whole again.
    const sealedState = createMapDestructibleState(definition);
    applyMapDestructibleDamage(sealedState, definition, 'leg_a', 40, { atSeconds: 20 });
    const sealed = resolveMapDestructibleHudState(sealedState, definition, 21);
    assert.equal(sealed.sealed, true);
    assert.equal(sealed.active, true);
    assert.deepEqual(sealed.focusSegment, { id: 'leg_a', label: 'Bein A', ratio: 0 });
    assert.equal(sealed.breakingSecondsRemaining, 7);
    assert.equal(resolveMapDestructibleHudState(sealedState, definition, 40).active, false);
});

test('the last hit time survives the network round trip', () => {
    const definition = towerDefinition();
    const state = createMapDestructibleState(definition);
    assert.equal(state.segments[0].lastHitAtSeconds, -1);

    applyMapDestructibleDamage(state, definition, 'shaft', 5, { atSeconds: 2 });
    applyMapDestructibleDamage(state, definition, 'summit', 5, { atSeconds: 9 });
    assert.equal(state.segments[3].lastHitAtSeconds, 2);
    assert.equal(state.segments[4].lastHitAtSeconds, 9);

    const wire = JSON.parse(JSON.stringify(serializeMapDestructibleState(state)));
    const replica = createMapDestructibleState(definition);
    applyMapDestructibleNetworkState(replica, wire);
    assert.deepEqual(serializeMapDestructibleState(replica), serializeMapDestructibleState(state));
    assert.equal(replica.segments[4].lastHitAtSeconds, 9);
    assert.equal(replica.segments[0].lastHitAtSeconds, -1);
    // Host and replica therefore pick the very same segment for the HUD line.
    assert.deepEqual(
        resolveMapDestructibleHudState(replica, definition, 10).focusSegment,
        resolveMapDestructibleHudState(state, definition, 10).focusSegment,
    );

    // Junk from the wire reads as "never hit" rather than as a hit at time zero.
    const junk = createMapDestructibleState(definition);
    applyMapDestructibleNetworkState(junk, {
        segments: [{ id: 'shaft', hp: 5, maxHp: 25, lastHitAtSeconds: 'gestern' }],
        events: [],
    });
    assert.equal(junk.segments[0].lastHitAtSeconds, -1);
});

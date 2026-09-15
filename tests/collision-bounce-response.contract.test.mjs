import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CollisionResponseSystem, resolveNearestBoundsNormal } from '../src/entities/systems/CollisionResponseSystem.js';
import { SpawnPlacementSystem } from '../src/entities/systems/SpawnPlacementSystem.js';

const BOUNDS = Object.freeze({
    minX: -40, maxX: 40,
    minY: -20, maxY: 20,
    minZ: -60, maxZ: 60,
});

const CENTER = new THREE.Vector3(
    (BOUNDS.minX + BOUNDS.maxX) / 2,
    (BOUNDS.minY + BOUNDS.maxY) / 2,
    (BOUNDS.minZ + BOUNDS.maxZ) / 2
);

function createOwnerStub({ checkCollision = () => false, planar = false, recorder = null } = {}) {
    return {
        arena: { bounds: { ...BOUNDS }, checkCollision },
        botByPlayer: new Map(),
        recorder,
        entityRuntimeConfig: { GAMEPLAY: { PLANAR_MODE: planar } },
        checkGlobalCollision: () => false,
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
        _tmpDir: new THREE.Vector3(),
    };
}

// getDirection liefert die Blickrichtung. Der Bounce spiegelt sie an der Normalen,
// deshalb reicht hier ein festes Vorwaertsmass statt einer echten Quaternion-Rechnung.
function createPlayerStub({ position = CENTER.clone(), direction = new THREE.Vector3(0, 0, -1) } = {}) {
    const trailGaps = [];
    return {
        index: 0,
        hitboxRadius: 1,
        position,
        quaternion: new THREE.Quaternion(),
        arenaCollisionGraceTimer: 0,
        trail: { forceGap: (value) => trailGaps.push(value) },
        getDirection(out) { return out.copy(direction); },
        trailGaps,
    };
}

function headingOf(player) {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
}

const WALL_CASES = [
    { name: 'minX', position: new THREE.Vector3(BOUNDS.minX + 0.5, CENTER.y, CENTER.z), approach: new THREE.Vector3(-1, 0, 0) },
    { name: 'maxX', position: new THREE.Vector3(BOUNDS.maxX - 0.5, CENTER.y, CENTER.z), approach: new THREE.Vector3(1, 0, 0) },
    { name: 'minY', position: new THREE.Vector3(CENTER.x, BOUNDS.minY + 0.5, CENTER.z), approach: new THREE.Vector3(0, -1, 0) },
    { name: 'maxY', position: new THREE.Vector3(CENTER.x, BOUNDS.maxY - 0.5, CENTER.z), approach: new THREE.Vector3(0, 1, 0) },
    { name: 'minZ', position: new THREE.Vector3(CENTER.x, CENTER.y, BOUNDS.minZ + 0.5), approach: new THREE.Vector3(0, 0, -1) },
    { name: 'maxZ', position: new THREE.Vector3(CENTER.x, CENTER.y, BOUNDS.maxZ - 0.5), approach: new THREE.Vector3(0, 0, 1) },
];

test('a bounce at every wall turns the heading back into the arena', () => {
    for (const wallCase of WALL_CASES) {
        const owner = createOwnerStub();
        const system = new CollisionResponseSystem(owner);
        const player = createPlayerStub({ position: wallCase.position.clone(), direction: wallCase.approach.clone() });

        system.bounceBot(player, null, 'WALL', { randomScale: 0 });

        const inward = new THREE.Vector3().subVectors(CENTER, wallCase.position).normalize();
        assert.ok(
            headingOf(player).dot(inward) > 0,
            `${wallCase.name}: heading must point back into the arena, got ${headingOf(player).toArray()}`
        );
    }
});

// Der vorige Test allein genuegt nicht: die Spiegelungsformel d - 2(d·n)n benutzt die
// Normale zweimal und ist deshalb vorzeichenunabhaengig. Ein vertauschtes Vorzeichen
// aendert am gespiegelten Kurs gar nichts — genau deshalb ist der alte Z-Fehler
// jahrelang unbemerkt geblieben. Sichtbar wird er erst, wenn die Spiegelung nichts tut:
// bei einer Fahrt parallel zur Wand entscheidet allein normalBias, wohin es geht.
test('grazing a wall tilts the heading away from it, not into it', () => {
    for (const wallCase of WALL_CASES) {
        const owner = createOwnerStub();
        const system = new CollisionResponseSystem(owner);
        // Eine Richtung senkrecht zur Wandnormalen: der Spiegelanteil faellt weg.
        const parallel = new THREE.Vector3(wallCase.approach.y, wallCase.approach.z, wallCase.approach.x);
        const player = createPlayerStub({ position: wallCase.position.clone(), direction: parallel });

        system.bounceBot(player, null, 'WALL', { randomScale: 0, normalBias: 0.6 });

        const inward = new THREE.Vector3().subVectors(CENTER, wallCase.position).normalize();
        assert.ok(
            headingOf(player).dot(inward) > 0,
            `${wallCase.name}: a graze must steer inward, got ${headingOf(player).toArray()}`
        );
    }
});

test('the derived normal matches the wall the bounce was taken at', () => {
    for (const wallCase of WALL_CASES) {
        const normal = resolveNearestBoundsNormal(BOUNDS, wallCase.position, new THREE.Vector3());
        const inward = new THREE.Vector3().subVectors(CENTER, wallCase.position).normalize();

        assert.ok(normal.dot(inward) > 0, `${wallCase.name}: normal points inward`);
    }
});

test('an explicit normal overrides the derived one', () => {
    const owner = createOwnerStub();
    const system = new CollisionResponseSystem(owner);
    // Mitten im Feld gaebe es keine nahe Wand; die uebergebene Normale muss trotzdem zaehlen.
    const player = createPlayerStub({ position: CENTER.clone(), direction: new THREE.Vector3(1, 0, 0) });

    system.bounceBot(player, new THREE.Vector3(-1, 0, 0), 'TRAIL', { randomScale: 0 });

    assert.ok(headingOf(player).x < 0, 'the heading follows the supplied normal');
});

test('without a seeded roll the bounce stays reproducible', () => {
    const headings = [];
    for (let run = 0; run < 2; run++) {
        const system = new CollisionResponseSystem(createOwnerStub());
        const player = createPlayerStub({
            position: new THREE.Vector3(BOUNDS.minX + 0.5, CENTER.y, CENTER.z),
            direction: new THREE.Vector3(-1, 0, 0),
        });
        system.bounceBot(player, null, 'WALL');
        headings.push(headingOf(player).toArray().map((value) => value.toFixed(6)).join(','));
    }

    assert.equal(headings[1], headings[0]);
});

test('a supplied roll is used instead of the constant fallback', () => {
    const rolls = [];
    const system = new CollisionResponseSystem(createOwnerStub());
    const player = createPlayerStub({
        position: new THREE.Vector3(BOUNDS.minX + 0.5, CENTER.y, CENTER.z),
        direction: new THREE.Vector3(-1, 0, 0),
    });

    system.bounceBot(player, null, 'WALL', { random: () => { rolls.push(1); return 0.9; } });

    assert.equal(rolls.length, 3, 'one roll per axis');
});

test('planar mode keeps the bounce in the horizontal plane', () => {
    const system = new CollisionResponseSystem(createOwnerStub({ planar: true }));
    const player = createPlayerStub({
        position: new THREE.Vector3(CENTER.x, BOUNDS.maxY - 0.5, CENTER.z),
        direction: new THREE.Vector3(0, 1, 0),
    });

    system.bounceBot(player, null, 'WALL', { randomScale: 0 });

    assert.ok(Math.abs(headingOf(player).y) < 1e-6, 'no vertical component survives planar mode');
});

test('a bounce cuts the trail and can arm the collision grace', () => {
    const system = new CollisionResponseSystem(createOwnerStub());
    const player = createPlayerStub({ position: new THREE.Vector3(BOUNDS.minX + 0.5, CENTER.y, CENTER.z) });

    system.bounceBot(player, null, 'WALL', { randomScale: 0, trailGap: 0.75, collisionGrace: 1.5 });

    assert.deepEqual(player.trailGaps, [0.75]);
    assert.equal(player.arenaCollisionGraceTimer, 1.5);
});

// Der Kommentar im Quelltext verspricht, dass die Heatmap den Aufprallort festhaelt und
// nicht die Stelle, an die der Spieler danach geschoben wird. Genau das wird hier gemessen.
test('the recorded bounce position is the impact, not where the push ended', () => {
    const events = [];
    const owner = createOwnerStub({ recorder: { logEvent: (type, index, _tag, at) => events.push({ type, index, x: at.x, z: at.z }) } });
    const system = new CollisionResponseSystem(owner);
    const impact = new THREE.Vector3(BOUNDS.minX + 0.5, CENTER.y, CENTER.z);
    const player = createPlayerStub({ position: impact.clone(), direction: new THREE.Vector3(-1, 0, 0) });

    system.bounceBot(player, null, 'WALL', { randomScale: 0, extraPush: 12 });

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'BOUNCE_WALL');
    assert.equal(events[0].x, impact.x);
    assert.notEqual(player.position.x, impact.x, 'the player really did move away from the impact');
});

test('a trail bounce is recorded under its own event name', () => {
    const events = [];
    const owner = createOwnerStub({ recorder: { logEvent: (type) => events.push(type) } });
    const system = new CollisionResponseSystem(owner);

    system.bounceBot(createPlayerStub(), new THREE.Vector3(1, 0, 0), 'TRAIL', { randomScale: 0 });

    assert.deepEqual(events, ['BOUNCE_TRAIL']);
});

test('the bound bot is told about the bounce and its normal', () => {
    const owner = createOwnerStub();
    const system = new CollisionResponseSystem(owner);
    const player = createPlayerStub();
    const seen = [];
    owner.botByPlayer.set(player, { onBounce: (source, normal) => seen.push({ source, x: normal.x }) });

    system.bounceBot(player, new THREE.Vector3(1, 0, 0), 'FOAM', { randomScale: 0 });

    assert.deepEqual(seen, [{ source: 'FOAM', x: 1 }]);
});

test('pushing out of a wall moves along the normal and reports success', () => {
    const system = new CollisionResponseSystem(createOwnerStub());
    const player = createPlayerStub({ position: new THREE.Vector3(BOUNDS.minX, CENTER.y, CENTER.z) });

    assert.equal(system.pushPlayerOutOfCollision(player, new THREE.Vector3(1, 0, 0), 2), true);
    assert.equal(player.position.x, BOUNDS.minX + 2);
});

test('pushing out steps further when the first step is still blocked', () => {
    let calls = 0;
    const owner = createOwnerStub({ checkCollision: () => { calls += 1; return calls <= 2; } });
    const system = new CollisionResponseSystem(owner);
    const player = createPlayerStub({ position: new THREE.Vector3(0, 0, 0) });

    assert.equal(system.pushPlayerOutOfCollision(player, new THREE.Vector3(0, 1, 0), 1), true);
    assert.equal(player.position.y, 3, 'the third step is the one that clears');
});

test('pushing out gives up rather than teleporting through geometry', () => {
    const system = new CollisionResponseSystem(createOwnerStub({ checkCollision: () => true }));
    const player = createPlayerStub({ position: new THREE.Vector3(0, 0, 0) });

    assert.equal(system.pushPlayerOutOfCollision(player, new THREE.Vector3(1, 0, 0), 2), false);
    assert.equal(player.position.x, 0, 'a failed push leaves the position untouched');
});

test('pushing out refuses a missing or degenerate normal', () => {
    const system = new CollisionResponseSystem(createOwnerStub());
    const player = createPlayerStub({ position: new THREE.Vector3(0, 0, 0) });

    assert.equal(system.pushPlayerOutOfCollision(player, null), false);
    assert.equal(system.pushPlayerOutOfCollision(player, new THREE.Vector3(0, 0, 0)), false);
});

// Der Unterschied zwischen den beiden Wegen ist der Grund, warum es sie beide gibt:
// bounceBot dreht das Fahrzeug, pushPlayerOutOfCollision laesst die Steuerung in Ruhe.
test('the push keeps the heading while the bounce rewrites it', () => {
    const system = new CollisionResponseSystem(createOwnerStub());
    const pushed = createPlayerStub({ position: new THREE.Vector3(BOUNDS.minX, CENTER.y, CENTER.z) });
    const bounced = createPlayerStub({ position: new THREE.Vector3(BOUNDS.minX + 0.5, CENTER.y, CENTER.z) });
    const before = headingOf(pushed).toArray();

    system.pushPlayerOutOfCollision(pushed, new THREE.Vector3(1, 0, 0), 2);
    system.bounceBot(bounced, null, 'WALL', { randomScale: 0 });

    assert.deepEqual(headingOf(pushed).toArray(), before);
    assert.notDeepEqual(headingOf(bounced).toArray(), before);
});

test('a bounce without an owner or player does nothing instead of throwing', () => {
    assert.doesNotThrow(() => new CollisionResponseSystem(null).bounceBot(createPlayerStub()));
    assert.doesNotThrow(() => new CollisionResponseSystem(createOwnerStub()).bounceBot(null));
});

test('the production bounce placement uses a unit direction instead of multiplying every distance', () => {
    const owner = createOwnerStub();
    let system = null;
    const placement = new SpawnPlacementSystem(owner, {
        isBotPositionSafe: (player, position) => system.isBotPositionSafe(player, position),
    });
    system = new CollisionResponseSystem(owner, placement);
    const player = createPlayerStub({
        position: new THREE.Vector3(),
        direction: new THREE.Vector3(0, 0, -1),
    });

    system.bounceBot(player, new THREE.Vector3(0, 0, 1), 'WALL', { randomScale: 0 });

    assert.ok(Math.abs(player.position.z - 1) < 1e-6, `expected the nearest safe shove, got ${player.position.z}`);
});

test('a probe contact receives only the minimum depenetration and a damped heading response', () => {
    const owner = createOwnerStub({
        checkCollision: (point, radius = 0) => point.z - radius <= 0,
    });
    const system = new CollisionResponseSystem(owner);
    const player = createPlayerStub({
        position: new THREE.Vector3(0, 0, 5),
        direction: new THREE.Vector3(0, 0, -1),
    });
    const collision = {
        normal: new THREE.Vector3(0, 0, 1),
        responseHasProbe: true,
        responseAlreadySeparated: false,
        responseProbeOffsetX: 0,
        responseProbeOffsetY: 0,
        responseProbeOffsetZ: -4.2,
    };

    assert.equal(system.resolvePlayerWallCollision(player, collision), true);
    assert.ok(player.position.z > 5.2 && player.position.z < 5.3, `minimal correction expected, got ${player.position.z}`);
    assert.ok(headingOf(player).z > 0.99, 'a frontal impact must leave the vehicle pointing away from the wall');
});

test('a swept contact changes the heading without applying a second position correction', () => {
    const system = new CollisionResponseSystem(createOwnerStub());
    const player = createPlayerStub({
        position: new THREE.Vector3(0, 0, 1.25),
        direction: new THREE.Vector3(0, 0, -1),
    });
    const before = player.position.clone();

    system.resolvePlayerWallCollision(player, {
        normal: new THREE.Vector3(0, 0, 1),
        responseAlreadySeparated: true,
    });

    assert.deepEqual(player.position.toArray(), before.toArray());
    assert.ok(headingOf(player).z > 0.99);
});

test('a grazing human impact keeps its tangential travel instead of fully reflecting it', () => {
    const system = new CollisionResponseSystem(createOwnerStub());
    const player = createPlayerStub({
        direction: new THREE.Vector3(1, 0, -0.1).normalize(),
    });

    system.resolvePlayerWallCollision(player, {
        normal: new THREE.Vector3(0, 0, 1),
        responseAlreadySeparated: true,
    });

    const heading = headingOf(player);
    assert.ok(heading.x > 0.97, `tangential direction should survive, got ${heading.toArray()}`);
    assert.ok(heading.z > 0, 'the small normal component must lead away from the wall');
});

// Die Normale wird ohne Vorgabe aus den Bounds abgeleitet und danach noch zweimal
// weitergereicht: an die Platzierung und an die Bot-KI. Liegt sie in einem Scratch-Vektor,
// den der Bounce zwischendurch selbst ueberschreibt, bounct der Bot in die falsche Richtung.
test('a derived bounce normal survives until placement and bot ai have seen it', () => {
    for (const wallCase of WALL_CASES) {
        const owner = createOwnerStub();
        const seen = [];
        const capture = (stage, normal) => seen.push({
            stage,
            normal: new THREE.Vector3(Number(normal?.x), Number(normal?.y), Number(normal?.z)),
        });
        const system = new CollisionResponseSystem(owner, {
            findSafeBouncePosition(_player, _direction, normal) { capture('placement', normal); },
        });
        const player = createPlayerStub({ position: wallCase.position.clone(), direction: wallCase.approach.clone() });
        owner.botByPlayer.set(player, { onBounce(_source, normal) { capture('bot-ai', normal); } });
        const expected = resolveNearestBoundsNormal(BOUNDS, wallCase.position, new THREE.Vector3());

        system.bounceBot(player, null, 'WALL', { randomScale: 0, extraPush: 3.2 });

        assert.deepEqual(seen.map((entry) => entry.stage), ['placement', 'bot-ai']);
        for (const entry of seen) {
            assert.ok(
                entry.normal.distanceTo(expected) < 1e-6,
                `${wallCase.name}/${entry.stage}: expected ${expected.toArray()}, got ${entry.normal.toArray()}`
            );
        }
    }
});

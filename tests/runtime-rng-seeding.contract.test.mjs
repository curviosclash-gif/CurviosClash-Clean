import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { Player } from '../src/entities/Player.js';

function drawSequence(rng, count = 16) {
    const values = [];
    for (let i = 0; i < count; i++) values.push(rng.next());
    return values;
}

test('an explicit seed wins over a passed roll', () => {
    // Der Kern des Befunds: wer Saat *und* random mitgab, verlor vorher still die Saat.
    const marker = () => 0.123456;
    const first = drawSequence(createRuntimeRng({ seed: 4711, random: marker }));
    const second = drawSequence(createRuntimeRng({ seed: 4711, random: marker }));

    assert.deepEqual(second, first);
    assert.ok(first.some((value) => value !== 0.123456), 'the passed roll must not drive a seeded rng');
});

test('a different seed still produces a different sequence when a roll is passed too', () => {
    const marker = () => 0.123456;
    const first = drawSequence(createRuntimeRng({ seed: 4711, random: marker }));
    const other = drawSequence(createRuntimeRng({ seed: 90210, random: marker }));

    assert.notDeepEqual(other, first);
});

test('without a seed the passed roll is used', () => {
    const scripted = [0.25, 0.5, 0.75];
    let index = 0;
    const rng = createRuntimeRng({ random: () => scripted[index++ % scripted.length] });

    assert.deepEqual(drawSequence(rng, 3), scripted);
});

test('a seed of zero counts as unseeded and leaves the passed roll in charge', () => {
    const rng = createRuntimeRng({ seed: 0, random: () => 0.42 });

    assert.equal(rng.next(), 0.42);
});

const TEST_RUNTIME_CONFIG_BASE = Object.freeze({
    bot: { policyType: null, policyStrategy: 'rule-based' },
    gameplay: { planarMode: false },
});

function createSetupOwner() {
    // applySetupRuntimeOptions fasst nur diese Felder an, deshalb reicht die Attrappe.
    return {
        runtimeConfig: null,
        entityRuntimeConfig: null,
        activeGameMode: 'CLASSIC',
        botDifficulty: 'NORMAL',
        runtimeRng: null,
        matchSeed: 0,
    };
}

function runSetupOptions(runtimeConfig, options = {}) {
    const owner = createSetupOwner();
    new EntitySetupOps(owner).applySetupRuntimeOptions({ runtimeConfig, ...options });
    return owner;
}

const MODES_UNDER_TEST = [
    ['CLASSIC', 'normal'],
    ['HUNT', 'normal'],
    ['CLASSIC', 'fight'],
];

for (const [activeGameMode, modePath] of MODES_UNDER_TEST) {
    test(`the setup resolves a match seed in ${activeGameMode}/${modePath}, not only in arcade`, () => {
        const owner = runSetupOptions({
            ...TEST_RUNTIME_CONFIG_BASE,
            session: { activeGameMode, modePath, matchSeed: 20260811 },
            arcade: { enabled: false, seed: 0 },
        }, { activeGameMode });

        assert.equal(owner.matchSeed, 20260811);
        assert.equal(owner.runtimeRng.seed, 20260811);
    });
}

test('the session match seed outranks the arcade seed', () => {
    const owner = runSetupOptions({
        ...TEST_RUNTIME_CONFIG_BASE,
        session: { activeGameMode: 'CLASSIC', matchSeed: 111 },
        arcade: { enabled: true, seed: 222 },
    });

    assert.equal(owner.matchSeed, 111);
});

test('the arcade seed is still used when no session seed is set', () => {
    const owner = runSetupOptions({
        ...TEST_RUNTIME_CONFIG_BASE,
        session: { activeGameMode: 'CLASSIC' },
        arcade: { enabled: true, seed: 222 },
    });

    assert.equal(owner.matchSeed, 222);
});

test('an explicitly passed seed outranks everything from the runtime config', () => {
    const owner = runSetupOptions({
        ...TEST_RUNTIME_CONFIG_BASE,
        session: { activeGameMode: 'CLASSIC', matchSeed: 111 },
        arcade: { enabled: true, seed: 222 },
    }, { seed: 333 });

    assert.equal(owner.matchSeed, 333);
});

test('a match without any configured seed still draws one and keeps it', () => {
    const owner = runSetupOptions({ ...TEST_RUNTIME_CONFIG_BASE, session: { activeGameMode: 'CLASSIC' } });
    const drawnSeed = owner.matchSeed;

    assert.ok(drawnSeed > 0, 'a seed must be drawn instead of silently rolling Math.random');

    // Zweiter Aufruf auf demselben Match: die einmal gezogene Saat bleibt stehen.
    new EntitySetupOps(owner).applySetupRuntimeOptions({
        runtimeConfig: { ...TEST_RUNTIME_CONFIG_BASE, session: { activeGameMode: 'CLASSIC' } },
    });
    assert.equal(owner.matchSeed, drawnSeed);
});

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

function spawnHeadingsFromSetup(matchSeed, spawnCount = 6) {
    const owner = runSetupOptions({
        ...TEST_RUNTIME_CONFIG_BASE,
        session: { activeGameMode: 'CLASSIC', matchSeed },
        arcade: { enabled: false, seed: 0 },
    });
    const headings = [];
    for (let i = 0; i < spawnCount; i++) {
        const player = new Player(createRenderer(), i, 0x33aaff, true, { entityManager: owner });
        player.spawn(new THREE.Vector3(0, 5, 0));
        headings.push(player.quaternion.toArray());
    }
    return headings;
}

test('two setups with the same match seed spawn the same heading sequence', () => {
    assert.deepEqual(spawnHeadingsFromSetup(4711), spawnHeadingsFromSetup(4711));
});

test('a different match seed spawns a different heading sequence', () => {
    assert.notDeepEqual(spawnHeadingsFromSetup(90210), spawnHeadingsFromSetup(4711));
});

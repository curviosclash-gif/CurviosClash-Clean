import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerInputSystem } from '../src/entities/systems/PlayerInputSystem.js';

// Open faces (exclusionZone.openFaces) have no wall in the flight physics. Bots are exempt from the
// exclusion-zone salvo, so without a soft boundary a bot that crosses one flies on out of reach.
// These checks run the real bot input path (policy -> sanitize -> soft boundary) with a stub policy
// that only flies straight ahead, and ask whether the resulting steering points back inside.

const ALL_OPEN = Object.freeze(['minX', 'maxX', 'minZ', 'maxZ', 'maxY']);

function createArena(openFaces = ALL_OPEN, playableVolumes = []) {
    return {
        bounds: { minX: -100, maxX: 100, minY: 0, maxY: 60, minZ: -100, maxZ: 100 },
        openFaces,
        playableVolumes,
    };
}

function createBot(position, direction, overrides = {}) {
    const heading = new THREE.Vector3(...direction).normalize();
    return {
        index: 1,
        alive: true,
        isBot: true,
        speed: 18,
        hitboxRadius: 0.8,
        inventory: [],
        position: new THREE.Vector3(...position),
        getDirection(out) { return out.copy(heading); },
        ...overrides,
    };
}

function resolveBotInput(arena, player) {
    const straightFlight = {
        type: 'heuristic',
        usesRuntimeContext: true,
        requiresObservation: false,
        update: () => ({ boost: true, shootMG: true }),
    };
    const manager = {
        arena,
        players: [player],
        humanPlayers: [],
        renderer: { cameraModes: [] },
        botByPlayer: new Map([[player, straightFlight]]),
        createBotRuntimeContext: () => ({ arena }),
    };
    return { ...new PlayerInputSystem(manager).resolvePlayerInput(player, 1 / 60, {
        getPlayerInput: () => ({}),
    }) };
}

function hasSteering(input) {
    return input.yawLeft || input.yawRight || input.pitchUp || input.pitchDown
        || Math.abs(Number(input.yawAxis) || 0) > 0 || Math.abs(Number(input.pitchAxis) || 0) > 0;
}

test('bot past an open side face turns back toward the arena', () => {
    // Heading +X/+Z beyond maxX: the arena lies to the bot's right (see HuntBotSteeringOps).
    const input = resolveBotInput(createArena(), createBot([112, 30, 0], [1, 0, 1]));
    assert.equal(input.yawRight, true, 'bot beyond maxX must yaw back toward -X');
    assert.equal(input.yawLeft, false);
    assert.equal(input.shootMG, true, 'the soft boundary only steers, it keeps the attack');
});

test('bot heading out through an open side face turns inside the edge band', () => {
    const input = resolveBotInput(createArena(), createBot([96, 30, 0], [1, 0, 1]));
    assert.equal(input.yawRight, true, 'bot close to maxX and heading out must turn before it leaves');
});

test('bot above an open ceiling pitches back down', () => {
    const input = resolveBotInput(createArena(), createBot([0, 70, 0], [0, 0, 1]));
    assert.equal(input.pitchDown, true, 'bot above maxY must pitch down');
    assert.equal(input.pitchUp, false);
});

test('closed arenas, the open centre, humans and map rooms keep the policy steering', () => {
    const cases = [
        ['closed arena', createArena([]), createBot([112, 30, 0], [1, 0, 1])],
        ['arena centre', createArena(), createBot([0, 30, 0], [1, 0, 1])],
        ['edge band heading inward', createArena(), createBot([96, 30, 0], [-1, 0, 1])],
        ['human pilot', createArena(), createBot([112, 30, 0], [1, 0, 1], { isBot: false, autopilotActive: true })],
        ['map room', createArena(ALL_OPEN, [{ minX: 100, maxX: 140, minY: 0, maxY: 60, minZ: -20, maxZ: 20 }]),
            createBot([120, 30, 0], [1, 0, 1])],
    ];
    for (const [label, arena, player] of cases) {
        const input = resolveBotInput(arena, player);
        assert.equal(hasSteering(input), false, `${label}: steering must stay as the policy left it`);
    }
});

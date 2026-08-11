import test from 'node:test';
import assert from 'node:assert/strict';

import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';

// Die Wanduhr liefert riesige Zahlen (performance.now bzw. Date.now). Der
// Simulationstakt eines frischen Matches startet bei 0. Alles unterhalb dieser
// Schwelle kann also unmoeglich aus der Wanduhr stammen.
const WALL_CLOCK_FLOOR_MS = 1_000_000;

function createParcoursEntityManager() {
    return {
        _simulationClockMs: 0,
        arena: {
            currentMapDefinition: null,
            _portalGateSystem: null,
        },
        renderer: { viewportSystem: { localPlayerIndex: 0 } },
        particles: null,
        recorder: { logEvent() {} },
        _notifyPlayerFeedback() {},
    };
}

test('parcours timing follows the match simulation clock, not the wall clock', () => {
    const entityManager = createParcoursEntityManager();
    const system = new ParcoursProgressSystem(entityManager);

    assert.equal(system.nowProvider(), 0, 'a fresh match starts at zero');

    entityManager._simulationClockMs = 4_200;
    assert.equal(system.nowProvider(), 4_200);
    assert.ok(
        system.nowProvider() < WALL_CLOCK_FLOOR_MS,
        'the parcours clock must not fall back to the wall clock'
    );
});

test('an injected parcours clock still wins over the simulation clock', () => {
    const entityManager = createParcoursEntityManager();
    entityManager._simulationClockMs = 4_200;
    const system = new ParcoursProgressSystem(entityManager, { nowProvider: () => 99 });

    assert.equal(system.nowProvider(), 99);
});

test('the parcours clock stays a number without an entity manager', () => {
    const system = new ParcoursProgressSystem(null);

    assert.equal(system.nowProvider(), 0);
});

function createPortalArena() {
    return {
        portals: [],
        exitPortals: [],
        portalsEnabled: true,
    };
}

test('the portal travel timestamp is match time, because it reaches the runtime projection', () => {
    const system = new PortalRuntimeSystem(createPortalArena());

    system.update(0.5);
    system.update(0.25);
    system._markPostPortalSignal('player:0', 1);

    const signal = system._postPortalSignalByEntity.get('player:0');
    assert.equal(signal.lastPortalTravelAtMs, 750, '0.5 s + 0.25 s of frame time');
    assert.ok(
        signal.lastPortalTravelAtMs < WALL_CLOCK_FLOOR_MS,
        'the projection timestamp must not carry this machine wall clock'
    );
});

test('resetting the portal runtime state rewinds its match time too', () => {
    const system = new PortalRuntimeSystem(createPortalArena());

    system.update(2);
    system.resetRuntimeState();
    system._markPostPortalSignal('player:0', 1);

    assert.equal(system._postPortalSignalByEntity.get('player:0').lastPortalTravelAtMs, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { Arena } from '../src/entities/Arena.js';
import { MapFireFxController } from '../src/entities/arena/MapFireFxController.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { normalizeMapFireFx } from '../src/shared/contracts/MapFireFxContract.js';

const MAP = MAP_PRESET_CATALOG.reactor_site;

function createSystem() {
    const fireStates = [];
    const arena = {
        currentMapKey: 'reactor_site',
        currentMapDefinition: MAP,
        glbAnimationElapsedSeconds: 0,
        setMapDestructibleFireState(state) {
            const reactor = state.segments.find((segment) => segment.id === 'reactor_dome');
            fireStates.push(reactor?.burnStartedAtSeconds >= 0 && !reactor.destroyed);
        },
    };
    const owner = { arena, gameModeStrategy: { modeType: 'HUNT' } };
    const system = new MapDestructibleSystem(owner);
    system.startRound();
    return { system, arena, fireStates };
}

function reactor(system) {
    return system.getState().segments.find((segment) => segment.id === 'reactor_dome');
}

test('reactor takes ten percent of maximum health per minute after its first hit', () => {
    const { system, arena, fireStates } = createSystem();
    assert.equal(reactor(system).hp, 900);
    assert.equal(fireStates.at(-1), false);

    arena.glbAnimationElapsedSeconds = 5;
    system.applySegmentHit('reactor_dome', 10);
    assert.equal(reactor(system).burnStartedAtSeconds, 5);
    assert.equal(fireStates.at(-1), true);

    arena.glbAnimationElapsedSeconds = 35;
    system.updateFeedback();
    assert.equal(reactor(system).hp, 845);
    assert.equal(reactor(system).lastHitAtSeconds, 5, 'burn does not impersonate a weapon hit');
    system.applySegmentHit('reactor_dome', 20);
    assert.equal(reactor(system).burnStartedAtSeconds, 5, 'later hits do not restart the timer');

    arena.glbAnimationElapsedSeconds = 65;
    system.updateFeedback();
    system.updateFeedback();
    assert.equal(reactor(system).hp, 780, 'one minute of fire costs exactly 90 HP');
    assert.equal(reactor(system).lastHitAtSeconds, 35);
});

test('reactor fire replicates, ends at destruction, and resets for a new round', () => {
    const { system, arena, fireStates } = createSystem();
    arena.glbAnimationElapsedSeconds = 2;
    system.applySegmentHit('reactor_dome', 10);

    const replica = createSystem();
    replica.system.setNetworkReplica(true);
    replica.system.applyNetworkState(system.serializeNetworkState());
    assert.equal(reactor(replica.system).burnStartedAtSeconds, 2);
    assert.equal(replica.fireStates.at(-1), true);
    replica.arena.glbAnimationElapsedSeconds = 120;
    replica.system.updateFeedback();
    assert.equal(reactor(replica.system).hp, 890, 'replica does not simulate damage');

    arena.glbAnimationElapsedSeconds = 602;
    system.updateFeedback();
    assert.equal(reactor(system).destroyed, true);
    assert.equal(system.getState().events.at(-1).segmentId, 'reactor_dome');
    assert.equal(fireStates.at(-1), false);

    system.startRound();
    assert.equal(reactor(system).hp, 900);
    assert.equal(reactor(system).burnStartedAtSeconds, -1);
    assert.equal(fireStates.at(-1), false);
});

test('reactor site has a localized fire presentation gated by the reactor segment', () => {
    assert.equal(MAP.fireFxActivationSegmentId, 'reactor_dome');
    const profile = normalizeMapFireFx(MAP.fireFx);
    assert.ok(profile?.emitters.length >= 1);
    assert.ok(profile.smoke.count > 0);
    assert.ok(profile.embers.count > 0);
    assert.equal(profile.flicker[0].lightId, MAP.lights[0].id);

    const fire = new MapFireFxController({ addToScene() {}, removeFromScene() {} });
    const light = { userData: { authoredLightId: MAP.lights[0].id }, intensity: MAP.lights[0].intensity };
    fire.build(MAP, 1, [light]);
    const arena = { currentMapDefinition: MAP, _builder: { fireFxController: fire } };
    const state = { segments: [{ id: 'reactor_dome', burnStartedAtSeconds: -1, destroyed: false }] };
    Arena.prototype.setMapDestructibleFireState.call(arena, state);
    assert.equal(fire.group.visible, false);
    assert.equal(light.intensity, 0);

    state.segments[0].burnStartedAtSeconds = 2;
    Arena.prototype.setMapDestructibleFireState.call(arena, state);
    assert.equal(fire.group.visible, true);
    fire.update(5);
    assert.ok(light.intensity > 0);

    state.segments[0].destroyed = true;
    Arena.prototype.setMapDestructibleFireState.call(arena, state);
    assert.equal(fire.group.visible, false);
    fire.clear();
    assert.equal(light.intensity, MAP.lights[0].intensity);
});

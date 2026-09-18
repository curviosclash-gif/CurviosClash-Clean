import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_AXIS_ATTACK_RATE,
    DEFAULT_AXIS_RELEASE_RATE,
    PlayerController,
} from '../src/entities/player/PlayerController.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
import {
    createNetworkLocalInputSource,
    createNetworkRemoteInputSource,
} from '../src/ui/NetworkMatchInputSources.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';

const FRAME = 1 / 60;

function assertClose(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `${message}: expected ${expected}, got ${actual}`
    );
}

function createHuman(controlRampEnabled) {
    return { isBot: false, controlRampEnabled };
}

test('smooth steering eases a held key to full deflection over four frames', () => {
    const controller = new PlayerController();
    const player = createHuman(true);
    const steps = [];
    for (let i = 0; i < 4; i += 1) {
        steps.push(controller.resolveControlState(player, { yawLeft: true }, false, FRAME).yawInput);
    }

    assertClose(steps[0], DEFAULT_AXIS_ATTACK_RATE * FRAME, 'first frame');
    assertClose(steps[1], DEFAULT_AXIS_ATTACK_RATE * FRAME * 2, 'second frame');
    assertClose(steps[2], DEFAULT_AXIS_ATTACK_RATE * FRAME * 3, 'third frame');
    assert.equal(steps[3], 1, 'the fourth frame reaches full deflection');
});

test('a released key glides back to centre instead of snapping', () => {
    const controller = new PlayerController();
    const player = createHuman(true);
    for (let i = 0; i < 8; i += 1) {
        controller.resolveControlState(player, { yawLeft: true }, false, FRAME);
    }

    const afterRelease = controller.resolveControlState(player, {}, false, FRAME).yawInput;
    assert.ok(afterRelease > 0 && afterRelease < 1, `expected a partial deflection, got ${afterRelease}`);

    let settled = afterRelease;
    for (let i = 0; i < 3; i += 1) {
        settled = controller.resolveControlState(player, {}, false, FRAME).yawInput;
    }
    assert.equal(settled, 0, 'the axis is back at centre four frames after the key went up');
});

test('without smooth steering a held key jumps to full deflection in one frame', () => {
    const controller = new PlayerController();
    const state = controller.resolveControlState(createHuman(false), { yawLeft: true }, false, FRAME);

    assert.equal(state.yawInput, 1);
});

test('analog axes are taken as they are while the ramp still smooths the keyboard axes', () => {
    const controller = new PlayerController();
    const player = createHuman(true);
    const state = controller.resolveControlState(player, { yawAxis: 0.5, pitchUp: true }, false, FRAME);

    assert.equal(state.yawInput, 0.5, 'a gamepad, mouse or tilt axis must not be damped again');
    assertClose(state.pitchInput, DEFAULT_AXIS_ATTACK_RATE * FRAME, 'the digital pitch axis keeps its ramp');

    const next = controller.resolveControlState(player, { yawAxis: -0.25 }, false, FRAME);
    assert.equal(next.yawInput, -0.25, 'the analog axis follows the stick without lag');
});

test('a per player ramp override is read under the name the player stores it', () => {
    const controller = new PlayerController();
    const player = { isBot: false, controlRampEnabled: true, controlRampRates: { attackRate: 60, releaseRate: 60 } };

    const state = controller.resolveControlState(player, { yawLeft: true }, false, FRAME);
    assert.equal(state.yawInput, 1, 'sixty per second reaches full deflection in one frame');
});

test('digital sources that encode keys as numbers would skip the ramp, so they leave the axis undefined', () => {
    const controller = new PlayerController();
    const player = createHuman(true);

    const numeric = controller.resolveControlState(player, { yawLeft: true, yawAxis: 1 }, false, FRAME);
    assert.equal(numeric.yawInput, 1, 'a numeric axis is taken as analog and never ramped');

    const fresh = new PlayerController();
    const digital = fresh.resolveControlState(player, { yawLeft: true, yawAxis: undefined }, false, FRAME);
    assertClose(digital.yawInput, DEFAULT_AXIS_ATTACK_RATE * FRAME, 'an undefined axis hands the key to the ramp');
});

// --- network match: the guest ramps in its own input source -------------------
// poll() runs exactly once per fixed simulation step (EntityTickPipeline.update ->
// PlayerInputSystem.resolvePlayerInput -> InputManager.getPlayerInput -> source.poll),
// and the one value it produces goes to the local prediction and to the host alike.

function createGuestSessionStub() {
    return {
        isHost: false,
        sentInputs: [],
        sendInput(payload) {
            this.sentInputs.push(payload);
        },
    };
}

function createGuestInputSource(keys, { enabled = true } = {}) {
    const session = createGuestSessionStub();
    const source = createNetworkLocalInputSource({
        source: { poll: () => ({ ...keys.current }) },
        session,
        playerId: 'guest-1',
        sendToSession: true,
        steeringRamp: { enabled },
    });
    source.bind(1);
    return { session, source };
}

function lastSent(session) {
    return session.sentInputs[session.sentInputs.length - 1];
}

test('the guest sends a rising yaw axis instead of a jump while the key is held', () => {
    const keys = { current: { yawLeft: true } };
    const { session, source } = createGuestInputSource(keys);

    for (let step = 0; step < 4; step += 1) source.poll({ dt: FRAME });
    assert.deepEqual(
        session.sentInputs.map((sent) => sent.yawAxis),
        [0.3, 0.6, 0.9, 1],
        'a held key climbs with the attack rate of eighteen per second'
    );

    keys.current = {};
    for (let step = 0; step < 5; step += 1) source.poll({ dt: FRAME });
    // Same curve as a local match: a target of exactly zero counts as a direction
    // change, so the way back to centre runs on the attack rate (PlayerController
    // has behaved like this since the ramp existed).
    assert.deepEqual(
        session.sentInputs.slice(4).map((sent) => sent.yawAxis),
        [0.7, 0.4, 0.1, 0, 0],
        'a released key glides back to centre instead of snapping'
    );
});

// The host side of the wire as the session adapters build it: the payload crosses as JSON,
// arrives as a `remoteInput` event, and the remote source normalises it a second time.
function createHostWire(guestSession, peerId) {
    const listeners = new Set();
    const hostSession = {
        isHost: true,
        on(eventName, listener) { if (eventName === 'remoteInput') listeners.add(listener); },
        off(eventName, listener) { if (eventName === 'remoteInput') listeners.delete(listener); },
    };
    const sendToGuestSession = guestSession.sendInput.bind(guestSession);
    guestSession.sendInput = (payload) => {
        sendToGuestSession(payload);
        const input = JSON.parse(JSON.stringify(payload));
        for (const listener of listeners) listener({ peerId, playerId: input.playerId, input });
    };
    const remoteSource = createNetworkRemoteInputSource({ session: hostSession, peerId });
    remoteSource.bind(1);
    return remoteSource;
}

test('the guest prediction and the host controller resolve the same steering step by step', () => {
    const keys = { current: { yawLeft: true } };
    const { session, source } = createGuestInputSource(keys);
    const hostSource = createHostWire(session, 'guest-1');
    const guestController = new PlayerController();
    const hostController = new PlayerController();
    // The guest keeps its own smooth steering flag; the host never learns it, so the
    // same slot runs without the ramp there.
    const guestPlayer = createHuman(true);
    const hostPlayer = createHuman(false);

    const guestCurve = [];
    const hostCurve = [];
    for (let step = 0; step < 12; step += 1) {
        if (step === 6) keys.current = {};
        const predicted = source.poll({ dt: FRAME });
        guestCurve.push(guestController.resolveControlState(guestPlayer, predicted, false, FRAME).yawInput);
        // The host reads what came over the wire, not the guest's own object.
        hostCurve.push(hostController.resolveControlState(hostPlayer, hostSource.poll(), false, FRAME).yawInput);
    }

    assert.notStrictEqual(hostSource.poll(), lastSent(session), 'the host works on its own copy of the payload');
    assert.ok(guestCurve[0] > 0 && guestCurve[0] < 1, `the first step eases in, got ${guestCurve[0]}`);
    assert.deepEqual(hostCurve, guestCurve, 'host and guest must not pull the same plane in two directions');
});

test('a guest with smooth steering off sends the same shape as before', () => {
    const keys = { current: { yawLeft: true, boost: true } };
    const { session, source } = createGuestInputSource(keys, { enabled: false });

    const polled = source.poll({ dt: FRAME });
    const sent = lastSent(session);

    assert.equal(Object.hasOwn(polled, 'yawAxis'), false, 'no axis is added to the default case');
    assert.equal(Object.hasOwn(sent, 'yawAxis'), false, 'the network payload stays byte for byte as today');
    assert.equal(Object.hasOwn(sent, 'pitchAxis'), false);
    assert.equal(Object.hasOwn(sent, 'rollAxis'), false);
    assert.equal(sent.yawLeft, true);
    assert.equal(sent.boost, true);
});

test('an analog stick of the guest is passed on without a second smoothing', () => {
    const keys = { current: { yawAxis: 0.5, pitchUp: true } };
    const { session, source } = createGuestInputSource(keys);

    const first = source.poll({ dt: FRAME });
    assert.equal(first.yawAxis, 0.5, 'the stick deflection reaches the host undamped');
    assert.equal(lastSent(session).yawAxis, 0.5);
    assertClose(first.pitchAxis, DEFAULT_AXIS_ATTACK_RATE * FRAME, 'the key next to the stick still ramps');

    // Mixed input: a resting stick hands its axis back to the keys, and the ramp
    // continues from the deflection the stick had, not from zero.
    keys.current = { yawLeft: true };
    const second = source.poll({ dt: FRAME });
    assert.ok(second.yawAxis > 0.5 && second.yawAxis < 1, `expected a continuation, got ${second.yawAxis}`);
});

test('a repeated poll in the same step cannot make guest and host disagree', () => {
    const keys = { current: { yawLeft: true } };
    const { session, source } = createGuestInputSource(keys);

    source.poll({ dt: FRAME });
    const predicted = source.poll({ dt: FRAME });

    assert.equal(lastSent(session).yawAxis, predicted.yawAxis, 'one poll yields one value for both sides');
});

test('buildHumanConfigs covers every network slot and reads the setting only for local slots', () => {
    const guest = buildHumanConfigs({ localSettings: { smoothSteering: true } }, {
        session: { networkEnabled: true, numHumans: 1, humanEntityCount: 3, localPlayerIndex: 1, localHumanCount: 1 },
    });
    assert.equal(guest.length, 3, 'one config per simulated human slot');
    assert.equal(guest[1].smoothSteering, true, 'the guest steers its own slot with its own setting');
    assert.equal(guest[0].smoothSteering, false, 'remote humans keep the default');
    assert.equal(guest[2].smoothSteering, false);
    assert.equal(guest[2].vehicleId, undefined, 'extra slots keep their sparse shape');

    const host = buildHumanConfigs({ localSettings: { smoothSteering: true } }, {
        session: { networkEnabled: true, numHumans: 1, humanEntityCount: 2, localPlayerIndex: 0, localHumanCount: 1 },
    });
    assert.equal(host[0].smoothSteering, true);
    assert.equal(host[1].smoothSteering, false, 'the host setting does not reach the guest slot');
});

test('buildHumanConfigs carries the smooth steering setting and defaults to off', () => {
    const runtimeConfig = { session: { numHumans: 2 } };

    const defaulted = buildHumanConfigs({}, runtimeConfig);
    assert.equal(defaulted.length, 2);
    assert.equal(defaulted[0].smoothSteering, false);
    assert.equal(defaulted[1].smoothSteering, false);

    const disabled = buildHumanConfigs({ localSettings: { smoothSteering: false } }, runtimeConfig);
    assert.equal(disabled[0].smoothSteering, false);

    const enabled = buildHumanConfigs({ localSettings: { smoothSteering: true } }, runtimeConfig);
    assert.equal(enabled[0].smoothSteering, true);
});

function setupHuman(humanConfig) {
    const owner = {
        renderer: { addToScene() {}, removeFromScene() {} },
        entityRuntimeConfig: null,
        players: [],
        humanPlayers: [],
    };
    new EntitySetupOps(owner).setupHumanPlayers(1, {
        normalizeVehicleId: (vehicleId) => vehicleId || 'ship5',
        modelScale: 1,
        humanConfigs: [humanConfig],
    });
    return owner.humanPlayers[0];
}

test('the human setup hands the smooth steering flag and the controller rates to the player', () => {
    const smooth = setupHuman({ smoothSteering: true });
    assert.equal(smooth.controlRampEnabled, true);
    assert.equal(smooth.controller.rampAttackRate, DEFAULT_AXIS_ATTACK_RATE);
    assert.equal(smooth.controller.rampReleaseRate, DEFAULT_AXIS_RELEASE_RATE);

    const direct = setupHuman({ smoothSteering: false });
    assert.equal(direct.controlRampEnabled, false);

    assert.equal(setupHuman({}).controlRampEnabled, false, 'a config without the flag steers directly');
});

test('bots keep their own ramp defaults', () => {
    const controller = new PlayerController();
    const bot = { isBot: true, controlRampEnabled: false };

    assert.equal(controller.resolveControlState(bot, { yawLeft: true }, false, FRAME).yawInput, 1);
});

test('smooth steering defaults to off, also for settings saved before the option existed', () => {
    const migrated = { localSettings: { mouseSteering: false } };
    ensureMenuContractState(migrated);
    assert.equal(migrated.localSettings.smoothSteering, false);

    const enabled = { localSettings: { smoothSteering: true } };
    ensureMenuContractState(enabled);
    assert.equal(enabled.localSettings.smoothSteering, true);
});

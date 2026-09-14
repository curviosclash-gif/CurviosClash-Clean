import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_AXIS_ATTACK_RATE,
    DEFAULT_AXIS_RELEASE_RATE,
    PlayerController,
} from '../src/entities/player/PlayerController.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
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

test('buildHumanConfigs carries the smooth steering setting and defaults to on', () => {
    const runtimeConfig = { session: { numHumans: 2 } };

    const defaulted = buildHumanConfigs({}, runtimeConfig);
    assert.equal(defaulted.length, 2);
    assert.equal(defaulted[0].smoothSteering, true);
    assert.equal(defaulted[1].smoothSteering, true);

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
});

test('bots keep their own ramp defaults', () => {
    const controller = new PlayerController();
    const bot = { isBot: true, controlRampEnabled: false };

    assert.equal(controller.resolveControlState(bot, { yawLeft: true }, false, FRAME).yawInput, 1);
});

test('smooth steering defaults to on, also for settings saved before the option existed', () => {
    const migrated = { localSettings: { mouseSteering: false } };
    ensureMenuContractState(migrated);
    assert.equal(migrated.localSettings.smoothSteering, true);

    const disabled = { localSettings: { smoothSteering: false } };
    ensureMenuContractState(disabled);
    assert.equal(disabled.localSettings.smoothSteering, false);
});

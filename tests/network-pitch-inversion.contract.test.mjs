import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLiveRuntimeConfig } from '../src/entities/EntityManagerLiveConfigOps.js';
import { PlayerController } from '../src/entities/player/PlayerController.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
import { MatchFlowUiController } from '../src/ui/MatchFlowUiController.js';

const HOST_SLOTS = Object.freeze([
    { peerId: 'host', ownerPeerId: 'host', playerIndex: 0, isHost: true },
    { peerId: 'guest', ownerPeerId: 'guest', playerIndex: 1, isHost: false },
]);

function createSettings({ invertPitch = {} } = {}) {
    return {
        invertPitch: { PLAYER_1: false, PLAYER_2: false, PLAYER_3: false, ...invertPitch },
        localSettings: {},
    };
}

function createNetworkRuntimeConfig({ localPlayerIndex, invertPitch }) {
    return {
        session: {
            networkEnabled: true,
            numHumans: 1,
            humanEntityCount: 2,
            localPlayerIndex,
            localHumanCount: 1,
        },
        player: { invertPitch: { PLAYER_1: false, PLAYER_2: false, PLAYER_3: false, ...invertPitch } },
    };
}

/**
 * Runs the real network input wiring of one machine (MatchFlowUiController) with a
 * keyboard that holds "pitch up" on every local slot. The session only records the
 * input a guest ships to the host.
 */
function configureMachineInputs({ isHost, localPlayerIndex, settings }) {
    const sources = new Map();
    const sent = [];
    const session = {
        isHost,
        sendInput: (payload) => sent.push(payload),
        on() {},
        off() {},
    };
    const game = {
        settings,
        input: {
            clearPlayerSources() { sources.clear(); },
            setPlayerSource(playerIndex, source) {
                source.bind(playerIndex);
                sources.set(playerIndex, source);
            },
        },
        runtimeConfig: {
            session: {
                networkEnabled: true,
                localHumanCount: 1,
                localPlayerIndex,
                networkPlayerSlots: HOST_SLOTS.map((slot) => ({
                    ...slot,
                    isLocal: slot.playerIndex === localPlayerIndex,
                })),
            },
        },
    };
    const controller = Object.create(MatchFlowUiController.prototype);
    controller.runtime = game;
    controller.runtimePort = {
        getNetworkMatchInputContext: () => ({ session, localPlayerIndex, localHumanCount: 1, slots: [] }),
    };
    controller._createPreferredInputSource = () => ({
        bind() {},
        unbind() {},
        dispose() {},
        poll: () => ({ pitchUp: true }),
    });
    MatchFlowUiController.prototype._configureInputSourcesForMatch.call(controller);
    return { sources, sent };
}

/** The pitch a plane flies with this config and input, through the real flight controller. */
function flownPitch(humanConfig, input) {
    const player = {
        isBot: false,
        controlRampEnabled: false,
        invertPitchBase: humanConfig?.invertPitch === true,
        invertControls: false,
        // A full 3D match: planar mode would zero the pitch before inversion matters.
        GAMEPLAY: { PLANAR_MODE: false },
    };
    return new PlayerController().resolveControlState(player, input, false, 1 / 60).pitchInput;
}

test('a guest with inverted pitch flies inverted on the host and in its own prediction', () => {
    const guestSettings = createSettings({ invertPitch: { PLAYER_1: true } });
    const guest = configureMachineInputs({ isHost: false, localPlayerIndex: 1, settings: guestSettings });
    // Polling the guest's own slot is what ships its input to the host.
    const predictedInput = guest.sources.get(1).poll();
    assert.equal(guest.sent.length, 1);

    const hostConfigs = buildHumanConfigs(createSettings(), createNetworkRuntimeConfig({ localPlayerIndex: 0 }));
    const guestConfigs = buildHumanConfigs(
        guestSettings,
        createNetworkRuntimeConfig({ localPlayerIndex: 1, invertPitch: { PLAYER_1: true } })
    );

    assert.equal(flownPitch(hostConfigs[1], guest.sent[0]), -1, 'pitch up must dive the guest plane on the host');
    assert.equal(flownPitch(guestConfigs[1], predictedInput), -1, 'the guest prediction must match the host');
});

test('a guest without inversion keeps its normal pitch', () => {
    const guest = configureMachineInputs({ isHost: false, localPlayerIndex: 1, settings: createSettings() });
    guest.sources.get(1).poll();
    const hostConfigs = buildHumanConfigs(createSettings(), createNetworkRuntimeConfig({ localPlayerIndex: 0 }));

    assert.equal(flownPitch(hostConfigs[1], guest.sent[0]), 1);
});

test('the host pitch inversion still applies exactly once to its own plane', () => {
    const hostSettings = createSettings({ invertPitch: { PLAYER_1: true } });
    const host = configureMachineInputs({ isHost: true, localPlayerIndex: 0, settings: hostSettings });
    const hostConfigs = buildHumanConfigs(
        hostSettings,
        createNetworkRuntimeConfig({ localPlayerIndex: 0, invertPitch: { PLAYER_1: true } })
    );

    assert.equal(flownPitch(hostConfigs[0], host.sources.get(0).poll()), -1);
});

test('a live settings change never inverts a network slot by its seat number', () => {
    // The host has one local player but "player 2 inverted" saved from couch play.
    // Seat 2 of a network match is the guest, who must not inherit that setting.
    const players = [0, 1].map(() => ({
        options: {},
        setControlOptions(options) { Object.assign(this.options, options); },
    }));
    const managerLike = { entityRuntimeConfig: null, players, humanPlayers: players, bots: [] };

    applyLiveRuntimeConfig(managerLike, null, createNetworkRuntimeConfig({
        localPlayerIndex: 0,
        invertPitch: { PLAYER_2: true },
    }));

    assert.notEqual(players[1].options.invertPitch, true, 'the host seat 2 setting must not invert the guest plane');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
    PLAYER_LABEL_STYLES,
    formatPlayerDisplayLabel,
} from '../src/shared/contracts/PlayerDisplayLabelContract.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { resolveRuntimeNetworkPlayerSlots } from '../src/core/runtime/RuntimeNetworkPlayerSlots.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
import { formatPlayerName, resolveWinnerLabel } from '../src/ui/postmatch/PostMatchLabels.js';

test('a named human shows the name, others fall back to the seat, bots stay bots', () => {
    assert.equal(formatPlayerDisplayLabel({ index: 1, name: '  Blitz ' }), 'Blitz');
    assert.equal(formatPlayerDisplayLabel({ index: 0 }), 'P1');
    assert.equal(formatPlayerDisplayLabel({ playerIndex: 2 }, { style: PLAYER_LABEL_STYLES.LONG }), 'Spieler 3');
    assert.equal(formatPlayerDisplayLabel({ index: 2, isBot: true, name: 'Blitz' }), 'Bot 3');
    assert.equal(formatPlayerDisplayLabel(null), 'P1');
});

test('lobby names reach the network slots even when the session player list repeats a peer', () => {
    const slots = resolveRuntimeNetworkPlayerSlots({
        lobbyState: {
            hostPeerId: 'host',
            members: [
                { peerId: 'host', name: 'Kapitän', isHost: true },
                { peerId: 'peer-b', name: 'Blitz', joinedAt: 5 },
            ],
        },
        session: { isHost: true, localPlayerId: 'host', getPlayers: () => [{ id: 'peer-b', name: 'peer-b' }] },
    });
    assert.deepEqual(slots.map((slot) => [slot.playerIndex, slot.displayName]), [[0, 'Kapitän'], [1, 'Blitz']]);
    assert.deepEqual(slots.map((slot) => slot.teamId), ['ALPHA', 'BRAVO']);
});

test('network team assignments reach team match player configs', () => {
    const configs = buildHumanConfigs({}, {
        session: {
            numHumans: 1,
            humanEntityCount: 2,
            networkPlayerSlots: [
                { playerIndex: 0, teamId: 'BRAVO' },
                { playerIndex: 1, teamId: 'ALPHA' },
            ],
        },
        hunt: { teamMode: true, teamSize: 2 },
    });
    assert.deepEqual(configs.map((config) => config.teamId), ['BRAVO', 'ALPHA']);
});

test('match setup hands each networked human its lobby name', () => {
    const configs = buildHumanConfigs({}, {
        session: {
            numHumans: 1,
            humanEntityCount: 3,
            networkPlayerSlots: [
                { playerIndex: 0, displayName: 'Kapitän' },
                { playerIndex: 1, displayName: 'Blitz' },
                { playerIndex: 2, name: 'peer-c' },
            ],
        },
    });
    assert.deepEqual(configs.map((config) => config.name ?? null), ['Kapitän', 'Blitz', null]);
});

test('the HUD projection keeps the player name', () => {
    assert.equal(createMatchRuntimePlayerProjection({ playerIndex: 1, name: 'Blitz' }).name, 'Blitz');
    assert.equal(createMatchRuntimePlayerProjection({ playerIndex: 1 }).name, '');
});

test('the result screen names the player and the round winner', () => {
    const players = [{ index: 0, name: 'Kapitän' }, { index: 1, isBot: true }];
    assert.equal(formatPlayerName(players[0]), 'Kapitän');
    assert.equal(formatPlayerName({ index: 3 }), 'Spieler 4');
    assert.equal(resolveWinnerLabel({ winnerIndex: 0 }, players), 'Kapitän');
});

test('every match label goes through the one shared helper', () => {
    const files = [
        'src/hunt/RespawnSystem.js',
        'src/hunt/HuntScoring.js',
        'src/hunt/HuntEliminationFeed.js',
        'src/core/main.js',
        'src/state/RoundStateOps.js',
        'src/ui/MatchScoreHudPresenter.js',
        'src/ui/postmatch/PostMatchLabels.js',
        'src/ui/MatchFlowTelemetryController.js',
        'src/shared/runtime/MatchRuntimeProjectionBuilder.js',
    ];
    for (const file of files) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(source, /formatPlayerDisplayLabel|name: /, `${file} uses the shared label or forwards the name`);
        assert.doesNotMatch(source, /isBot \? `Bot \$\{[^}]+\}` : `(P|Spieler )\$\{/, `${file} still builds its own label`);
    }
});

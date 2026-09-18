import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { resolveLocalHudHumans, resolveLocalHudTile } from '../src/ui/LocalHudPlayers.js';

test('the fight panels and the network score tile use the local-player helper', () => {
    const hunt = readFileSync(new URL('../src/ui/HuntHUD.js', import.meta.url), 'utf8');
    assert.match(hunt, /resolveLocalHudHumans\(/);
    const runtime = readFileSync(new URL('../src/ui/HudRuntimeSystem.js', import.meta.url), 'utf8');
    assert.match(runtime, /resolveLocalHudTile\(/);
});

const players = [
    { playerIndex: 0, name: 'Kapitän', score: 3 },
    { playerIndex: 1, name: 'Blitz', score: 1 },
    { playerIndex: 2, isBot: true, score: 9 },
];

test('in a network match each screen shows only its own player', () => {
    const guestView = { isNetworkSession: true, localPlayerIndex: 1, players };
    assert.deepEqual(resolveLocalHudHumans(guestView).map((player) => player.name), ['Blitz']);
    const bySessionPlayers = { isNetworkSession: true, sessionPlayers: [{ playerIndex: 1, isLocal: true }], players };
    assert.deepEqual(resolveLocalHudHumans(bySessionPlayers).map((player) => player.name), ['Blitz']);
});

test('a local match keeps every human, bots stay out', () => {
    assert.deepEqual(resolveLocalHudHumans({ isNetworkSession: false, players }).map((player) => player.name), ['Kapitän', 'Blitz']);
});

test('the top-left tile names the own player and counts like the scoreboard', () => {
    const view = { isNetworkSession: true, localPlayerIndex: 1, players };
    assert.deepEqual(resolveLocalHudTile(view), { name: 'Blitz', score: '1' });
    const fight = { ...view, hunt: { active: true, scoreboardRows: [{ playerIndex: 1, kills: 4 }] } };
    assert.deepEqual(resolveLocalHudTile(fight), { name: 'Blitz', score: '4' }, 'fight counts kills like the scoreboard');
    assert.equal(resolveLocalHudTile({ isNetworkSession: true, localPlayerIndex: 5, players }), null);
});

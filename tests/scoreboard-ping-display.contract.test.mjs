import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import { MatchScoreHudPresenter } from '../src/ui/MatchScoreHudPresenter.js';

/** Just enough DOM for the scoreboard rows: class toggles, text and child lists. */
function createElement(documentRef, tagName = 'div') {
    const classes = new Set();
    const attributes = new Map();
    return {
        tagName,
        ownerDocument: documentRef,
        children: [],
        textContent: '',
        className: '',
        dataset: {},
        classList: {
            add(value) { classes.add(value); },
            remove(value) { classes.delete(value); },
            contains(value) { return classes.has(value); },
            toggle(value, force) { if (force) classes.add(value); else classes.delete(value); },
        },
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
        get lastChild() { return this.children.at(-1) || null; },
        querySelector() { return null; },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name) || null; },
        remove() { this.removed = true; },
    };
}

function createHud() {
    const documentRef = { createElement(tagName) { return createElement(this, tagName); } };
    return createElement(documentRef);
}

/**
 * A networked match as the runtime hands it over: the lobby slots carry no ping, because no
 * round trip has been measured for them (the slots never get one), plus one bot.
 */
function createNetworkGame() {
    return {
        runtimeConfig: {
            session: {
                networkEnabled: true,
                localPlayerIndex: 0,
                networkPlayerSlots: [
                    { peerId: 'host', playerIndex: 0, isLocal: true },
                    { peerId: 'peer-b', playerIndex: 1 },
                ],
            },
        },
        entityManager: {
            players: [
                { index: 0, score: 2, alive: true },
                { index: 1, score: 1, alive: true },
                { index: 2, score: 0, alive: true, isBot: true },
            ],
        },
    };
}

function readPingCells(projection) {
    const presenter = new MatchScoreHudPresenter(createHud());
    presenter.updateNetwork(projection, [], 0);
    const cells = new Map();
    for (const row of presenter.networkBoard.children) cells.set(row.children[0].textContent, row.children[2].textContent);
    return cells;
}

test('the scoreboard shows no 0ms for a player whose ping was never measured', () => {
    const game = createNetworkGame();
    const projection = buildMatchRuntimeProjection({ game, runtimeState: { entityManager: game.entityManager }, facade: null, sessionRuntime: null });

    const remote = projection.sessionPlayers.find((entry) => entry.playerIndex === 1);
    assert.equal(remote.pingMs, -1, 'a missing measurement stays "no value" instead of becoming 0 ms');

    const cells = readPingCells(projection);
    assert.equal(cells.get('P2'), '–', 'the remote player without a measurement shows a dash');
    assert.equal(cells.get('P1'), '', 'the own row shows no ping to itself');
    assert.equal(cells.get('Bot 3'), '', 'a bot has no network ping to show');
});

test('a measured ping still reaches the scoreboard', () => {
    const cells = readPingCells({
        players: [{ playerIndex: 0, score: 1 }, { playerIndex: 1, score: 0 }],
        sessionPlayers: [{ playerIndex: 0, pingMs: -1, isLocal: true }, { playerIndex: 1, pingMs: 37 }],
    });
    assert.equal(cells.get('P2'), '37ms');
});

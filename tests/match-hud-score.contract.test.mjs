import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MatchHudAnnouncement,
    MatchHudEventState,
    rankScoreRows,
    scoreRank,
} from '../src/ui/MatchHudAnnouncement.js';
import { MatchScoreHudPresenter } from '../src/ui/MatchScoreHudPresenter.js';
import { formatHuntScoreboard, updateHuntTargetProgress } from '../src/ui/HuntMatchStatusHelpers.js';

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
            toggle(value, force) {
                if (force) classes.add(value);
                else classes.delete(value);
            },
        },
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) {
            this.children.splice(this.children.indexOf(child), 1);
        },
        replaceChildren() { this.children.length = 0; },
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

test('ranking keeps ties stable and gives tied players the same rank', () => {
    const rows = [
        { playerIndex: 2, score: 4 },
        { playerIndex: 0, score: 7 },
        { playerIndex: 1, score: 7 },
    ];
    assert.deepEqual(rankScoreRows(rows).map((row) => row.playerIndex), [0, 1, 2]);
    assert.equal(scoreRank(rows, 0), 1);
    assert.equal(scoreRank(rows, 1), 1);
    assert.equal(scoreRank(rows, 2), 3);
    assert.deepEqual(rows.map((row) => row.playerIndex), [2, 0, 1]);
});

test('leader events skip the opening state and ties, deduplicate, then reset', () => {
    const state = new MatchHudEventState();
    const rows = [
        { playerIndex: 0, label: 'P1', score: 0 },
        { playerIndex: 1, label: 'P2', score: 0 },
    ];
    assert.equal(state.consume(rows), null);
    rows[0].score = 1;
    assert.equal(state.consume(rows), 'P1 übernimmt die Führung');
    assert.equal(state.consume(rows), null);
    rows[1].score = 1;
    assert.equal(state.consume(rows), null);
    rows[0].score = 2;
    assert.equal(state.consume(rows), 'P1 übernimmt die Führung');
    rows[1].score = 2;
    assert.equal(state.consume(rows), null);
    rows[1].score = 3;
    assert.equal(state.consume(rows), 'P2 übernimmt die Führung');
    assert.equal(state.consume(rows), null);
    state.reset();
    assert.equal(state.consume(rows), null);
});

test('match point fires once for a real target and an announcement reset removes its timer', () => {
    const hud = createHud();
    const announcement = new MatchHudAnnouncement(hud);
    const rows = [
        { playerIndex: 0, label: 'P1', kills: 8 },
        { playerIndex: 1, label: 'P2', kills: 7 },
    ];
    announcement.observe(rows, { scoreKey: 'kills', target: 10 });
    assert.equal(hud.children.length, 0);
    rows[0].kills = 9;
    announcement.observe(rows, { scoreKey: 'kills', target: 10 });
    assert.equal(hud.children[0].textContent, 'Matchball für P1');
    const timer = announcement.timerId;
    announcement.observe(rows, { scoreKey: 'kills', target: 10 });
    assert.equal(announcement.timerId, timer);
    announcement.reset();
    assert.equal(announcement.timerId, null);
    assert.equal(hud.children[0].removed, true);
    assert.equal(announcement.state.consume(rows, { scoreKey: 'kills', target: 10 }), null);
});

test('network board sorts scores, highlights local player, and retains every ping', () => {
    const hud = createHud();
    const presenter = new MatchScoreHudPresenter(hud);
    const projection = {
        players: [
            { playerIndex: 2, score: 3 },
            { playerIndex: 0, score: 8 },
            { playerIndex: 1, score: 8 },
        ],
        sessionPlayers: [
            { playerIndex: 2, pingMs: 52 },
            { playerIndex: 0, pingMs: 18 },
            { playerIndex: 1, pingMs: 27 },
        ],
        hunt: { active: true },
    };
    presenter.updateNetwork(projection, [], 2);
    const rows = presenter.networkBoard.children;
    assert.deepEqual(rows.map((row) => row.children[0].textContent), ['P1', 'P2', 'P3']);
    assert.deepEqual(rows.map((row) => row.children[2].textContent), ['18ms', '27ms', '52ms']);
    assert.equal(rows[2].classList.contains('is-local'), true);
    assert.equal(rows.some((row) => row.classList.contains('is-leading')), false);
    projection.players[0].score = 9;
    presenter.updateNetwork(projection, [], 2);
    assert.equal(rows[0].children[0].textContent, 'P3');
    assert.equal(rows[0].classList.contains('is-leading'), true);
    presenter.dispose();
    assert.equal(hud.children[0].removed, true);
});

test('network Fight orders all participants by authoritative kills and keeps ping', () => {
    const presenter = new MatchScoreHudPresenter(createHud());
    presenter.updateNetwork({
        players: [
            { playerIndex: 0, score: 9 },
            { playerIndex: 1, score: 1 },
            { playerIndex: 2, score: 4 },
        ],
        sessionPlayers: [{ playerIndex: 2, pingMs: 44 }],
        hunt: { active: true, scoreboardRows: [
            { playerIndex: 1, kills: 5 },
            { playerIndex: 0, kills: 2 },
        ] },
    }, [], 2);
    const rows = presenter.networkBoard.children;
    assert.deepEqual(rows.map((row) => row.children[0].textContent), ['P2', 'P1', 'P3']);
    assert.deepEqual(rows.map((row) => row.children[1].textContent), ['5', '2', '0']);
    assert.equal(rows[2].children[2].textContent, '44ms');
    assert.equal(rows[2].classList.contains('is-local'), true);
    presenter.dispose();
});

test('Fight keeps the local player beside the leaders', () => {
    const rows = [
        { playerIndex: 0, label: 'P1', kills: 8 },
        { playerIndex: 1, label: 'P2', kills: 7 },
        { playerIndex: 2, label: 'P3', kills: 6 },
        { playerIndex: 3, label: 'P4', kills: 1 },
    ];
    assert.equal(formatHuntScoreboard(rows, 3), 'P1 8   |   P2 7   |   P3 6   |   ▶ P4 1');
});

test('fight target ticks rebuild only for target changes and hide in elimination', () => {
    const hud = createHud();
    const progress = hud.ownerDocument.createElement('div');
    const state = { target: 0, filled: -1 };
    updateHuntTargetProgress(progress, state, 10, 4);
    assert.equal(progress.children.length, 10);
    assert.equal(progress.children.filter((cell) => cell.classList.contains('filled')).length, 4);
    const firstCell = progress.children[0];
    updateHuntTargetProgress(progress, state, 10, 5);
    assert.equal(progress.children[0], firstCell);
    updateHuntTargetProgress(progress, state, 0, 0);
    assert.equal(progress.classList.contains('hidden'), true);
});

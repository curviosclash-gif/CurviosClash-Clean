import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHuntScoreboard, resolveHuntObjectiveText } from '../src/ui/HuntMatchStatusHelpers.js';
import { formatMenuRulesSummary } from '../src/ui/start-setup/StartSetupMultiplayerUiSync.js';
import { resolveObjectiveLabel } from '../src/ui/postmatch/PostMatchLabels.js';
import { MatchScoreHudPresenter } from '../src/ui/MatchScoreHudPresenter.js';

function element(documentRef) {
    const classes = new Set();
    const attributes = new Map();
    return {
        ownerDocument: documentRef, children: [], dataset: {}, textContent: '',
        classList: {
            add: (key) => classes.add(key),
            toggle: (key, on) => on ? classes.add(key) : classes.delete(key),
            contains: (key) => classes.has(key),
        },
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
        get lastChild() { return this.children.at(-1); },
        querySelector() { return null; },
        setAttribute(key, value) { attributes.set(key, value); },
        getAttribute(key) { return attributes.get(key) || null; },
        remove() {},
    };
}

test('HUNT status names the selected objective and uses its ranking value', () => {
    const rows = [{ playerIndex: 0, label: 'P1', kills: 1, points: 3 }];
    assert.match(resolveHuntObjectiveText({ respawnEnabled: true, winCondition: 'score_target' }, {},
        { killLimit: 10, timeText: '', matchPointText: '' }), /10 Punkte/);
    assert.match(resolveHuntObjectiveText({ respawnEnabled: true, winCondition: 'last_alive' }, {},
        { killLimit: 10, timeText: '', matchPointText: '' }), /3 Leben/);
    assert.equal(formatHuntScoreboard(rows, [0], '', 'score_target'), '▶ P1 3');
    assert.equal(formatHuntScoreboard(rows, [0], '', 'kills_time'), '▶ P1 1');
    assert.equal(formatHuntScoreboard(rows, [0], '', 'last_alive'), '▶ P1 3');
    assert.equal(resolveHuntObjectiveText({ escortMode: true }, {},
        { killLimit: 10, timeText: ' · 5:00', matchPointText: '' }), 'Eskorte · Team Blau schützt den Panzer · 5:00');
    assert.equal(resolveHuntObjectiveText({ teamObjective: 'FLAGS', flagCounts: { ALPHA: 4, BRAVO: 2 } }, {},
        { killLimit: 10, timeText: '', matchPointText: '' }), 'Flaggen · Blau 4:2 Orange');
});

test('menu and postmatch use the objective selected for the round', () => {
    const base = { numBots: 0, winsNeeded: 1, gameMode: 'HUNT' };
    assert.match(formatMenuRulesSummary({ ...base, hunt: { respawnEnabled: true,
        winCondition: 'score_target', deathmatchKillLimit: 20 } }, 'fight'), /20 Punkte/);
    assert.match(formatMenuRulesSummary({ ...base, hunt: { respawnEnabled: true,
        winCondition: 'last_alive' } }, 'fight'), /3 Leben/);
    assert.equal(resolveObjectiveLabel('SCORE_TARGET'), 'Punktziel erreicht');
    assert.equal(resolveObjectiveLabel('LAST_ALIVE'), 'Letzter Überlebender');
});

test('network board ranks score target by points and last alive by remaining lives', () => {
    const doc = { createElement() { return element(this); } };
    const presenter = new MatchScoreHudPresenter(element(doc));
    const projection = {
        players: [{ playerIndex: 0, score: 100 }, { playerIndex: 1, score: 1 }],
        hunt: { active: true, winCondition: 'score_target', scoreboardRows: [
            { playerIndex: 0, kills: 6, points: 2 }, { playerIndex: 1, kills: 1, points: 4 },
        ] },
    };
    presenter.updateNetwork(projection, [], 0);
    assert.deepEqual(presenter.networkBoard.children.map((row) => row.children[0].textContent), ['P2', 'P1']);
    assert.deepEqual(presenter.networkBoard.children.map((row) => row.children[1].textContent), ['4', '2']);
    assert.match(presenter.networkBoard.getAttribute('aria-label'), /Punkten/);
    projection.hunt.winCondition = 'last_alive';
    projection.hunt.livesRemainingByPlayer = { 0: 1, 1: 3 };
    presenter.updateNetwork(projection, [], 0);
    assert.deepEqual(presenter.networkBoard.children.map((row) => row.children[1].textContent), ['3', '1']);
    assert.match(presenter.networkBoard.getAttribute('aria-label'), /Leben/);
});

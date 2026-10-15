import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement } from './helpers/fake-hangar-dom.mjs';
import { renderArcadeJourneyResult, requestArcadeJourneyResultAction } from '../src/ui/arcade/ArcadeJourneyResultView.js';
import { syncArcadeNightmareToggle } from '../src/ui/arcade/ArcadeNightmareToggle.js';
import { ARCADE_DIFFICULTY_SCHEMA_VERSION } from '../src/shared/contracts/ArcadeDifficultyContract.js';

function panelFor(pending = false, action = () => {}) {
    const panel = new FakeElement('section');
    panel.replaceChildren = () => { panel.children.length = 0; };
    const state = { vehicleXpEarned: 123, journey: { stageId: 'first_run', medal: 2, result: { succeeded: true },
        pending, nextStageId: 'five_portals', recipients: [{ profileId: 'a', status: pending ? 'pending' : 'saved', rank: 2, count: 5 }] } };
    assert.equal(renderArcadeJourneyResult(panel, state, action), true);
    const button = name => panel.querySelectorAll(`[data-journey-action="${name}"]`)[0];
    return { panel, button };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('result shows medal, actual primary XP and rank; pending storage blocks another run', () => {
    const { panel, button } = panelFor(true);
    const text = panel.children.map(node => node.textContent).join(' ');
    assert.match(text, /Silber/); assert.match(text, /123 Fahrzeug-XP/); assert.match(text, /Platz 2 von 5/);
    assert.equal(button('retry').disabled, true); assert.equal(button('next').disabled, true);
    assert.equal(button('map').disabled, false); assert.equal(button('hangar').disabled, false);
});

test('result actions accept only one click until completion and recover after a rejected lifecycle', async () => {
    const actions = []; let reject;
    const { panel, button } = panelFor(false, (action, stageId) => {
        actions.push([action, stageId]); return new Promise((_resolve, fail) => { reject = fail; });
    });
    button('next').click(); button('retry').click(); await flush();
    assert.deepEqual(actions, [['next', 'five_portals']]);
    reject(new Error('menu transition failed')); await flush();
    assert.equal(button('retry').disabled, false); assert.equal(button('next').disabled, false);
    assert.match(panel.children.map(node => node.textContent).join(' '), /erneut versuchen/);
});

test('result waits for menu teardown before selecting, starting or opening the hangar', async () => {
    const events = []; let finish;
    const controller = { runtimePort: { returnToMenu: () => {
        events.push('return'); return new Promise(resolve => { finish = resolve; });
    } }, game: { ui: { arcadeJourneyOpenStage: id => events.push(`select:${id}`),
        arcadeJourneyStartButtons: { five_portals: { click: () => events.push('start') } },
        arcadeJourneyHangarButton: { click: () => events.push('hangar') } } } };
    const next = requestArcadeJourneyResultAction(controller, 'next', 'five_portals');
    assert.deepEqual(events, ['return']); finish(); await next;
    assert.deepEqual(events, ['return', 'select:five_portals', 'start']);
    const hangar = requestArcadeJourneyResultAction(controller, 'hangar', 'five_portals'); finish(); await hangar;
    assert.deepEqual(events.slice(-3), ['return', 'select:five_portals', 'hangar']);
});

test('journey hub tier remains selectable after a portal or Daily; their runtime grading stays independent', () => {
    const store = { readJsonRecordResult: () => ({ status: 'found', value: {
        schemaVersion: ARCADE_DIFFICULTY_SCHEMA_VERSION, unlockedTierIds: ['normal', 'hard'] } }) };
    for (const arcade of [{ runType: 'five_portals', difficultyTierId: 'hard' },
        { runType: 'gauntlet', dailyChallenge: true, difficultyTierId: 'hard' }]) {
        const input = { options: ['normal', 'hard', 'nightmare'].map(value => ({ value })) };
        syncArcadeNightmareToggle(input, { arcade }, store, { journeyHub: true });
        assert.equal(input.disabled, false); assert.equal(input.value, 'hard');
        assert.equal(input.options[2].disabled, true);
        syncArcadeNightmareToggle(input, { arcade }, store);
        assert.equal(input.disabled, true);
    }
});

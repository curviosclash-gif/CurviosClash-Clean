import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeCompanionHUD, selectArcadeCompanions } from '../src/ui/arcade/ArcadeCompanionHUD.js';
import { bindArcadeCompanionToggle, createArcadeCompanionToggle, syncArcadeCompanionToggle } from '../src/ui/arcade/ArcadeCompanionToggle.js';

/** A tiny document: elements keep children, text, style and attributes, enough for the HUD and the select. */
function createFakeDocument() {
    const createElement = (tag) => ({
        tag, children: [], style: {}, textContent: '', attributes: {},
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { this.removed = true; },
    });
    return { createElement, body: createElement('body') };
}

const projected = (playerIndex, isBot, teamId, hp, extra = {}) => ({ playerIndex, isBot, teamId, hp, maxHp: 100, alive: true, ...extra });

test('only bots on the human team count as companions', () => {
    assert.deepEqual(selectArcadeCompanions([projected(0, false, null, 100), projected(1, true, null, 100)]), [], 'a solo run has none');
    const players = [projected(0, false, 'ALPHA', 100), projected(1, true, 'BRAVO', 100), projected(4, true, 'ALPHA', 60), projected(5, true, 'ALPHA', 0, { alive: false })];
    assert.deepEqual(selectArcadeCompanions(players).map((player) => player.playerIndex), [4, 5]);
});

test('the companion panel shows each companion with its health and marks a fallen one', () => {
    const doc = createFakeDocument();
    const hud = new ArcadeCompanionHUD(doc.body, doc);
    const container = doc.body.children[0];
    hud.update([projected(0, false, null, 100)]);
    assert.equal(container.style.display, 'none', 'no companions, no panel');
    hud.update([projected(0, false, 'ALPHA', 100), projected(4, true, 'ALPHA', 60), projected(5, true, 'ALPHA', 0, { alive: false })]);
    assert.equal(container.style.display, 'flex');
    const [first, second] = container.children;
    const status = (row) => row.children[2].textContent;
    const fill = (row) => row.children[1].children[0].style.width;
    assert.deepEqual([status(first), fill(first)], ['60%', '60%']);
    assert.deepEqual([status(second), fill(second)], ['ausgeschaltet', '0%']);
    hud.dispose();
    assert.equal(container.removed, true);
});

test('the menu select writes the companion count and locks outside the normal run', () => {
    const doc = createFakeDocument();
    const { input } = createArcadeCompanionToggle(doc);
    assert.deepEqual(input.children.map((option) => option.value), ['0', '1', '2']);
    const settings = { arcade: { runType: 'gauntlet' } };
    let handler = null;
    let changes = 0;
    bindArcadeCompanionToggle(input, settings, (_el, type, fn) => { if (type === 'change') handler = fn; }, () => { changes += 1; });
    input.value = '2'; handler();
    assert.deepEqual([settings.arcade.companionCount, changes], [2, 1]);
    syncArcadeCompanionToggle(input, settings);
    assert.deepEqual([input.value, input.disabled], ['2', false]);
    syncArcadeCompanionToggle(input, { arcade: { ...settings.arcade, dailyChallenge: true } });
    assert.deepEqual([input.value, input.disabled], ['0', true], 'the daily locks the choice');
    syncArcadeCompanionToggle(input, { arcade: { runType: 'arena_waves', companionCount: 2 } });
    assert.equal(input.disabled, true, 'special runs lock it too');
});

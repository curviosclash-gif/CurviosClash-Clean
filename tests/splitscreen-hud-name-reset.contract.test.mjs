import test from 'node:test';
import assert from 'node:assert/strict';

import { HudRuntimeSystem } from '../src/ui/HudRuntimeSystem.js';

test('a local match after a network match shows "Spieler 1" again on the top-left tile', () => {
    const text = (value) => ({ textContent: value });
    const game = {
        ui: { p1Name: text('Spieler 3'), p1Score: text('0'), p2Score: text('0') },
        entityManager: { players: [] },
    };
    const hud = new HudRuntimeSystem({ game, ports: null });
    hud._updateItemBar = () => {};
    const projection = {
        players: [{ playerIndex: 0, isBot: false, score: 2 }, { playerIndex: 1, isBot: false, score: 1 }],
    };

    hud.updateScoreHud(projection);

    assert.equal(game.ui.p1Name.textContent, 'Spieler 1');
    assert.equal(game.ui.p1Score.textContent, '2');
});

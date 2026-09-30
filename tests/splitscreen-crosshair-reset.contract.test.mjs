import test from 'node:test';
import assert from 'node:assert/strict';

import { CrosshairSystem } from '../src/ui/CrosshairSystem.js';
import { MatchFlowUiController } from '../src/ui/MatchFlowUiController.js';

function createElement() {
    const properties = new Map();
    return {
        style: {
            display: 'block',
            setProperty: (key, value) => properties.set(key, value),
        },
        classList: { toggle() {} },
    };
}

test('return to the menu hides the third crosshair and every MG aim dot', () => {
    const crosshairP1 = createElement();
    const crosshairP2 = createElement();
    const crosshairP3 = createElement();
    const dotP1 = createElement();
    const dotP3 = createElement();
    const game = { ui: { crosshairP1, crosshairP2 } };
    const crosshairSystem = new CrosshairSystem({ game });
    crosshairSystem._extraCrosshairs.set(2, crosshairP3);
    crosshairSystem._mgAimDotByCrosshair.set(crosshairP1, dotP1);
    crosshairSystem._mgAimDotByCrosshair.set(crosshairP3, dotP3);
    game.crosshairSystem = crosshairSystem;

    MatchFlowUiController.prototype.resetCrosshairUi.call({
        game,
        resetCrosshairElementUi: MatchFlowUiController.prototype.resetCrosshairElementUi,
    });

    for (const element of [crosshairP1, crosshairP2, crosshairP3, dotP1, dotP3]) {
        assert.equal(element.style.display, 'none');
    }
});

// Arcade result panels (intermission, victory, result, the Five Fronts upgrade choice) must not
// sit under the in-match HUD: the hunt header, the parcours checkpoint line and the minimap covered
// titles and scores in the 17.09.2026 playtest, and a "+10 XP" flash stayed on top of the menu.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MatchFlowArcadeOverlayController } from '../src/ui/MatchFlowArcadeOverlayController.js';
import { ParcoursOverlayController } from '../src/ui/arcade/ParcoursOverlayController.js';
import { HudRuntimeSystem } from '../src/ui/HudRuntimeSystem.js';

function stubElement(tagName = 'div') {
    const classes = new Set();
    const element = {
        tagName, id: '', className: '', textContent: '', children: [], style: {}, attributes: {},
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren() { this.children.length = 0; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        addEventListener() {},
        focus() {},
        querySelector() { return null; },
    };
    element.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
    };
    return element;
}

test('the Five Fronts upgrade choice marks the overlay as an arcade result', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: (tagName) => stubElement(tagName) };
    try {
        const overlay = stubElement();
        overlay.classList.add('hidden');
        const controller = new MatchFlowArcadeOverlayController({
            runtime: { state: 'ROUND_END', roundPause: 3, ui: { messageOverlay: overlay } },
            runtimePort: {
                getMatchRuntimeProjection: () => ({ arcade: { enabled: true } }),
                getArcadeMenuSurfaceState: () => ({ runType: 'arena_waves', phase: 'upgrade', choices: ['speed'] }),
            },
        });

        controller.syncArcadeOverlayPanel();

        assert.equal(overlay.classList.contains('hidden'), false);
        assert.equal(overlay.classList.contains('has-arcade-results'), true,
            'the round board stats and the combat HUD must step back behind the upgrade choice');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('an arcade result hides every in-match HUD layer that can cover it', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const rule = css.match(/body:has\(#message-overlay\.has-arcade-results:not\(\.hidden\)\)\s*:is\(([^)]*)\)/);
    assert.ok(rule, 'the arcade result hide rule exists');
    const selectors = rule[1].split(',').map((entry) => entry.trim());
    for (const id of ['#arcade-score-hud', '#hunt-hud', '#parcours-hud', '#p2-parcours-hud', '#parcours-minimap']) {
        assert.ok(selectors.includes(id), `${id} is hidden behind arcade results, got: ${selectors.join(' ')}`);
    }
});

test('returning to the menu hides the short parcours flashes such as "+10 XP"', () => {
    const flash = stubElement();
    const overlay = new ParcoursOverlayController();
    overlay._xpNotificationOverlay = flash;
    overlay._splitDeltaOverlay = stubElement();
    overlay._penaltyOverlay = stubElement();

    HudRuntimeSystem.prototype.clearNetworkScoreboard.call({
        _scorePresenter: null,
        _setParcoursHudVisible() {},
        _hideArcadeHud() {},
        _parcoursOverlay: overlay,
    });

    assert.equal(flash.classList.contains('hidden'), true);
    assert.equal(overlay._splitDeltaOverlay.classList.contains('hidden'), true);
    assert.equal(overlay._penaltyOverlay.classList.contains('hidden'), true);
});

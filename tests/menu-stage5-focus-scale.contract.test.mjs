import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyMenuScale } from '../src/ui/menu/MenuGraphicsStyleBindings.js';
import { moveMainMenuFocus } from '../src/ui/menu/MenuNavigationFocusOps.js';

function makeAction(x, y, width = 100, height = 40) {
    return {
        focused: false,
        getBoundingClientRect: () => ({ x, y, width, height }),
        focus() { this.focused = true; },
    };
}

test('menu scale reaches pause font tokens through the document root cascade', () => {
    const rootProperties = new Map();
    const documentElement = { style: { setProperty: (name, value) => rootProperties.set(name, value) } };
    const document = { documentElement };
    const body = { parentElement: documentElement };
    const uiLayer = { parentElement: body };
    const mainMenu = { ownerDocument: document, parentElement: uiLayer };
    const hud = { parentElement: uiLayer };
    const pauseOverlay = { parentElement: hud };
    const ui = {
        mainMenu,
        pauseOverlay,
        menuScaleSlider: { value: '' },
        menuScaleLabel: { textContent: '' },
    };

    applyMenuScale(ui, 150);

    assert.equal(rootProperties.get('--menu-scale'), '1.5');
    assert.equal(ui.menuScaleSlider.value, '150');
    assert.ok(ui.menuScaleLabel.textContent.length > 0);

    const tokens = readFileSync(new URL('../src/ui/menu/MenuTokens.css', import.meta.url), 'utf8');
    const pause = readFileSync(new URL('../src/ui/menu/MenuPause.css', import.meta.url), 'utf8');
    assert.match(tokens, /--menu-font-size-body:\s*max\(16px,\s*calc\(16px \* var\(--menu-scale\)\)\)/u);
    assert.match(tokens, /--menu-font-size-button:\s*max\(16px,\s*calc\(17px \* var\(--menu-scale\)\)\)/u);
    assert.match(pause, /font-size:\s*var\(--menu-font-size-body\)/u);
    assert.match(pause, /font-size:\s*var\(--menu-font-size-button\)/u);

    const inheritedScale = Number(rootProperties.get('--menu-scale'));
    assert.equal(inheritedScale * 16, 24, 'Pause body text resolves to 24px at 150%');
    assert.equal(inheritedScale * 17, 25.5, 'Pause buttons resolve to 25.5px at 150%');
    assert.strictEqual(pauseOverlay.parentElement.parentElement.parentElement.parentElement, documentElement);
});

test('vertical gamepad focus rejects laterally displaced actions outside the direction cone', () => {
    const active = makeAction(100, 100);
    const falseLateral = makeAction(220, 104);
    const below = makeAction(105, 190);

    moveMainMenuFocus([active, falseLateral, below], 'down', active);

    assert.equal(below.focused, true);
    assert.equal(falseLateral.focused, false);
});

test('horizontal gamepad focus keeps actions on the current row', () => {
    const active = makeAction(100, 100);
    const falseVertical = makeAction(103, 180);
    const right = makeAction(220, 105);

    moveMainMenuFocus([active, falseVertical, right], 'right', active);

    assert.equal(right.focused, true);
    assert.equal(falseVertical.focused, false);
});

test('vertical focus reaches a wide primary action above the left dock tile', () => {
    const active = makeAction(100, 300, 330, 112);
    const primary = makeAction(200, 100, 600, 108);

    moveMainMenuFocus([active, primary], 'up', active);

    assert.equal(primary.focused, true);
});

test('the dock primary and title use Style Q tokens instead of legacy overrides', () => {
    const css = readFileSync(new URL('../src/ui/menu/Leuchtspuren.css', import.meta.url), 'utf8');
    const primaryRule = [...css.matchAll(/#main-menu\[data-menu-depth="1"\] \.menu-primary-start \{([^}]*)\}/gu)]
        .map((match) => match[1])
        .find((rule) => rule.includes('border-radius'));
    const titleRule = css.match(/#main-menu\[data-menu-depth="1"\] #main-menu-title, #main-menu \.menu-primary-start-label \{([^}]*)\}/u)?.[1];
    const navRule = css.match(/#main-menu\[data-menu-depth="1"\] \.nav-btn \{([^}]*)\}/u)?.[1];

    assert.ok(primaryRule, 'the dock primary style exists');
    assert.match(primaryRule, /border-radius:\s*var\(--menu-radius-m\)/u);
    assert.match(primaryRule, /background:\s*var\(--menu-accent\)/u);
    assert.match(primaryRule, /box-shadow:\s*var\(--menu-primary-edge\)/u);
    assert.doesNotMatch(primaryRule, /linear-gradient|font-size:\s*14px/u);
    assert.match(titleRule, /font-family:\s*var\(--menu-font-display\)/u);
    assert.doesNotMatch(titleRule, /menu-theme-ui-font|750/u);
    assert.match(navRule, /border-radius:\s*var\(--menu-radius-m\)/u);
    assert.doesNotMatch(navRule, /font-size:\s*14px/u);
});

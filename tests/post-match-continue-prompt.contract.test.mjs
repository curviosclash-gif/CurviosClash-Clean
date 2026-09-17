// P7c: the result board must show what the player can do - two buttons (continue / menu), the key
// hints and the input lock as a fill bar. Node has no browser, so a small document stub records
// every write the renderer makes; that stub counts write *attempts*, which is how the "nothing moves
// but the bar" assertion can tell a guarded renderer from one that rewrites the board every frame.
// The bar itself is one CSS custom property on the button, so a moving lock is exactly one write.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PostMatchContinuePrompt,
    resolveGamepadPauseHintText,
} from '../src/ui/postmatch/PostMatchContinuePrompt.js';
import {
    normalizeContinuePromptState,
    resolveContinuePromptProgress,
} from '../src/shared/contracts/MatchUiStateContract.js';
import { isContinueMouseEvent, isInteractiveContinueTarget } from '../src/shared/input/ContinueIntentOps.js';

// ---------------------------------------------------------------------------
// Document stub
// ---------------------------------------------------------------------------

function createStubClassList(element, writes) {
    const values = new Set();
    const sync = () => { element.className = [...values].join(' '); };
    return {
        add(...names) { writes.count += 1; for (const name of names) values.add(name); sync(); },
        remove(...names) { writes.count += 1; for (const name of names) values.delete(name); sync(); },
        contains(name) { return values.has(name); },
    };
}

function createStubStyle(writes) {
    const properties = new Map();
    return {
        setProperty(name, value) { writes.count += 1; properties.set(name, String(value)); },
        getPropertyValue(name) { return properties.get(name) ?? ''; },
    };
}

function createStubElement(tagName, writes) {
    let text = '';
    const element = {
        tagName,
        className: '',
        attributes: {},
        children: [],
        listeners: new Map(),
        disabled: false,
        style: createStubStyle(writes),
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren() { this.children.length = 0; },
        setAttribute(name, value) { writes.count += 1; this.attributes[name] = String(value); },
        getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
        hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
        addEventListener(type, handler) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(handler);
        },
        removeEventListener(type, handler) {
            const handlers = this.listeners.get(type) || [];
            const index = handlers.indexOf(handler);
            if (index >= 0) handlers.splice(index, 1);
        },
        // Mirrors a real click: the event carries the button itself as its target.
        click() {
            for (const handler of [...(this.listeners.get('click') || [])]) {
                handler({ type: 'click', button: 0, target: this });
            }
        },
    };
    Object.defineProperty(element, 'textContent', {
        get() { return text; },
        set(value) { writes.count += 1; text = String(value); },
    });
    element.classList = createStubClassList(element, writes);
    return element;
}

function createDom() {
    const writes = { count: 0 };
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: (tagName) => createStubElement(tagName, writes) };
    return {
        writes,
        createElement: (tagName = 'div') => createStubElement(tagName, writes),
        restore() {
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        },
    };
}

function withDom(run) {
    const dom = createDom();
    try {
        return run(dom);
    } finally {
        dom.restore();
    }
}

// ---------------------------------------------------------------------------
// Query helpers (the stub has no querySelector)
// ---------------------------------------------------------------------------

function findAll(root, predicate) {
    const found = [];
    const walk = (node) => {
        for (const child of node.children || []) {
            if (predicate(child)) found.push(child);
            walk(child);
        }
    };
    walk(root);
    return found;
}

function findFirst(root, predicate) {
    return findAll(root, predicate)[0] || null;
}

function actionButton(container, action) {
    return findFirst(container, (node) => node.getAttribute('data-postmatch-action') === action);
}

function hint(container, name) {
    return findFirst(container, (node) => node.getAttribute('data-postmatch-hint') === name);
}

function textOf(node) {
    if (!node) return '';
    let text = node.textContent || '';
    for (const child of node.children || []) text += textOf(child);
    return text;
}

function isHidden(node) {
    return !!node && node.classList.contains('hidden');
}

function progressOf(container) {
    return actionButton(container, 'continue').style.getPropertyValue('--progress');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function promptState(overrides = {}) {
    return {
        visible: true,
        canContinue: true,
        lockRemaining: 0,
        lockTotal: 0.75,
        phase: 'round_end',
        waitingForHost: false,
        ...overrides,
    };
}

function padList(...slots) {
    return slots.map((slot) => (slot ? { buttons: [] } : null));
}

function mountPrompt(dom, options = {}) {
    const container = dom.createElement('div');
    const calls = { menu: 0 };
    const prompt = new PostMatchContinuePrompt({
        container,
        onMenu: () => { calls.menu += 1; },
        getGamepads: options.getGamepads || (() => []),
        getControls: options.getControls || (() => null),
    });
    return { container, prompt, calls };
}

// ---------------------------------------------------------------------------
// Lock, bar and the two buttons
// ---------------------------------------------------------------------------

test('a running lock keeps continue disabled and fills the bar by the elapsed share', () => {
    withDom((dom) => {
        const { container, prompt } = mountPrompt(dom);
        prompt.apply(promptState({ canContinue: false, lockRemaining: 0.375, lockTotal: 0.75 }));

        const button = actionButton(container, 'continue');
        assert.ok(button, 'the board offers a continue button');
        assert.equal(button.tagName, 'button');
        assert.equal(button.getAttribute('type'), 'button');
        assert.equal(button.disabled, true, 'continue stays disabled while the lock runs');
        assert.equal(button.getAttribute('aria-disabled'), 'true');
        assert.equal(progressOf(container), '0.5', 'half the lock is half the bar');

        // The button has no action of its own: a press on it is the continue intent, and the
        // round state tick swallows that while the lock runs - one path for keys and clicks.
        assert.equal((button.listeners.get('click') || []).length, 0);
    });
});

test('after the lock the continue button is enabled and named after its board', () => {
    withDom((dom) => {
        const { container, prompt } = mountPrompt(dom);
        prompt.apply(promptState({ lockRemaining: 0 }));

        const button = actionButton(container, 'continue');
        assert.equal(button.disabled, false);
        assert.equal(button.getAttribute('aria-disabled'), 'false');
        assert.equal(progressOf(container), '1');
        assert.equal(button.textContent, 'Weiter');

        prompt.apply(promptState({ phase: 'match_end', lockTotal: 1.5, lockRemaining: 0 }));
        assert.equal(actionButton(container, 'continue').textContent, 'Neues Match');
    });
});

test('the menu button works while the lock is still running', () => {
    withDom((dom) => {
        const { container, prompt, calls } = mountPrompt(dom);
        prompt.apply(promptState({ canContinue: false, lockRemaining: 0.7, lockTotal: 0.75 }));

        const menu = actionButton(container, 'menu');
        assert.equal(menu.disabled, false, 'the way back to the menu is never locked');
        menu.click();
        assert.equal(calls.menu, 1);
        assert.match(textOf(menu), /Men/, 'the menu button is labelled');
    });
});

test('the key hints name any key and escape', () => {
    withDom((dom) => {
        const { container, prompt } = mountPrompt(dom);
        prompt.apply(promptState());

        const continueHint = hint(container, 'continue');
        assert.match(textOf(continueHint), /Beliebige Taste/);
        assert.match(textOf(continueHint), /Weiter/);
        assert.equal(findAll(continueHint, (node) => node.tagName === 'kbd').length, 1);

        const menuHint = hint(container, 'menu');
        assert.match(textOf(menuHint), /Esc/);
        assert.match(textOf(menuHint), /Men/);
    });
});

// ---------------------------------------------------------------------------
// Network client and arcade
// ---------------------------------------------------------------------------

test('a network client gets no continue at all, only the wait notice and the menu', () => {
    withDom((dom) => {
        const { container, prompt, calls } = mountPrompt(dom);
        prompt.apply(promptState({ canContinue: false, waitingForHost: true, lockRemaining: 0 }));

        assert.equal(isHidden(actionButton(container, 'continue')), true, 'a replica cannot start a round');
        assert.equal(isHidden(hint(container, 'continue')), true);
        const wait = hint(container, 'host');
        assert.equal(isHidden(wait), false);
        assert.equal(wait.textContent, 'Warte auf den Gastgeber');

        const menu = actionButton(container, 'menu');
        assert.equal(isHidden(menu), false, 'the menu stays reachable on a client');
        menu.click();
        assert.equal(calls.menu, 1);
    });
});

test('the arcade intermission hides the whole prompt', () => {
    withDom((dom) => {
        const { container, prompt } = mountPrompt(dom);
        prompt.apply(promptState());
        assert.equal(isHidden(container), false);

        prompt.apply(promptState({ visible: false }));
        assert.equal(isHidden(container), true, 'the advantage choice confirms with its own buttons');
    });
});

// ---------------------------------------------------------------------------
// Gamepad hint
// ---------------------------------------------------------------------------

test('the gamepad hint appears only with a pad and names the bound PAUSE button', () => {
    withDom((dom) => {
        const withoutPad = mountPrompt(dom, { getGamepads: () => [null, null, null, null] });
        withoutPad.prompt.apply(promptState());
        assert.equal(isHidden(hint(withoutPad.container, 'gamepad')), true, 'no pad, no controller hint');

        const withPad = mountPrompt(dom, { getGamepads: () => padList(true) });
        withPad.prompt.apply(promptState());
        const padHint = hint(withPad.container, 'gamepad');
        assert.equal(isHidden(padHint), false);
        assert.match(padHint.textContent, /Pause-Knopf/);
        assert.match(padHint.textContent, /Men. \/ Start/, 'button 9 is the default PAUSE binding');

        // A rebinding moves the reservation along: button 8 is "Ansicht / Back".
        const rebound = mountPrompt(dom, {
            getGamepads: () => padList(true),
            getControls: () => ({ GAMEPAD_1: { PAUSE: 8, BOOST: 9 } }),
        });
        rebound.prompt.apply(promptState());
        assert.match(hint(rebound.container, 'gamepad').textContent, /Ansicht \/ Back/);
    });
});

test('resolveGamepadPauseHintText reads the slot of the pad that is actually connected', () => {
    assert.equal(resolveGamepadPauseHintText([null, null, null, null], null), '');
    assert.match(resolveGamepadPauseHintText(padList(false, true), null), /Pause-Knopf/);
    assert.match(
        resolveGamepadPauseHintText(padList(false, true), { GAMEPAD_2: { PAUSE: 8, BOOST: 9 } }),
        /Ansicht \/ Back/
    );
});

// ---------------------------------------------------------------------------
// Write budget
// ---------------------------------------------------------------------------

test('unchanged values never touch the dom again while the bar keeps moving', () => {
    withDom((dom) => {
        const { container, prompt } = mountPrompt(dom, { getGamepads: () => padList(true) });
        prompt.apply(promptState({ canContinue: false, lockRemaining: 0.75, lockTotal: 0.75 }));

        const settled = dom.writes.count;
        prompt.apply(promptState({ canContinue: false, lockRemaining: 0.75, lockTotal: 0.75 }));
        assert.equal(dom.writes.count, settled, 'the same board state writes nothing again');

        prompt.apply(promptState({ canContinue: false, lockRemaining: 0.3, lockTotal: 0.75 }));
        assert.equal(dom.writes.count, settled + 1, 'a moving lock only moves the bar');
        assert.equal(progressOf(container), '0.6');
    });
});

// ---------------------------------------------------------------------------
// Contract normalization
// ---------------------------------------------------------------------------

test('a missing or broken prompt state normalizes to an invisible prompt', () => {
    const empty = normalizeContinuePromptState(null);
    assert.deepEqual(empty, {
        visible: false,
        canContinue: false,
        lockRemaining: 0,
        lockTotal: 0,
        phase: '',
        waitingForHost: false,
    });
    assert.deepEqual(normalizeContinuePromptState({ visible: true, phase: 'nonsense' }), empty);
    assert.deepEqual(normalizeContinuePromptState({ canContinue: true, phase: 'round_end' }), empty);
});

test('the lock values are clamped and a running lock forbids continue', () => {
    const running = normalizeContinuePromptState({
        visible: true, canContinue: true, phase: 'match_end',
        lockRemaining: 9, lockTotal: 1.5,
    });
    assert.equal(running.lockRemaining, 1.5, 'the bar never overruns its own length');
    assert.equal(running.canContinue, false, 'a running lock always beats the flag');

    const broken = normalizeContinuePromptState({
        visible: true, canContinue: true, phase: 'round_end',
        lockRemaining: 'nope', lockTotal: -3, waitingForHost: 'yes',
    });
    assert.equal(broken.lockTotal, 0);
    assert.equal(broken.lockRemaining, 0);
    assert.equal(broken.waitingForHost, false, 'only a real true means waiting');
    assert.equal(broken.canContinue, true);
    assert.equal(resolveContinuePromptProgress(broken), 1, 'without a lock the bar is full');

    const host = normalizeContinuePromptState({
        visible: true, canContinue: true, phase: 'round_end', waitingForHost: true,
    });
    assert.equal(host.canContinue, false, 'a replica never continues');
    assert.equal(resolveContinuePromptProgress({ lockRemaining: 0.375, lockTotal: 0.75 }), 0.5);
});

// ---------------------------------------------------------------------------
// The buttons must not double as "any key"
// ---------------------------------------------------------------------------

test('the continue button is the continue intent, the menu button never is', () => {
    withDom((dom) => {
        const { container, prompt } = mountPrompt(dom);
        prompt.apply(promptState());

        // Continue has no action of its own. A click or a key on it counts as "continue" and takes
        // the round state tick like any key, so the lock, the arcade sector advance and the replica
        // veto apply to the mouse as well.
        const continueButton = actionButton(container, 'continue');
        assert.equal(isInteractiveContinueTarget(continueButton), false);
        assert.equal(
            isContinueMouseEvent({ button: 0, targetIsInteractive: isInteractiveContinueTarget(continueButton) }),
            true
        );

        const menuButton = actionButton(container, 'menu');
        assert.equal(isInteractiveContinueTarget(menuButton), true, 'menu owns its own press');
        assert.equal(
            isContinueMouseEvent({ button: 0, targetIsInteractive: isInteractiveContinueTarget(menuButton) }),
            false,
            'a click on menu must not also skip the board'
        );

        // A click next to the buttons still counts, so the board stays dismissable by mouse.
        assert.equal(
            isContinueMouseEvent({ button: 0, targetIsInteractive: isInteractiveContinueTarget(container) }),
            true
        );
    });
});
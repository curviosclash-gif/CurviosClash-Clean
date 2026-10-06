// The Arcade score box grows with the sector modifier, waves and banners, while the player bars
// below it sat at a fixed 104px. The desktop playtest of 06.10.2026 found the grown box over
// LEBEN, BOOST and ZEITLUPE. The box now reports its real lower edge, and the bars follow it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ArcadeScoreHUD } from '../src/ui/arcade/ArcadeScoreHUD.js';

function createStubElement() {
    const properties = new Map();
    return {
        className: '',
        textContent: '',
        dataset: {},
        children: [],
        rectBottom: 0,
        style: {
            setProperty: (name, value) => properties.set(name, value),
            removeProperty: (name) => properties.delete(name),
        },
        properties,
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; },
        getBoundingClientRect() { return { bottom: this.rectBottom }; },
    };
}

function withDom(run) {
    const previousDocument = globalThis.document;
    const previousObserver = globalThis.ResizeObserver;
    const observers = [];
    globalThis.document = { createElement: () => createStubElement() };
    globalThis.ResizeObserver = class {
        constructor(callback) { this.callback = callback; this.targets = []; this.connected = true; observers.push(this); }
        observe(target) { this.targets.push(target); }
        disconnect() { this.connected = false; }
    };
    try {
        run(observers);
    } finally {
        globalThis.document = previousDocument;
        globalThis.ResizeObserver = previousObserver;
    }
}

test('Der Punktekasten meldet seine Unterkante, sobald er seine Groesse aendert', () => {
    withDom((observers) => {
        const parent = createStubElement();
        const hud = new ArcadeScoreHUD(parent);
        const observer = observers.find((entry) => entry.targets.includes(hud._container));
        assert.ok(observer, 'the score box is observed for size changes');

        hud._container.rectBottom = 171.4;
        observer.callback([]);
        assert.equal(parent.properties.get('--arcade-score-hud-bottom'), '172px');

        hud.dispose();
        assert.equal(observer.connected, false);
        assert.equal(parent.properties.has('--arcade-score-hud-bottom'), false);
    });
});

test('Die Arcade-Balken stehen unter der gemeldeten Unterkante statt auf festen 104px', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const tops = [...css.matchAll(/#hud\[data-hud-mode="arcade"\] #p1-hud \.player-hud-summary \{([^}]*)\}/g)]
        .map((match) => match[1].match(/(?:^|;|\s)top:\s*([^;]+);/)?.[1])
        .filter(Boolean);
    assert.ok(tops.length > 0, 'an arcade summary rule sets top');
    assert.match(tops.at(-1), /var\(--arcade-score-hud-bottom/, 'the rule that wins the cascade follows the box');
});

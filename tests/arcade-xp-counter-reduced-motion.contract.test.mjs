// The XP counter on the Arcade result panel counts up with requestAnimationFrame. The CSS rule for
// prefers-reduced-motion cannot stop a JS animation, so with that system wish the panel shows the
// final XP at once. The camera option cameraPerspective.reduceMotion (on by default) only calms
// the camera and must not take the count-up away from every player.
import assert from 'node:assert/strict';
import test from 'node:test';

const { MatchFlowArcadeOverlayController } = await import('../src/ui/MatchFlowArcadeOverlayController.js');

function element(tagName = 'div') {
    const classes = new Set();
    return {
        tagName, id: '', textContent: '', className: '', attributes: {}, children: [], style: {},
        classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n), toggle() {} },
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren() { this.children.length = 0; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        addEventListener() {},
        focus() {},
        querySelector(selector) {
            const stack = [...this.children];
            while (stack.length) {
                const node = stack.shift();
                if (node.id === selector.slice(1)) return node;
                stack.push(...(node.children || []));
            }
            return null;
        },
    };
}

function renderXp({ reduceMotion, systemReduced = false }) {
    const saved = {
        document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame,
        cancelAnimationFrame: globalThis.cancelAnimationFrame, matchMedia: globalThis.matchMedia,
    };
    let frames = 0;
    globalThis.document = { createElement: (tag) => element(tag) };
    globalThis.requestAnimationFrame = () => { frames += 1; return frames; };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.matchMedia = (query) => ({ matches: systemReduced && query.includes('reduce') });
    try {
        const controller = new MatchFlowArcadeOverlayController({
            runtime: { ui: { messageOverlay: element() }, runtimeConfig: { cameraPerspective: { reduceMotion } } },
            runtimePort: {},
        });
        controller._renderArcadePostRunPanel({ postRunSummary: { score: 10, xpEarned: 1420, xpAnimation: { durationMs: 900 } } });
        return { text: controller._arcadeOverlayPanel.querySelector('#arcade-overlay-xp-counter').textContent, frames };
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
}

test('prefers-reduced-motion shows the final XP at once', () => {
    for (const reduceMotion of [true, false]) {
        const { text, frames } = renderXp({ reduceMotion, systemReduced: true });
        assert.equal(text, '1.420 XP');
        assert.equal(frames, 0, 'no animation frame is requested');
    }
});

test('the camera option alone keeps the count-up, on or off', () => {
    for (const reduceMotion of [true, false, undefined]) {
        const { text, frames } = renderXp({ reduceMotion });
        assert.equal(text, '0 XP', `reduceMotion=${reduceMotion}`);
        assert.equal(frames, 1);
    }
});

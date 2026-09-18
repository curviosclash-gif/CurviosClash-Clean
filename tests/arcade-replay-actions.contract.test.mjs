// R1/B6 (playtest 17.09.2026), decision 18.09.2026: "Replay exportieren" on the result panel started
// a ghost playback hidden under the panel and never exported anything. It becomes two buttons:
// "Replay ansehen" plays it visibly (the panel fades out for the playback) and "Exportieren" copies
// the replay JSON.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createArcadeReplayActions } from '../src/ui/arcade/ArcadeReplayActions.js';

function stubElement(tagName = 'div') {
    const classes = new Set();
    const listeners = {};
    return {
        tagName, id: '', textContent: '', disabled: false, children: [],
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); return node; },
        addEventListener(type, fn) { listeners[type] = fn; },
        click() { return listeners.click?.(); },
        classList: {
            add: (name) => classes.add(name), remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
    };
}

function setup({ playbackCode = 'replay_playback_started' } = {}) {
    const doc = { createElement: (tag) => stubElement(tag) };
    const overlay = stubElement();
    const toasts = [];
    const timers = [];
    const copied = [];
    const calls = [];
    const actions = createArcadeReplayActions({
        doc,
        payloadAvailable: true,
        overlay,
        requestPlayback: () => { calls.push('playback'); return { code: playbackCode, playback: { displayDuration: 8 } }; },
        requestExport: () => { calls.push('export'); return { ok: true, code: 'replay_export_ready', replayJson: '{"matchId":"m1"}' }; },
        copyText: (text) => { copied.push(text); return Promise.resolve(true); },
        showToast: (message, tone) => toasts.push({ message, tone }),
        setTimer: (fn, ms) => timers.push({ fn, ms }),
    });
    return { actions, overlay, toasts, timers, copied, calls };
}

test('the result panel offers watching and exporting as two buttons', () => {
    const { actions } = setup();
    const labels = actions.buttons.map((button) => button.textContent);
    assert.deepEqual(labels, ['Replay ansehen', 'Exportieren']);
});

test('watching fades the panel out for the playback and brings it back', () => {
    const { actions, overlay, timers, calls } = setup();
    actions.buttons[0].click();
    assert.deepEqual(calls, ['playback']);
    assert.equal(overlay.classList.contains('arcade-replay-viewing'), true);
    assert.equal(timers[0].ms, 8000);
    timers[0].fn();
    assert.equal(overlay.classList.contains('arcade-replay-viewing'), false);
});

test('exporting copies the replay instead of starting a playback', async () => {
    const { actions, copied, toasts, calls, overlay } = setup();
    await actions.buttons[1].click();
    assert.deepEqual(calls, ['export']);
    assert.deepEqual(copied, ['{"matchId":"m1"}']);
    assert.equal(overlay.classList.contains('arcade-replay-viewing'), false);
    assert.match(toasts.at(-1).message, /Zwischenablage/);
});

test('a playback that cannot start keeps the panel and says so', () => {
    const { actions, overlay, toasts } = setup({ playbackCode: 'replay_unavailable' });
    actions.buttons[0].click();
    assert.equal(overlay.classList.contains('arcade-replay-viewing'), false);
    assert.equal(toasts.length, 1);
});

test('the viewing class makes the result overlay transparent and click-through', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const rule = /#message-overlay\.arcade-replay-viewing\s*\{([^}]*)\}/.exec(css)?.[1] || '';
    assert.match(rule, /opacity:\s*0/);
    assert.match(rule, /pointer-events:\s*none/);
});
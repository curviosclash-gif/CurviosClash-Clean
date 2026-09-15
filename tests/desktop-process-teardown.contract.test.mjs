import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
    DEFAULT_TEARDOWN_DEADLINE_MS,
    RENDER_TAG,
    closeElectronAppWithDeadline,
    isProcessRunning,
    resolveShowWindow,
    waitForProcessExit,
} from './desktop-process-teardown.mjs';

const STUBBORN_CHILD_SOURCE = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";

function spawnStubbornChild() {
    return spawn(process.execPath, ['-e', STUBBORN_CHILD_SOURCE], {
        stdio: 'ignore',
        windowsHide: true,
    });
}

test('the teardown deadline stays short enough to beat the Playwright test timeout', () => {
    assert.equal(DEFAULT_TEARDOWN_DEADLINE_MS, 20000);
    assert.ok(DEFAULT_TEARDOWN_DEADLINE_MS < 240000);
});

test('resolveShowWindow reacts to the env switch and to the render tag', () => {
    assert.equal(RENDER_TAG, '@render');
    assert.equal(resolveShowWindow({}, ['tests/core.spec.js', 'T1: menu opens']), false);
    assert.equal(resolveShowWindow({ PW_SHOW_WINDOW: '1' }, ['T1: menu opens']), true);
    assert.equal(resolveShowWindow({ PW_SHOW_WINDOW: '0' }, ['T1: menu opens']), false);
    assert.equal(resolveShowWindow({ CURVIOS_ELECTRON_SHOW_WINDOW: '1' }, []), true);
    assert.equal(
        resolveShowWindow({}, ['tests/atmospheric-fog.desktop.spec.js', 'fog meets the sky @render']),
        true
    );
    assert.equal(resolveShowWindow({}, 'suite @render'), true);
});

test('a clean close reports no forced kill', async () => {
    const child = spawnStubbornChild();
    try {
        const app = {
            close: async () => {
                child.kill('SIGKILL');
                await waitForProcessExit(child, 2000);
            },
        };
        const result = await closeElectronAppWithDeadline({
            app,
            childProcess: child,
            deadlineMs: 1500,
        });

        assert.equal(result.forcedKill, false);
        assert.equal(result.closeError, null);
        assert.ok(result.afterMs < 1500, `afterMs=${result.afterMs}`);
    } finally {
        child.kill('SIGKILL');
    }
});

test('a hanging close is cut off and the Electron process is killed', async () => {
    const child = spawnStubbornChild();
    await new Promise((resolve) => child.once('spawn', resolve));
    try {
        const app = {
            close: () => new Promise(() => {
                // Never settles: this is exactly the teardown hang the deadline exists for.
                if (process.platform !== 'win32') child.kill('SIGTERM');
            }),
        };
        const result = await closeElectronAppWithDeadline({
            app,
            childProcess: child,
            deadlineMs: 1000,
            exitGraceMs: 4000,
        });

        assert.equal(result.forcedKill, true);
        assert.equal(result.killed, true);
        assert.equal(result.exited, true);
        assert.ok(result.afterMs >= 1000, `afterMs=${result.afterMs}`);
        assert.equal(isProcessRunning(child), false);
        assert.throws(() => process.kill(child.pid, 0), /ESRCH/);
    } finally {
        if (isProcessRunning(child)) child.kill('SIGKILL');
    }
});

test('a close failure is reported instead of thrown', async () => {
    const result = await closeElectronAppWithDeadline({
        app: { close: async () => { throw new Error('close_boom'); } },
        childProcess: null,
        deadlineMs: 1000,
    });

    assert.equal(result.forcedKill, false);
    assert.equal(result.closeError, 'close_boom');
});

test('the desktop harness uses the deadline teardown and the render tag', () => {
    const source = readFileSync(new URL('./helpers.desktop.js', import.meta.url), 'utf8');
    assert.ok(source.includes('closeElectronAppWithDeadline'), 'helpers.desktop.js must close with a deadline');
    assert.ok(source.includes('resolveShowWindow'), 'helpers.desktop.js must resolve the window visibility');
    assert.ok(!/await app\?\.close\(\)/.test(source), 'helpers.desktop.js must not close without a deadline');
    assert.ok(source.includes('teardown'), 'the teardown outcome must reach the diagnostics json');
});

test('render proof specs carry the render tag in their titles', () => {
    const taggedSpecs = [
        'atmospheric-fog.desktop.spec.js',
        'fog-edge-proof.desktop.spec.js',
        'global-fog-pickup.desktop.spec.js',
        'sky-dome-gradient.desktop.spec.js',
        'falkenwacht-grain-proof.desktop.spec.js',
        'notre-dame-atmosphere.desktop.spec.js',
        'notre-dame-wall-approach.desktop.spec.js',
        'magma-maze-pickups.desktop.spec.js',
        'weapon-fan-pickups.desktop.spec.js',
    ];

    for (const specName of taggedSpecs) {
        const source = readFileSync(new URL(`./${specName}`, import.meta.url), 'utf8');
        assert.ok(
            source.includes(RENDER_TAG),
            `${specName} waits for rendered frames and must carry ${RENDER_TAG} in its titles`
        );
    }
});

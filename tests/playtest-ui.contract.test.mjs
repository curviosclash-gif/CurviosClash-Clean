import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { leaveMatchFromPauseMenu } from '../scripts/playtest/playtest-ui.mjs';

const PLAYTEST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'playtest');

test('leaving through the pause menu arms the confirm button before the second click', async () => {
    const calls = [];
    const page = {
        locator: (selector) => ({
            click: async () => calls.push(`click ${selector}`),
            waitFor: async ({ state }) => calls.push(`wait ${state} ${selector}`),
        }),
    };
    await leaveMatchFromPauseMenu(page);
    assert.deepEqual(calls, [
        'click #btn-pause-menu',
        'wait attached #btn-pause-menu[data-confirm-armed="true"]',
        'click #btn-pause-menu',
    ]);
});

test('playtest scripts leave a match only through the two-step pause helper', () => {
    const offenders = fs.readdirSync(PLAYTEST_DIR)
        .filter((name) => name.endsWith('.mjs') && name !== 'playtest-ui.mjs')
        .filter((name) => fs.readFileSync(path.join(PLAYTEST_DIR, name), 'utf8').includes("'#btn-pause-menu'"));
    assert.deepEqual(offenders, []);
});

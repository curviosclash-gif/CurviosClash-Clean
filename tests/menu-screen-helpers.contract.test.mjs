import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MENU_SCREEN_PANEL_IDS, menuScreenSelector } from './support/menu-screens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(ROOT, 'tests');

// Ratchet: direct references to menu panel ids in tests may only go down. New and rebuilt tests ask
// for a screen by name (openMenuScreen, menuScreenSelector), so the menu rebuild only edits the map.
const MAX_RAW_PANEL_ID_REFERENCES = 333;
const RAW_PANEL_ID = /submenu-(?:game|custom|level4|multiplayer|expert|debug|settings|controls|profiles|portals|developer)\b/g;
const EXEMPT_FILES = new Set(['helpers.js', 'menu-screens.js', 'menu-screen-helpers.contract.test.mjs']);

function collectTestFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name !== 'node_modules') collectTestFiles(full, out);
        } else if (/\.(?:m?js)$/.test(name) && !EXEMPT_FILES.has(name)) {
            out.push(full);
        }
    }
    return out;
}

test('every named menu screen points at a panel that exists in the game page', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const [screen, panelId] of Object.entries(MENU_SCREEN_PANEL_IDS)) {
        assert.match(html, new RegExp(`id="${panelId}"`), `${screen} -> #${panelId} is missing in index.html`);
    }
    assert.equal(menuScreenSelector('freeplay'), '#submenu-game:not(.hidden)');
    assert.equal(menuScreenSelector('freeplay', { visible: false }), '#submenu-game');
    assert.throws(() => menuScreenSelector('nope'), /Unbekannter Menübildschirm/);
});

test('direct menu panel id references in tests only go down', () => {
    const counts = [];
    let total = 0;
    for (const file of collectTestFiles(TESTS_DIR)) {
        const count = readFileSync(file, 'utf8').match(RAW_PANEL_ID)?.length || 0;
        if (count > 0) counts.push([path.relative(ROOT, file).replace(/\\/g, '/'), count]);
        total += count;
    }
    assert.ok(total <= MAX_RAW_PANEL_ID_REFERENCES,
        `${total} direct menu panel id references (allowed ${MAX_RAW_PANEL_ID_REFERENCES}); `
        + 'use openMenuScreen/menuScreenSelector from tests/helpers.js. Largest: '
        + counts.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([file, count]) => `${file} ${count}`).join(', '));
    if (total < MAX_RAW_PANEL_ID_REFERENCES) {
        console.log(`[menu-screen-ratchet] ${total} < ${MAX_RAW_PANEL_ID_REFERENCES}: lower MAX_RAW_PANEL_ID_REFERENCES`);
    }
});

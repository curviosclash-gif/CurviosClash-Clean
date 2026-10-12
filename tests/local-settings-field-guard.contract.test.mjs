import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');

// Optional blocks the normalizer only keeps when they are present.
const OPTIONAL_SAMPLE = Object.freeze({
    fightHangar: {},
    classicTutorial: {},
    playerColorP1: '#123456',
});

// A name directly followed by "$" is the start of a template expression, not a field.
const FIELD_ACCESS = /\blocalSettings\??\.([A-Za-z_]\w*)(?![\w$])/g;

function collectSourceFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) collectSourceFiles(full, out);
        else if (full.endsWith('.js')) out.push(full);
    }
    return out;
}

function collectFieldAccesses() {
    const fields = new Map();
    for (const file of collectSourceFiles(SRC_DIR)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(FIELD_ACCESS)) {
            if (!fields.has(match[1])) fields.set(match[1], new Set());
            fields.get(match[1]).add(path.relative(ROOT, file).replace(/\\/g, '/'));
        }
    }
    return fields;
}

test('every localSettings field the code reads or writes survives the save normalizer', () => {
    const settings = { localSettings: { ...OPTIONAL_SAMPLE } };
    ensureMenuContractState(settings);
    const kept = new Set(Object.keys(settings.localSettings));

    const dropped = [...collectFieldAccesses()]
        .filter(([field]) => !kept.has(field))
        .map(([field, files]) => `${field} <- ${[...files].sort().join(', ')}`);

    assert.deepEqual(dropped, [],
        'normalizeLocalSettingsState (src/ui/menu/MenuStateContracts.js) rebuilds localSettings from a fixed list; '
        + 'a field that is not on it is lost on the next save. Add the field there or read it from where it really lives.');
});

test('the guard reports a field the normalizer would drop', () => {
    const settings = { localSettings: { unlistedProbeField: 1 } };
    ensureMenuContractState(settings);
    assert.equal(Object.hasOwn(settings.localSettings, 'unlistedProbeField'), false,
        'the guard relies on the normalizer dropping unknown fields');
    assert.equal('settings.localSettings.developer${x}'.match(FIELD_ACCESS), null,
        'template expressions are not counted as fields');
});

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
    freePlayVariant: 'flags',
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

// Expressions that evaluate to the localSettings object itself: anything named localSettings (as
// FIELD_ACCESS reads it), or ensureLocalSettings(...).
const ENSURE_LOCAL_SETTINGS = String.raw`[\w$.?]*\bensureLocalSettings(?:\?\.)?\([^()]*\)`;
const LOCAL_SETTINGS_SOURCE = String.raw`(?:[\w$.?]*\blocalSettings|${ENSURE_LOCAL_SETTINGS})`;
// An alias needs a property path ending in .localSettings: some callers name a variable
// localSettings while it holds the whole settings object, and its aliases are not localSettings.
const ALIAS_SOURCE = String.raw`(?:[\w$.?]*\.localSettings|${ENSURE_LOCAL_SETTINGS})`;
// The source must end the initializer (";", "||", "??", newline), so calls taking it as an argument are skipped.
const INITIALIZER_END = String.raw`\s*(?:;|\|\||\?\?|\r?\n)`;
const ALIAS_DECLARATION = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${ALIAS_SOURCE}${INITIALIZER_END}`, 'g');
const escapeRegExp = (value) => value.replace(/[$]/g, '\\$');

function collectFieldsFromText(text) {
    const fields = new Set([...text.matchAll(FIELD_ACCESS)].map((match) => match[1]));
    const aliases = [...text.matchAll(ALIAS_DECLARATION)].map((match) => match[1]);
    const sources = [LOCAL_SETTINGS_SOURCE, ...aliases.map((alias) => String.raw`(?<![\w$.])${escapeRegExp(alias)}`)];
    for (const source of sources) {
        const isAlias = source !== LOCAL_SETTINGS_SOURCE;
        if (isAlias) {
            for (const match of text.matchAll(new RegExp(String.raw`${source}\??\.([A-Za-z_]\w*)(?![\w$])`, 'g'))) {
                fields.add(match[1]);
            }
        }
        for (const match of text.matchAll(new RegExp(String.raw`${source}(?:\?\.)?\[\s*['"]([^'"]+)['"]\s*\]`, 'g'))) {
            fields.add(match[1]);
        }
        const destructuring = new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*${source}${INITIALIZER_END}`, 'g');
        for (const match of text.matchAll(destructuring)) {
            for (const part of match[1].split(',')) {
                const key = part.trim().match(/^([A-Za-z_$][\w$]*)/);
                if (key && !part.trim().startsWith('...')) fields.add(key[1]);
            }
        }
    }
    return fields;
}

function collectFieldAccesses() {
    const fields = new Map();
    for (const file of collectSourceFiles(SRC_DIR)) {
        const text = readFileSync(file, 'utf8');
        for (const field of collectFieldsFromText(text)) {
            if (!fields.has(field)) fields.set(field, new Set());
            fields.get(field).add(path.relative(ROOT, file).replace(/\\/g, '/'));
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
    assert.deepEqual([...collectFieldsFromText('settings.localSettings.developer${x}')], [],
        'template expressions are not counted as fields');
});

test('the guard sees fields reached through an alias, destructuring or a string key', () => {
    for (const [source, expected] of [
        ['const local = settings.localSettings;\nlocal.probeAlias = 1;', ['probeAlias']],
        ['const local = settings?.localSettings || {};\nreturn local?.probeFallback;', ['probeFallback']],
        ['const local = ensureLocalSettings(settings);\nlocal.probeEnsure = true;', ['probeEnsure']],
        ['const local = this.runtime?.ensureLocalSettings?.();\nlocal.probeRuntime = 2;', ['probeRuntime']],
        ['const { probeA, probeB: renamed = 1, ...rest } = settings.localSettings;', ['probeA', 'probeB']],
        ["settings.localSettings['probeBracket'] = 1;\nsettings.localSettings?.[\"probeOptional\"];", ['probeBracket', 'probeOptional']],
        ["const local = settings.localSettings;\nlocal['probeAliasBracket'] = 1;", ['probeAliasBracket']],
        ['const local = settings.localSettings;\nthis.local.notLocalSettings = 1;\nconst x = local.length;', ['length']],
    ]) {
        assert.deepEqual([...collectFieldsFromText(source)].sort(), expected, source);
    }
});

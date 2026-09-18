import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Player-facing German texts use real umlauts. Comments and identifiers are out of scope:
// only string literals are checked, and only for fragments that never occur in English or in ids.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = ['src', 'editor/js', 'electron', 'prototypes/vehicle-lab'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'vendor']);
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

const TRANSLITERATED = new RegExp([
    '\\b[Ff]uer\\b', '\\b[Uu]eber', 'verfueg', 'ungueltig', 'gueltig', '[Zz]urueck', '[Mm]enue\\b',
    'waehl', 'oeffn', '[Nn]aechst', 'Anfuehrer', 'Jaeger\\b', 'bestaetig', 'zusaetzlich', 'Groesse',
    'groesser', 'loesch', 'benoetig', 'muessen', 'moeglich', 'pruef', '[Aa]ender', 'laeuft', 'enthaelt',
    'koennen', 'unterstuetz', 'ausfuehr', 'gefuehr', 'vollstaendig', 'waehrend', 'schliessen', 'ausserhalb',
].join('|'));

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g;
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (EXTENSIONS.has(extname(name))) yield full;
    }
}

test('display texts spell german words with real umlauts', () => {
    const offenders = [];
    for (const scanRoot of SCAN_ROOTS) {
        for (const file of walk(join(ROOT, scanRoot))) {
            const source = readFileSync(file, 'utf8').replace(COMMENTS, '$1');
            for (const literal of source.match(STRING_LITERAL) || []) {
                if (!/\s/.test(literal)) continue; // single tokens are keys and ids, not sentences
                if (TRANSLITERATED.test(literal)) {
                    offenders.push(`${relative(ROOT, file).replace(/\\/g, '/')}: ${literal.slice(0, 100)}`);
                }
            }
        }
    }
    assert.deepEqual(offenders, [], `transliterated umlauts left in display texts:\n${offenders.join('\n')}`);
});

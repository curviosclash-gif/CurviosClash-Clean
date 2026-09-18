import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Player-facing text lives in these trees; developer logs and errors are exempt.
const SCANNED_ROOTS = ['src/ui', 'src/core/runtime', 'src/shared', 'src/core/settings', 'src/core/recording'];

const TRANSLITERATION = /\b\w*(druecken|Untermenue|UEBERSICHT|gewaehl|Geraet|Zurueck|zurueck|verfuegbar|benoetig|muess|ungueltig|moeglich|geaender|ausgewaehl|unterstuetz|waehl|loesch|oeffn|pruef|Groesse|groess|schliess|Schliess|fuehr|Fuehr|hoeh|laeuft|aender|Aender|koenn|Koenn|uebernomm|Uebersicht|gueltig|naechst|Naechst|spaet|waer|oeffentlich|zaehl|Zaehl|laeng|Laeng)\w*\b|\b(fuer|ueber|Ueber|Fuer)\b/u;
const DEVELOPER_TEXT = /console\.|logger\.|warn\(|Error\(/u;

function collectJsFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) collectJsFiles(full, out);
        else if (full.endsWith('.js')) out.push(full);
    }
    return out;
}

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

test('display strings use real umlauts instead of ae/oe/ue transliterations', () => {
    const hits = [];
    for (const root of SCANNED_ROOTS) {
        for (const file of collectJsFiles(path.join(repoRoot, root))) {
            const source = stripComments(readFileSync(file, 'utf8'));
            for (const match of source.matchAll(/'([^'\n]{3,})'|`([^`\n]{3,})`/gu)) {
                const text = match[1] ?? match[2];
                if (TRANSLITERATION.test(text) && !DEVELOPER_TEXT.test(text)) {
                    hits.push(`${path.relative(repoRoot, file)}: ${text.slice(0, 100)}`);
                }
            }
        }
    }
    assert.deepEqual(hits, []);
});

test('index.html labels use real umlauts', () => {
    const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/gu, '');
    const hits = [];
    for (const match of html.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"|>([^<>]+)</gu)) {
        const text = match[1] ?? match[2];
        if (TRANSLITERATION.test(text)) hits.push(text.trim().slice(0, 100));
    }
    assert.deepEqual(hits, []);
});

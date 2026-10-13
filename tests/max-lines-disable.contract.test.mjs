// ============================================
// max-lines-disable.contract.test.mjs - src/ must not opt out of the max-lines cap
// ============================================
//
// The rule `max-lines` (500 counted lines, see eslint.config.js) is the only thing that stops a
// file from growing into a closure of 900 lines. Existing debt is listed in
// scripts/architecture/LegacyMaxLinesConfig.mjs and may only shrink. A comment such as
// `/* eslint-disable max-lines -- ... */` is a second, silent exemption list: it bypasses that
// config and the ratchet, and ArcadeHangarWorkshop.js carried one for months. This guard closes
// the hole: no file under src/ may switch the rule off or raise its limit from inside a comment.
//
// What counts as an opt-out (every spelling that turns the rule off for a file or a line):
//   - block and line directives: `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line`
//   - the rule named inside a comma list: `eslint-disable no-console, max-lines`
//   - a blanket `eslint-disable` without a rule list, because it silences max-lines as well
//   - a config comment that sets the rule: `/* eslint max-lines: ["error", 2000] */`
//
// What does not count: `max-lines-per-function` (a different rule; the repository does not enable
// it, and naming it here would not lift the file cap), and the words in ordinary prose.
//
// Anything that needs more room is split into modules or added to LegacyMaxLinesConfig.mjs
// (which is a visible, reviewed debt list), never hidden in a comment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

const DISABLE_BLOCK = /\/\*\s*eslint-disable(?:-next-line|-line)?(?![\w-])([\s\S]*?)\*\//g;
const DISABLE_LINE = /\/\/\s*eslint-disable(?:-next-line|-line)?(?![\w-])([^\n]*)/g;
const CONFIG_COMMENT = /\/\*\s*eslint\s+([\s\S]*?)\*\//g;
const MAX_LINES_NAME = /(?<![\w/-])max-lines(?![\w-])/;

/** The rule ids of a directive; the free text after ` -- ` is a description, not a rule. */
function listDirectiveRules(directiveBody) {
    return directiveBody
        .split(/\s--\s/)[0]
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function lineOf(source, index) {
    return source.slice(0, index).split('\n').length;
}

/**
 * Finds every max-lines opt-out in a source text.
 * @param {string} source
 * @returns {{ line: number, text: string }[]} sorted by line
 */
export function findMaxLinesOptOuts(source) {
    const found = [];
    for (const pattern of [DISABLE_BLOCK, DISABLE_LINE]) {
        for (const match of source.matchAll(pattern)) {
            const rules = listDirectiveRules(match[1]);
            const blanket = rules.length === 0;
            if (blanket || rules.some((rule) => rule === 'max-lines')) {
                found.push({ line: lineOf(source, match.index), text: match[0].split('\n')[0].trim() });
            }
        }
    }
    for (const match of source.matchAll(CONFIG_COMMENT)) {
        if (MAX_LINES_NAME.test(match[1])) {
            found.push({ line: lineOf(source, match.index), text: match[0].split('\n')[0].trim() });
        }
    }
    return found.sort((a, b) => a.line - b.line);
}

function listSourceFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...listSourceFiles(fullPath));
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }
    return files.sort();
}

test('the opt-out detector finds every spelling and ignores look-alikes', () => {
    // Counter-check first: a guard whose pattern never fires is green for the wrong reason.
    const hits = (text) => findMaxLinesOptOuts(text).length;
    assert.equal(hits('/* eslint-disable max-lines -- Hangar wiring stays in one controller. */'), 1);
    assert.equal(hits('/* eslint-disable max-lines */'), 1);
    assert.equal(hits('/* eslint-disable no-console, max-lines */'), 1);
    assert.equal(hits('/* eslint-disable max-lines, no-console -- reason */'), 1);
    assert.equal(hits('/*eslint-disable max-lines*/'), 1);
    assert.equal(hits('// eslint-disable max-lines'), 1);
    assert.equal(hits('// eslint-disable-next-line max-lines'), 1);
    assert.equal(hits('const x = 1; // eslint-disable-line no-undef, max-lines'), 1);
    assert.equal(hits('/* eslint-disable */'), 1, 'a blanket disable silences max-lines as well');
    assert.equal(hits('// eslint-disable-next-line'), 1);
    assert.equal(hits('/* eslint max-lines: ["error", 2000] */'), 1);
    assert.equal(hits('/* eslint max-lines: "off", no-console: "off" */'), 1);
    assert.equal(hits('/*\n * eslint-disable\n */'), 0, 'a directive must start the comment');
    assert.equal(hits('/* eslint-disable\n  no-console,\n  max-lines\n*/'), 1, 'a rule list may span lines');

    // Look-alikes that must stay quiet.
    assert.equal(hits('/* eslint-disable max-lines-per-function */'), 0, 'a different rule');
    assert.equal(hits('// eslint-disable-next-line no-console'), 0);
    assert.equal(hits('/* eslint-disable no-console -- the max-lines cap is respected */'), 0, 'prose after the dashes');
    assert.equal(hits('/* eslint-enable max-lines */'), 0, 'switching the rule back on is fine');
    assert.equal(hits('/* eslint max-lines-per-function: off */'), 0);
    assert.equal(hits('/* eslint-disable-foo max-lines */'), 0, 'not a directive');
    assert.equal(hits('// the max-lines rule counts code lines'), 0);
    assert.equal(hits('const rule = "max-lines";'), 0);
});

test('the opt-out detector reports the line of the directive', () => {
    const source = ['const a = 1;', '', '// eslint-disable-next-line max-lines', 'const b = 2;'].join('\n');
    assert.deepEqual(findMaxLinesOptOuts(source), [{ line: 3, text: '// eslint-disable-next-line max-lines' }]);
});

test('the guard scans the real product sources', () => {
    const files = listSourceFiles(SRC_DIR);
    assert.ok(files.length > 500, `expected the whole src/ tree, found ${files.length} files`);
    assert.ok(files.some((file) => file.endsWith(path.join('ui', 'hangar', 'ArcadeHangarWorkshop.js'))));
});

test('no file under src/ opts out of the max-lines cap with a comment', () => {
    const violations = [];
    for (const file of listSourceFiles(SRC_DIR)) {
        const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        for (const { line, text } of findMaxLinesOptOuts(readFileSync(file, 'utf8'))) {
            violations.push(`${relative}:${line}  ${text}`);
        }
    }
    assert.equal(
        violations.length,
        0,
        `max-lines opt-outs found (split the file into modules instead):\n${violations.join('\n')}`
    );
});

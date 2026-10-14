// ============================================
// class-member-packing.contract.test.mjs - one class member per line in src/
// ============================================
//
// max-lines (500, eslint.config.js) counts lines, not code. Packing several methods onto one
// line keeps a file "under 500" while it keeps growing: EntityManager.js and Arena.js each
// carried a line of ~2500 characters holding a dozen methods. This guard closes that gap, so a
// file that outgrows the limit has to be split instead of squeezed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');

// A class member starts at four spaces of indentation; a second member on the same line
// follows the closing brace of the first one: `    a() { ... } b(x) { ... }`.
const MEMBER_START = /^ {4}(?:static\s+|async\s+|get\s+|set\s+)*[#_$a-zA-Z][\w$]*\s*\(/;
const SECOND_MEMBER = /\}\s+(?:static\s+|async\s+|get\s+|set\s+)*([#_$a-zA-Z][\w$]*)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\{/g;
const STATEMENT_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else']);

function listSourceFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...listSourceFiles(fullPath));
        else if (entry.name.endsWith('.js')) files.push(fullPath);
    }
    return files;
}

export function findPackedClassMembers(source) {
    const hits = [];
    source.split('\n').forEach((line, index) => {
        if (!MEMBER_START.test(line)) return;
        for (const match of line.matchAll(SECOND_MEMBER)) {
            if (STATEMENT_KEYWORDS.has(match[1])) continue;
            hits.push({ line: index + 1, member: match[1] });
            break;
        }
    });
    return hits;
}

test('the detector flags a second member on a member line and ignores control flow', () => {
    const packed = '    a() { return 1; } b(x = {}) { return x; }\n';
    const control = '    a() { if (x) { y(); } else { z(); } try { w(); } catch (e) { v(); } }\n';
    assert.deepEqual(findPackedClassMembers(packed), [{ line: 1, member: 'b' }]);
    assert.deepEqual(findPackedClassMembers(control), []);
});

test('no file in src/ packs several class members onto one line', () => {
    const offenders = [];
    for (const file of listSourceFiles(SRC_DIR)) {
        for (const hit of findPackedClassMembers(readFileSync(file, 'utf8'))) {
            offenders.push(`${path.relative(ROOT, file).replaceAll('\\', '/')}:${hit.line} (${hit.member})`);
        }
    }
    assert.deepEqual(offenders, [], 'Split the file instead of packing members to stay under max-lines.');
});

#!/usr/bin/env node
// Extracts failing test names from a saved Playwright `list`-reporter log and, with two
// logs, splits them into "was already broken" and "I broke this".
//
// Why this exists: several clusters in this repo carry long-standing failures. Every task
// therefore has to answer the same question — is this red mine? Answering it by reading
// two walls of output invites the comfortable wrong answer. A set difference does not.
//
// Usage:
//   node compare-failures.mjs <log>                 # list the failures in one log
//   node compare-failures.mjs <baseline> <current>  # compare HEAD against your change
import { readFileSync } from 'node:fs';
import process from 'node:process';

// The list reporter numbers each failure and pads the title with box-drawing dashes:
//   1) tests/core.spec.js:24:5 › T1: boots the app ───────────────
const FAILURE_LINE = /^\s*\d+\)\s+(.+?)(?:\s*[─-]{3,}\s*)?$/;
const SUMMARY_LINE = /^\s*(\d+)\s+(failed|passed|skipped|flaky)\b/;

function readFailures(file) {
    let raw = '';
    try {
        raw = readFileSync(file, 'utf8');
    } catch (error) {
        console.error(`Log nicht lesbar: ${file} (${error.code || error.message})`);
        process.exit(2);
    }

    const failures = new Set();
    const summary = {};
    for (const line of raw.split(/\r?\n/)) {
        const stripped = line.replace(/\[[0-9;]*m/g, '');
        const failure = FAILURE_LINE.exec(stripped);
        if (failure) {
            const title = failure[1].trim();
            // The reporter repeats the numbered heading inside the error detail block;
            // a Set collapses those duplicates for us.
            if (title.includes('›')) failures.add(title);
            continue;
        }
        const counted = SUMMARY_LINE.exec(stripped);
        if (counted) summary[counted[2]] = Number(counted[1]);
    }
    return { failures, summary, empty: raw.trim().length === 0 };
}

function describe(label, { failures, summary, empty }) {
    if (empty) {
        console.log(`${label}: Log ist leer — der Lauf hat vermutlich gar nicht gestartet.`);
        return;
    }
    const counts = Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(', ');
    console.log(`${label}: ${failures.size} Fehlschlag/Fehlschläge${counts ? ` (${counts})` : ''}`);
    for (const name of failures) console.log(`  - ${name}`);
}

const [baselineFile, currentFile] = process.argv.slice(2);

if (!baselineFile) {
    console.error('Aufruf: node compare-failures.mjs <log> [<current-log>]');
    process.exit(2);
}

const baseline = readFailures(baselineFile);

if (!currentFile) {
    describe('Lauf', baseline);
    process.exit(0);
}

const current = readFailures(currentFile);

const known = [...current.failures].filter((name) => baseline.failures.has(name));
const introduced = [...current.failures].filter((name) => !baseline.failures.has(name));
const fixed = [...baseline.failures].filter((name) => !current.failures.has(name));

describe('Baseline (ohne meine Änderung)', baseline);
console.log('');
describe('Aktuell (mit meiner Änderung)', current);

console.log('\n--- Auswertung ---');

if (introduced.length === 0) {
    console.log('Neu kaputt: keine. Alle roten Tests waren vorher schon rot.');
} else {
    console.log(`Neu kaputt: ${introduced.length} — das ist deine Regression.`);
    for (const name of introduced) console.log(`  ! ${name}`);
}

console.log(`Bekannte Alt-Fehler, die rot bleiben: ${known.length}`);
for (const name of known) console.log(`  = ${name}`);

if (fixed.length > 0) {
    console.log(`Nebenbei grün geworden: ${fixed.length}`);
    for (const name of fixed) console.log(`  + ${name}`);
}

// Exit 1 signals a real regression so a caller can branch on it without parsing text.
process.exit(introduced.length > 0 ? 1 : 0);

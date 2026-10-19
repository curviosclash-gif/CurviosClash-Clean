import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Load weight guard: every GLB a catalog map references is measured on disk. One file may weigh at
// most MAX_FILE_MB, all distinct files of one map together at most MAX_MAP_MB. A map loads all of
// its models up front, so a heavy map costs every player a long load and a lot of GPU memory.
//
// tests/fixtures/map-glb-budget-known.json is a ratchet and the work list for the map packages: a
// file or map over budget that is not listed fails, a listed value that grew fails, and so does an
// entry that no longer applies or whose value can be lowered ("stale entry"), so the list only
// shrinks. MAP_GLB_BUDGET_IGNORE_KNOWN=1 lists every violation without the list (the red proof);
// MAP_GLB_BUDGET_PRINT=1 prints the measured violations as JSON.

const MAX_FILE_MB = 8;
const MAX_MAP_MB = 40;
const ROOT = new URL('../', import.meta.url);
const KNOWN_PATH = new URL('./fixtures/map-glb-budget-known.json', import.meta.url);
// The known list is a ratchet: lower this with the list, raise it only on an explicit instruction.
const KNOWN_COUNT_CEILING = 3;
const GLB_PATTERN = /\.glb(\?.*)?$/i;

const roundUp = (mb) => Math.ceil(mb * 10) / 10;

function collectGlbPaths(value, out, seen = new Set()) {
    if (typeof value === 'string') {
        if (GLB_PATTERN.test(value)) out.add(value.replace(/^\.?\//, '').replace(/\?.*$/, ''));
        return out;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return out;
    seen.add(value);
    for (const key of Object.keys(value)) collectGlbPaths(value[key], out, seen);
    return out;
}

function measureCatalog() {
    const files = new Map();
    const maps = [];
    const missing = [];
    for (const [mapKey, map] of Object.entries(MAP_PRESET_CATALOG)) {
        let total = 0;
        for (const path of collectGlbPaths(map, new Set())) {
            if (!existsSync(new URL(path, ROOT))) {
                missing.push({ map: mapKey, path });
                continue;
            }
            const mb = statSync(new URL(path, ROOT)).size / 1048576;
            files.set(path, mb);
            total += mb;
        }
        maps.push({ map: mapKey, mb: total });
    }
    return { files, maps, missing };
}

function findViolations() {
    const { files, maps, missing } = measureCatalog();
    return {
        missing,
        files: [...files].filter(([, mb]) => mb > MAX_FILE_MB).map(([path, mb]) => ({ path, mb: roundUp(mb) })),
        maps: maps.filter(({ mb }) => mb > MAX_MAP_MB).map(({ map, mb }) => ({ map, mb: roundUp(mb) })),
    };
}

function readKnown() {
    if (process.env.MAP_GLB_BUDGET_IGNORE_KNOWN === '1') return { files: [], maps: [] };
    return JSON.parse(readFileSync(KNOWN_PATH, 'utf8'));
}

function compareToKnown(measured, known, keyOf, label) {
    const problems = [];
    const knownByKey = new Map(known.map((entry) => [keyOf(entry), entry]));
    for (const item of measured) {
        const entry = knownByKey.get(keyOf(item));
        if (!entry) problems.push(`${label} ${keyOf(item)} is ${item.mb} MB, over budget and not listed`);
        else if (item.mb > entry.mb) problems.push(`${label} ${keyOf(item)} grew to ${item.mb} MB (listed ${entry.mb} MB)`);
        else if (item.mb < entry.mb) problems.push(`stale entry - lower ${label} ${keyOf(item)} to ${item.mb} MB (listed ${entry.mb} MB)`);
    }
    const measuredKeys = new Set(measured.map(keyOf));
    for (const entry of known) {
        if (!measuredKeys.has(keyOf(entry))) problems.push(`stale entry - remove ${label} ${keyOf(entry)}, it is within budget now`);
    }
    return problems;
}

test('known list is well formed and its counts match its entries', () => {
    const known = JSON.parse(readFileSync(KNOWN_PATH, 'utf8'));
    assert.ok(Array.isArray(known.files) && Array.isArray(known.maps), 'files and maps are lists');
    assert.equal(known.count, known.files.length + known.maps.length, 'count equals the number of entries');
    assert.ok(
        known.count <= KNOWN_COUNT_CEILING,
        `the known list grew to ${known.count} against the ratchet ${KNOWN_COUNT_CEILING}; shrink the GLB instead`,
    );
    for (const entry of known.files) {
        assert.ok(existsSync(new URL(entry.path, ROOT)), `${entry.path} exists`);
        assert.ok(entry.mb > MAX_FILE_MB && entry.reason, `${entry.path} states a size over the file budget and a reason`);
    }
    for (const entry of known.maps) {
        assert.ok(MAP_PRESET_CATALOG[entry.map], `${entry.map} is a catalog map`);
        assert.ok(entry.mb > MAX_MAP_MB && entry.reason, `${entry.map} states a size over the map budget and a reason`);
    }
});

test('every GLB a catalog map references exists on disk', () => {
    assert.deepEqual(findViolations().missing, []);
});

test('GLB files and maps stay within the load budget, except the listed legacy cases', () => {
    const violations = findViolations();
    if (process.env.MAP_GLB_BUDGET_PRINT === '1') console.log(JSON.stringify(violations, null, 2));
    const known = readKnown();
    const problems = [
        ...compareToKnown(violations.files, known.files, (item) => item.path, 'file'),
        ...compareToKnown(violations.maps, known.maps, (item) => item.map, 'map'),
    ];
    assert.deepEqual(problems, [], `GLB budget (${MAX_FILE_MB} MB per file, ${MAX_MAP_MB} MB per map):\n${problems.join('\n')}`);
});

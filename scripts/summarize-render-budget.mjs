#!/usr/bin/env node
// Turns the JSON lines of tests/map-render-budget.desktop.spec.js (PW_RENDER_BUDGET_OUT) into one
// table per map. With several lines per map it reports whether the counts repeated exactly,
// which is the precondition for guarding them on another machine.
//   node scripts/summarize-render-budget.mjs <file.ndjson> [--csv]
//   node scripts/summarize-render-budget.mjs <calibration.ndjson> <recheck.ndjson>... --write-budget scripts/architecture/map-render-budgets.json
// Budgets need at least two runs: counts of animated maps differ between identical runs.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRenderBudget } from './render-budget-ops.mjs';

// The frame rate the target PC (Intel UHD 630, 1080p, shipped quality) should reach; decided 12.10.2026.
const TARGET_FPS = 30;

const COUNT_KEYS = ['maxCalls', 'maxTriangles', 'textures', 'geometries', 'programs'];

export function readRecords(text) {
    return String(text || '').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

export function countSignature(counts) {
    return JSON.stringify({
        frames: counts.frames,
        lights: counts.lights,
        meshes: counts.meshes,
        ...Object.fromEntries(COUNT_KEYS.map((key) => [key, counts[key]])),
    });
}

export function summarizeRecords(records) {
    const byMap = new Map();
    for (const record of records) {
        if (!byMap.has(record.mapKey)) byMap.set(record.mapKey, []);
        byMap.get(record.mapKey).push(record);
    }
    return [...byMap.entries()].map(([mapKey, entries]) => {
        const last = entries[entries.length - 1];
        const plays = entries.map((entry) => entry.play).filter(Boolean);
        const median = (values) => {
            const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
            return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
        };
        return {
            mapKey,
            runs: entries.length,
            repeatable: new Set(entries.map((entry) => countSignature(entry.counts))).size === 1,
            maxCalls: last.counts.maxCalls,
            maxTriangles: last.counts.maxTriangles,
            pointLights: last.counts.lights.point,
            spotLights: last.counts.lights.spot,
            shadowLights: last.counts.lights.shadowCasting,
            shadowCasters: last.counts.meshes.shadowCasters,
            transparent: last.counts.meshes.transparent,
            transmissive: last.counts.meshes.transmissive,
            textures: last.counts.textures,
            programs: last.counts.programs,
            fps: median(plays.map((play) => play.fps)),
            p95: median(plays.map((play) => play.p95)),
            gpuMs: median(plays.map((play) => play.gpuMsP50)),
        };
    });
}

function format(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(1);
    return String(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const files = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--write-budget');
    const flag = args.find((arg) => arg.startsWith('--'));
    const budgetOut = flag === '--write-budget' ? args[args.indexOf(flag) + 1] : '';
    if (files.length === 0 || (flag === '--write-budget' && !budgetOut)) {
        console.error('usage: node scripts/summarize-render-budget.mjs <file.ndjson>... [--csv | --write-budget <file.json>]');
        process.exit(2);
    }
    const records = files.flatMap((file) => readRecords(readFileSync(file, 'utf8')));
    if (flag === '--write-budget') {
        const gpu = records.find((record) => record.play?.gpu)?.play.gpu || 'unknown';
        const measuredAt = records.map((record) => record.measuredAt).sort().pop()?.slice(0, 10) || '';
        const budget = buildRenderBudget(records, { targetFps: TARGET_FPS, measuredOn: gpu, measuredAt });
        writeFileSync(budgetOut, `${JSON.stringify(budget, null, 2)}\n`, 'utf8');
        console.log(`[render-budget] wrote ${Object.keys(budget.maps).length} maps to ${budgetOut}`);
        process.exit(0);
    }
    const rows = summarizeRecords(records)
        .sort((a, b) => (a.fps ?? Infinity) - (b.fps ?? Infinity) || b.maxCalls - a.maxCalls);
    const columns = Object.keys(rows[0] || { mapKey: '' });
    const separator = flag === '--csv' ? ';' : '\t';
    console.log(columns.join(separator));
    for (const row of rows) console.log(columns.map((column) => format(row[column])).join(separator));
    const unstable = rows.filter((row) => !row.repeatable).map((row) => row.mapKey);
    if (unstable.length) console.error(`[render-budget] counts differed between runs: ${unstable.join(', ')}`);
}

#!/usr/bin/env node
// Turns the JSON lines of tests/map-render-budget.desktop.spec.js (PW_RENDER_BUDGET_OUT) into one
// table per map. With several lines per map it reports whether the counts repeated exactly,
// which is the precondition for guarding them on another machine.
//   node scripts/summarize-render-budget.mjs <file.ndjson> [--csv]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    const [file, flag] = process.argv.slice(2);
    if (!file) {
        console.error('usage: node scripts/summarize-render-budget.mjs <file.ndjson> [--csv]');
        process.exit(2);
    }
    const rows = summarizeRecords(readRecords(readFileSync(file, 'utf8')))
        .sort((a, b) => (a.fps ?? Infinity) - (b.fps ?? Infinity) || b.maxCalls - a.maxCalls);
    const columns = Object.keys(rows[0] || { mapKey: '' });
    const separator = flag === '--csv' ? ';' : '\t';
    console.log(columns.join(separator));
    for (const row of rows) console.log(columns.map((column) => format(row[column])).join(separator));
    const unstable = rows.filter((row) => !row.repeatable).map((row) => row.mapKey);
    if (unstable.length) console.error(`[render-budget] counts differed between runs: ${unstable.join(', ')}`);
}

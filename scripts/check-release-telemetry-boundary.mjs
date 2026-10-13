#!/usr/bin/env node
// Release guard for local round telemetry: a release build must neither record nor export it.
// Prepared, not yet part of any build: which build counts as "release" is still open (roadmap
// "Release-Kriterium festlegen"). Until then the game export still records rounds on purpose.
// Usage: node scripts/check-release-telemetry-boundary.mjs <output-dir>

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { RELEASE_TELEMETRY_MARKERS } from '../src/shared/contracts/TelemetryExportContract.js';

const DEV_PANEL_MARKERS = Object.freeze(['developer-telemetry-panel', 'telemetry-collection-toggle']);
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html']);

function* walk(directory) {
    for (const name of readdirSync(directory)) {
        const file = path.join(directory, name);
        if (statSync(file).isDirectory()) yield* walk(file);
        else if (SCANNED_EXTENSIONS.has(path.extname(name))) yield file;
    }
}

/**
 * @param {string} outputDir
 * @returns {{ ok: boolean, checkedFiles: number, findings: Array<{ file: string, marker: string }> }}
 */
export function checkReleaseTelemetryBoundary(outputDir) {
    if (!existsSync(outputDir)) throw new Error(`release telemetry check: ${outputDir} does not exist`);
    const findings = [];
    let checkedFiles = 0;
    for (const file of walk(outputDir)) {
        checkedFiles += 1;
        const text = readFileSync(file, 'utf8');
        for (const marker of [...RELEASE_TELEMETRY_MARKERS, ...DEV_PANEL_MARKERS]) {
            if (text.includes(marker)) findings.push({ file: path.relative(outputDir, file).replace(/\\/g, '/'), marker });
        }
    }
    return { ok: findings.length === 0, checkedFiles, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const outputDir = path.resolve(process.argv[2] || 'dist-game');
    const result = checkReleaseTelemetryBoundary(outputDir);
    console.log(JSON.stringify({ outputDirectory: outputDir, checkedFiles: result.checkedFiles, releaseTelemetryBoundary: result.ok ? 'ok' : 'violated', findings: result.findings.slice(0, 20) }));
    if (!result.ok) process.exitCode = 1;
}

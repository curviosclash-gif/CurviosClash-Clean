#!/usr/bin/env node
// ============================================
// check-release-package-fresh.mjs
// Compares a packaged build marker against the watched source inputs.
// Exit 0: package is current (marker is at least as new as all inputs).
// Exit 1: an input is newer than the marker (or the marker is missing).
// Exit 2: usage error.
// ============================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXCLUDED_DIR_NAMES = new Set([
    'node_modules',
    '.git',
    'release',
    'dist',
    'dist-app',
    'out',
    'tmp',
    'test-results',
]);

function findNewest(target) {
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isDirectory()) {
        return { mtimeMs: stat.mtimeMs, file: target };
    }
    let newest = null;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        const candidate = findNewest(path.join(target, entry.name));
        if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) {
            newest = candidate;
        }
    }
    return newest;
}

export function checkReleasePackageFresh(marker, inputs) {
    const markerStat = fs.statSync(marker, { throwIfNoEntry: false });
    if (!markerStat) {
        return { fresh: false, reason: `Paket-Marker fehlt: ${marker}` };
    }
    let newest = null;
    for (const input of inputs) {
        const candidate = findNewest(input);
        if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) {
            newest = candidate;
        }
    }
    if (newest && newest.mtimeMs > markerStat.mtimeMs) {
        return { fresh: false, reason: `${newest.file} ist neuer als das Paket.` };
    }
    return { fresh: true, reason: 'Paket ist aktuell.' };
}

function main(argv) {
    const [marker, ...inputs] = argv;
    if (!marker || inputs.length === 0) {
        console.error('Usage: node check-release-package-fresh.mjs <packageMarkerFile> <input> [<input>...]');
        return 2;
    }
    const result = checkReleasePackageFresh(marker, inputs);
    console.log(`${result.fresh ? 'fresh' : 'stale'}: ${result.reason}`);
    return result.fresh ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.slice(2)));
}

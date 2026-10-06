// Content fingerprint of the sources the test build (dist-app-test) is made from. The
// build stores it next to its output, so a later freshness check can compare contents
// instead of timestamps: a git checkout or merge rewrites unchanged files with a new mtime.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXCLUDED_DIR_NAMES } from './check-release-package-fresh.mjs';

/** Source inputs of dist-app-test; the same set feeds the timestamp and the content check. */
export const TEST_BUILD_INPUTS = Object.freeze([
    'src', 'electron', 'editor', 'prototypes', 'dev/vite', 'index.html', 'hangar.html',
    'style.css', 'app-shell.css', 'vite.config.js', 'package.json',
]);
export const TEST_BUILD_FINGERPRINT_FILE = '.source-fingerprint.json';

function collectFiles(target, out) {
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) return;
    if (!stat.isDirectory()) {
        out.push(target);
        return;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        // A worktree links node_modules as a junction, which is a symlink entry, not a directory.
        if ((entry.isDirectory() || entry.isSymbolicLink()) && EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        collectFiles(path.join(target, entry.name), out);
    }
}

/** sha256 over relative path, size and content of every input file (about 0.6 s). */
export function computeSourceFingerprint(repoRoot, inputs = TEST_BUILD_INPUTS) {
    const files = [];
    for (const entry of inputs) collectFiles(path.join(repoRoot, entry), files);
    const entries = files
        .map((file) => ({ file, rel: path.relative(repoRoot, file).split(path.sep).join('/') }))
        .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    const hash = crypto.createHash('sha256');
    for (const { file, rel } of entries) {
        const content = fs.readFileSync(file);
        hash.update(`${rel}\0${content.length}\0`);
        hash.update(content);
    }
    return { fingerprint: hash.digest('hex'), files: entries.length };
}

export function writeBuildFingerprint(buildDir, { fingerprint, files }) {
    fs.writeFileSync(path.join(buildDir, TEST_BUILD_FINGERPRINT_FILE),
        `${JSON.stringify({ fingerprint, files, createdAt: new Date().toISOString() }, null, 2)}\n`);
}

export function readBuildFingerprint(buildDir) {
    try {
        const stored = JSON.parse(fs.readFileSync(path.join(buildDir, TEST_BUILD_FINGERPRINT_FILE), 'utf8'));
        return typeof stored?.fingerprint === 'string' ? stored : null;
    } catch {
        return null;
    }
}

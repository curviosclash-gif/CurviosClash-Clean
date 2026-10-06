// Where a playtest result comes from: build, source revision, local changes, pilot
// version. Before a run the test build is compared with the sources it is made from, so
// a result never silently describes an older game than the one in the working tree.
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { checkReleasePackageFresh } from '../check-release-package-fresh.mjs';
import { PILOT_VERSION } from './playtest-pilot-runtime.mjs';

/** Source inputs of dist-app-test; a newer file in any of them means the build is stale. */
export const TEST_BUILD_INPUTS = Object.freeze([
    'src', 'electron', 'editor', 'prototypes', 'dev/vite', 'index.html', 'hangar.html',
    'style.css', 'app-shell.css', 'vite.config.js', 'package.json',
]);
const IGNORED_INPUT_DIRS = new Set(['node_modules', 'vendor', 'release', 'tuning-console-dist']);

function git(repoRoot, args) {
    return new Promise((resolve) => {
        execFile('git', ['-C', repoRoot, ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            // Only trailing whitespace: porcelain lines start with a meaningful space.
            resolve(error ? null : String(stdout).replace(/\s+$/, ''));
        });
    });
}

/**
 * Build marker, revision and freshness of dist-app-test. `fresh: false` with a reason
 * when a source file is newer than the build (or the build is missing).
 */
export async function describeProvenance(repoRoot) {
    const marker = path.join(repoRoot, 'dist-app-test', 'index.html');
    const markerStat = statSync(marker, { throwIfNoEntry: false });
    const inputs = TEST_BUILD_INPUTS.map((entry) => path.join(repoRoot, entry))
        .filter((entry) => !IGNORED_INPUT_DIRS.has(path.basename(entry)));
    const freshness = markerStat ? checkReleasePackageFresh(marker, inputs) : { fresh: false, reason: 'dist-app-test is missing' };
    const [revision, branch, status] = await Promise.all([
        git(repoRoot, ['rev-parse', 'HEAD']),
        git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
        git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=no']),
    ]);
    const changedFiles = status ? status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3)) : [];
    return {
        build: {
            directory: 'dist-app-test',
            builtAt: markerStat ? new Date(markerStat.mtimeMs).toISOString() : null,
            fresh: freshness.fresh === true,
            reason: freshness.reason,
        },
        revision,
        branch,
        localChanges: changedFiles.length,
        localChangedFiles: changedFiles.slice(0, 20),
        pilotVersion: PILOT_VERSION,
        node: process.version,
        checkedAt: new Date().toISOString(),
    };
}

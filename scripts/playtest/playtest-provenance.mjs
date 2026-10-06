// Where a playtest result comes from: build, source revision, local changes, pilot
// version. Before a run the test build is compared with the sources it is made from, so
// a result never silently describes an older game than the one in the working tree. A
// source newer than the build only counts when its content changed: git rewrites
// unchanged files on checkout or merge, and the build stores a content fingerprint.
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { checkReleasePackageFresh } from '../check-release-package-fresh.mjs';
import { computeSourceFingerprint, readBuildFingerprint, TEST_BUILD_INPUTS } from '../test-build-fingerprint.mjs';
import { PILOT_VERSION } from './playtest-pilot-runtime.mjs';

function git(repoRoot, args) {
    return new Promise((resolve) => {
        execFile('git', ['-C', repoRoot, ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            // Only trailing whitespace: porcelain lines start with a meaningful space.
            resolve(error ? null : String(stdout).replace(/\s+$/, ''));
        });
    });
}

/**
 * Timestamps first (cheap); when a source is newer than the build, the stored content
 * fingerprint decides. Builds without a fingerprint keep the timestamp verdict.
 */
export function checkTestBuildFresh(repoRoot) {
    const buildDir = path.join(repoRoot, 'dist-app-test');
    const marker = path.join(buildDir, 'index.html');
    if (!statSync(marker, { throwIfNoEntry: false })) return { fresh: false, reason: 'dist-app-test is missing', checkedBy: 'timestamp' };
    const byTime = checkReleasePackageFresh(marker, TEST_BUILD_INPUTS.map((entry) => path.join(repoRoot, entry)));
    if (byTime.fresh) return { ...byTime, checkedBy: 'timestamp' };
    const stored = readBuildFingerprint(buildDir);
    if (!stored) return { ...byTime, checkedBy: 'timestamp' };
    if (stored.fingerprint === computeSourceFingerprint(repoRoot).fingerprint) {
        return { fresh: true, reason: 'Quellen inhaltlich unverändert seit dem Build; nur Zeitstempel sind neuer.', checkedBy: 'content' };
    }
    return { fresh: false, reason: `${byTime.reason} Inhalt geändert seit dem Build.`, checkedBy: 'content' };
}

/**
 * Build marker, revision and freshness of dist-app-test. `fresh: false` with a reason
 * when a source changed after the build (or the build is missing).
 */
export async function describeProvenance(repoRoot) {
    const markerStat = statSync(path.join(repoRoot, 'dist-app-test', 'index.html'), { throwIfNoEntry: false });
    const freshness = checkTestBuildFresh(repoRoot);
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
            checkedBy: freshness.checkedBy,
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

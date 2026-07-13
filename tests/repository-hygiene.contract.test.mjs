import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repositoryRoot = new URL('../', import.meta.url);

function listTrackedFiles() {
    return execFileSync('git', ['ls-files', '-z'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    }).split('\0').filter(Boolean).map((path) => path.replaceAll('\\', '/'));
}

function isForbiddenTrackedPath(path) {
    const segments = path.split('/');
    const forbiddenSegments = new Set([
        'node_modules',
        'dist-app',
        'release',
        'playwright-report',
        'tmp',
        '.agents',
        'knowledge-graph',
        'rag',
        'planarchive',
        'lock-wrapper',
    ]);

    if (path.toLowerCase().endsWith('.log')) return true;
    if (segments.some((segment) => forbiddenSegments.has(segment.toLowerCase()))) return true;
    if (segments.some((segment) => /^test-results(?:$|[-_])/i.test(segment))) return true;
    return segments.some((segment) => (
        /^(?:generated[-_ ]?process[-_ ]?reports?|generierte[-_ ]?prozessberichte)$/i.test(segment)
    ));
}

test('tracked files exclude dependencies, generated output and process ballast', () => {
    const forbiddenFiles = listTrackedFiles().filter(isForbiddenTrackedPath);
    assert.deepEqual(forbiddenFiles, [], `Forbidden tracked files:\n${forbiddenFiles.join('\n')}`);
});

test('README bootstrap uses only local package manifests and no repository remote', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.match(readme, /npm ci/);
    assert.match(readme, /npm --prefix electron ci/);
    assert.doesNotMatch(readme, /git (?:pull|fetch|submodule)|github\.com/i);
});

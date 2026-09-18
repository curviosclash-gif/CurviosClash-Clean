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
        'planarchives',
        'plan-archive',
        'plan-archives',
        'lock-wrapper',
        'lock-wrappers',
    ]);

    if (path.toLowerCase().endsWith('.log')) return true;
    if (segments.some((segment) => forbiddenSegments.has(segment.toLowerCase()))) return true;
    if (segments.some((segment) => /^test-results(?:$|[-_])/i.test(segment))) return true;
    return segments.some((segment) => (
        /^(?:generated[-_ ]?process[-_ ]?reports?|generierte[-_ ]?prozessberichte)(?:[-_ ].*)?(?:\.[^.]+)?$/i.test(segment)
    ));
}

test('tracked files exclude dependencies, generated output and process ballast', () => {
    const forbiddenFiles = listTrackedFiles().filter(isForbiddenTrackedPath);
    assert.deepEqual(forbiddenFiles, [], `Forbidden tracked files:\n${forbiddenFiles.join('\n')}`);
});

// Der alte 2D-Karten-Editor wurde stillgelegt (Plan F8). Er war kein
// Vite-Eingang, hatte keinen Menuepunkt und wurde nur noch von zwei dauerhaft
// roten Tests geladen. Dieser Waechter haelt die Seite draussen.
const RETIRED_LEGACY_EDITOR_PAGE = 'map-editor.html';
// Diese Datei nennt den Namen selbst und ist deshalb von der Suche ausgenommen.
const LEGACY_EDITOR_GUARD_FILE = decodeURIComponent(import.meta.url)
    .slice(decodeURIComponent(repositoryRoot.href).length);

function isLegacyEditorScanPath(path) {
    if (path === LEGACY_EDITOR_GUARD_FILE) return false;
    const [firstSegment] = path.split('/');
    if (['editor', 'tests', 'src', 'scripts', 'dev', 'electron', 'docs'].includes(firstSegment)) return true;
    if (path === 'README.md' || path === 'index.html') return true;
    return /\.(?:bat|cmd)$/i.test(path);
}

test('the retired legacy 2d map editor page stays gone', () => {
    const trackedFiles = listTrackedFiles();
    assert.ok(
        !trackedFiles.includes(`editor/${RETIRED_LEGACY_EDITOR_PAGE}`),
        'the legacy 2d map editor page was retired and must not come back',
    );

    const referencingFiles = trackedFiles.filter((path) => (
        isLegacyEditorScanPath(path)
        && readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').includes(RETIRED_LEGACY_EDITOR_PAGE)
    ));
    assert.deepEqual(referencingFiles, [], `Legacy 2D map editor references:\n${referencingFiles.join('\n')}`);
});

test('README bootstrap uses only local package manifests and no repository remote', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.match(readme, /npm ci/);
    assert.match(readme, /npm --prefix electron ci/);
    assert.doesNotMatch(readme, /git (?:pull|fetch|submodule)|github\.com/i);
});

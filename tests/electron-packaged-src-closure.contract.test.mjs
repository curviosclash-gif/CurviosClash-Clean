import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = path.join(repoRoot, 'src');

/**
 * The packaged app ships a hand-picked slice of `src/` into `resources/src`, and the
 * Settings Studio, the tuning console and the LAN signaling server import from there at
 * runtime. A missing file only shows up when the installed app is started, so this guard
 * walks the static import graph from those entries and compares it with the packaging
 * filters. Regex over import statements is enough here: the graph is plain ESM without
 * aliases, and a parser dependency would buy nothing.
 */
const IMPORT_SPECIFIER_PATTERN = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"\n]+)['"]/g;

/** Entry files that the packaged app loads out of `resources/src`, with the loader that does it. */
const PACKAGED_SRC_ENTRIES = Object.freeze([
    {
        entry: 'src/core/settings/SettingsOverrideContract.js',
        loadedBy: 'electron/settings-studio/services/SettingsSchemaService.cjs',
    },
    {
        entry: 'src/ui/menu/MenuEditorModel.js',
        loadedBy: 'electron/settings-studio/services/SettingsSchemaService.cjs',
    },
    {
        entry: 'src/ui/menu/MenuTextCatalog.js',
        loadedBy: 'electron/settings-studio/services/SettingsMenuTextOverrideService.cjs',
    },
    {
        entry: 'src/shared/contracts/BrowserDemoSurfacePolicyOverrideContract.js',
        loadedBy: 'electron/settings-studio/services/SettingsBrowserDemoPolicyService.cjs',
    },
    {
        entry: 'server/lan-signaling.js',
        loadedBy: 'electron/main.cjs',
    },
    {
        entry: 'electron/tuning-console/tuning-app.js',
        loadedBy: 'electron/tuning-console/tuning.html',
        // The game export ships no tuning console, so this entry is packaged-app only.
        packagedAppOnly: true,
    },
]);

/**
 * The game export strips developer telemetry and rewrites the one shipped file that
 * imports it (`transformGameFile` in scripts/export-game-repo.mjs inlines the storage
 * key), so this edge does not exist in the exported tree.
 */
const GAME_EXPORT_REWRITTEN_EDGES = Object.freeze([
    {
        importer: 'src/shared/storage/StorageKeys.js',
        target: 'src/shared/contracts/AuthoringTelemetryContract.js',
    },
]);

function toPosix(absolutePath) {
    return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

function collectSpecifiers(absolutePath) {
    const source = readFileSync(absolutePath, 'utf8');
    return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => match[1]);
}

/**
 * Walks relative imports only. Bare specifiers (`three`, `electron`, `node:fs`) come from
 * the bundle or from node_modules, never from `resources/src`. Specifiers that do not
 * resolve to a file on disk are skipped on purpose: the regex also sees strings that merely
 * look like imports, and a real broken import surfaces in lint and in the build.
 */
function walkImportGraph(entries, { skippedEdges = [] } = {}) {
    const isSkipped = (importer, target) => skippedEdges.some(
        (edge) => edge.importer === importer && edge.target === target
    );
    const reached = new Map();
    const visited = new Set();
    const queue = entries.map((entry) => ({
        absolutePath: path.join(repoRoot, entry.entry),
        importedBy: entry.loadedBy,
    }));

    while (queue.length > 0) {
        const { absolutePath, importedBy } = queue.shift();
        if (visited.has(absolutePath)) continue;
        visited.add(absolutePath);
        if (!existsSync(absolutePath)) continue;

        const relativePath = toPosix(absolutePath);
        if (relativePath.startsWith('src/') && !reached.has(relativePath)) {
            reached.set(relativePath, importedBy);
        }

        for (const specifier of collectSpecifiers(absolutePath)) {
            if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
            const target = path.resolve(path.dirname(absolutePath), specifier);
            if (isSkipped(relativePath, toPosix(target))) continue;
            queue.push({ absolutePath: target, importedBy: relativePath });
        }
    }

    return reached;
}

/** Turns one electron-builder filter glob into a regular expression (`*` and `**` only). */
function globToRegExp(pattern) {
    let expression = '';
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === '*') {
            if (pattern[index + 1] === '*') {
                if (pattern[index + 2] === '/') {
                    expression += '(?:.*/)?';
                    index += 2;
                } else {
                    expression += '.*';
                    index += 1;
                }
            } else {
                expression += '[^/]*';
            }
            continue;
        }
        if (character === '?') {
            expression += '[^/]';
            continue;
        }
        expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${expression}$`);
}

function createFilterMatcher(filter) {
    const includes = [];
    const excludes = [];
    for (const pattern of filter) {
        if (pattern.startsWith('!')) excludes.push(globToRegExp(pattern.slice(1)));
        else includes.push(globToRegExp(pattern));
    }
    return (relativeToSrc) => includes.some((matcher) => matcher.test(relativeToSrc))
        && !excludes.some((matcher) => matcher.test(relativeToSrc));
}

function readPackagedAppSrcFilter() {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'electron/package.json'), 'utf8'));
    const entry = manifest.build?.extraResources?.find((candidate) => candidate.to === 'src');
    assert.ok(entry?.filter?.length, 'electron/package.json must map ../src into resources/src');
    return entry.filter;
}

function readGameExportSrcFilter() {
    const yml = readFileSync(path.join(repoRoot, 'game-export/electron-builder.yml'), 'utf8');
    const afterSrcEntry = yml.split('from: ../src')[1];
    assert.ok(afterSrcEntry, 'game-export/electron-builder.yml must map ../src into resources/src');
    const block = afterSrcEntry.split(/\n {2}- from:/)[0];
    const filter = [...block.matchAll(/^ {6}- '?(.+?)'?\s*$/gm)].map((match) => match[1]);
    assert.ok(filter.length > 20, 'game export src filter parsing drifted');
    return filter;
}

function describeMissing(reached, matches) {
    return [...reached.entries()]
        .filter(([relativePath]) => !matches(relativePath.slice('src/'.length)))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([relativePath, importedBy]) => `${relativePath} (imported by ${importedBy})`);
}

test('packaged src entry points still load the files this guard walks', () => {
    for (const { entry, loadedBy } of PACKAGED_SRC_ENTRIES) {
        assert.ok(existsSync(path.join(repoRoot, entry)), `${entry} must exist`);
        const loaderSource = readFileSync(path.join(repoRoot, loadedBy), 'utf8');
        assert.ok(
            loaderSource.includes(path.basename(entry)),
            `${loadedBy} must still load ${entry} out of resources/src`
        );
    }
    assert.ok(existsSync(srcRoot), 'src/ must exist');
});

test('the packaged app ships every src file its runtime entry points import', () => {
    const reached = walkImportGraph(PACKAGED_SRC_ENTRIES);
    const matches = createFilterMatcher(readPackagedAppSrcFilter());
    const missing = describeMissing(reached, matches);
    assert.deepEqual(
        missing,
        [],
        `imported at runtime but not packaged by electron/package.json:\n${missing.join('\n')}`
    );
});

test('the game export ships every src file its runtime entry points import', () => {
    const exportSource = readFileSync(path.join(repoRoot, 'scripts/export-game-repo.mjs'), 'utf8');
    for (const { importer } of GAME_EXPORT_REWRITTEN_EDGES) {
        assert.ok(
            exportSource.includes(importer),
            `${importer} is no longer rewritten by the game export, so the skipped edge is stale`
        );
    }

    const reached = walkImportGraph(
        PACKAGED_SRC_ENTRIES.filter((entry) => entry.packagedAppOnly !== true),
        { skippedEdges: GAME_EXPORT_REWRITTEN_EDGES }
    );
    const matches = createFilterMatcher(readGameExportSrcFilter());
    const missing = describeMissing(reached, matches);
    assert.deepEqual(
        missing,
        [],
        `imported at runtime but not packaged by game-export/electron-builder.yml:\n${missing.join('\n')}`
    );
});

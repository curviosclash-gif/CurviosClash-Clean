import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const HANGAR_DIR = path.join(SRC_ROOT, 'ui', 'hangar');
const UNUSED_FILES = Object.freeze([
    'HangarShellLayoutContract.js',
    'HangarDesktopEntryContract.js',
    'HangarLifecycleContract.js',
]);
const UNUSED_MARKER = 'NICHT IN BENUTZUNG';

async function listJsFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await listJsFiles(fullPath));
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }
    return files;
}

test('the unused hangar shell modules carry their marker', async () => {
    for (const fileName of UNUSED_FILES) {
        const source = await readFile(path.join(HANGAR_DIR, fileName), 'utf8');
        assert.ok(
            source.includes(UNUSED_MARKER),
            `${fileName} states that it is not in use`
        );
        assert.match(
            source,
            /ArcadeHangarWorkshop\.js|HangarShellLayoutContract\.js/,
            `${fileName} points at the surface that is actually used`
        );
    }
});

test('no production source outside the cluster imports the hangar shell modules', async () => {
    const clusterPaths = new Set(UNUSED_FILES.map((fileName) => path.join(HANGAR_DIR, fileName)));
    const sources = (await listJsFiles(SRC_ROOT)).filter((filePath) => !clusterPaths.has(filePath));
    const importers = [];
    for (const filePath of sources) {
        const source = await readFile(filePath, 'utf8');
        if (/HangarShellLayoutContract|HangarDesktopEntryContract|HangarLifecycleContract/.test(source)) {
            importers.push(path.relative(REPO_ROOT, filePath));
        }
    }
    assert.deepEqual(
        importers,
        [],
        'the unused marker stays honest: taking the shell layout into use means removing it'
    );
});

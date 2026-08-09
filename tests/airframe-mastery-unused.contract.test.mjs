import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const MASTERY_DIR = path.join(SRC_ROOT, 'entities', 'arcade');
const MASTERY_FILES = Object.freeze(['AirframeMasteryCatalog.js', 'AirframeMasteryOps.js']);
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

test('the airframe mastery modules carry their unused marker', async () => {
    for (const fileName of MASTERY_FILES) {
        const source = await readFile(path.join(MASTERY_DIR, fileName), 'utf8');
        assert.ok(
            source.includes(UNUSED_MARKER),
            `${fileName} states that it is not in use`
        );
        assert.match(
            source,
            /ArcadeVehicleProfile\.js/,
            `${fileName} points at the progression path that is actually used`
        );
    }
});

test('no production source imports the airframe mastery modules', async () => {
    const masteryPaths = new Set(MASTERY_FILES.map((fileName) => path.join(MASTERY_DIR, fileName)));
    const sources = (await listJsFiles(SRC_ROOT)).filter((filePath) => !masteryPaths.has(filePath));
    const importers = [];
    for (const filePath of sources) {
        const source = await readFile(filePath, 'utf8');
        if (/AirframeMastery(Catalog|Ops)/.test(source)) {
            importers.push(path.relative(REPO_ROOT, filePath));
        }
    }
    assert.deepEqual(
        importers,
        [],
        'the unused marker stays honest: taking the mastery system into use means removing it'
    );
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUDIO_DIRECTORY = path.join(ROOT, 'assets', 'audio');
const AUDIO_FILE_PATTERN = /\.(?:aac|flac|m4a|mp3|ogg|opus|wav|webm)$/i;
const ALLOWED_LICENSES = new Set(['project-original', 'CC0-1.0', 'CC-BY-SA-2.0', 'PDM-1.0']);

async function listFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
    }));
    return nested.flat();
}

test('audio asset manifest permits only approved free sources', async () => {
    const manifestPath = path.join(AUDIO_DIRECTORY, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.policy, 'project-original-or-approved-free');
    assert.ok(Array.isArray(manifest.runtimeGenerated));
    assert.ok(Array.isArray(manifest.thirdPartyAssets));

    const allEntries = [...manifest.runtimeGenerated, ...manifest.thirdPartyAssets];
    const ids = new Set();
    for (const entry of allEntries) {
        assert.equal(typeof entry.id, 'string');
        assert.ok(entry.id.length > 0);
        assert.equal(ids.has(entry.id), false, `duplicate audio id: ${entry.id}`);
        ids.add(entry.id);
        assert.ok(ALLOWED_LICENSES.has(entry.license), `unsupported audio license: ${entry.license}`);
        if (entry.license === 'project-original') {
            assert.equal(typeof entry.source, 'string');
            await access(path.join(ROOT, entry.source));
        }
        if (entry.license !== 'project-original') {
            assert.ok(String(entry.author || '').trim().length > 0);
            assert.match(String(entry.sourceUrl || ''), /^https:\/\//);
            assert.match(String(entry.downloadUrl || ''), /^https:\/\//);
            assert.match(String(entry.licenseUrl || ''), /^https:\/\//);
            assert.match(String(entry.sha256 || ''), /^[a-f0-9]{64}$/i);
            const bytes = await readFile(path.join(AUDIO_DIRECTORY, entry.file));
            const actualHash = createHash('sha256').update(bytes).digest('hex');
            assert.equal(actualHash, entry.sha256, `audio hash mismatch: ${entry.file}`);
        }
        if (entry.license === 'CC-BY-SA-2.0') {
            assert.ok(String(entry.modifications || '').trim().length > 0);
            assert.match(String(entry.attribution || ''), /Advent Chamber Orchestra/);
        }
        if (entry.license === 'PDM-1.0') {
            assert.ok(String(entry.attribution || '').trim().length > 0);
            assert.ok(String(entry.modifications || '').trim().length > 0);
        }
    }
});

test('every bundled audio file is represented in the third-party manifest', async () => {
    const manifest = JSON.parse(await readFile(path.join(AUDIO_DIRECTORY, 'manifest.json'), 'utf8'));
    const manifestedFiles = new Set(manifest.thirdPartyAssets.map((entry) => path.normalize(entry.file)));
    const bundledFiles = (await listFiles(AUDIO_DIRECTORY))
        .filter((filePath) => AUDIO_FILE_PATTERN.test(filePath))
        .map((filePath) => path.relative(AUDIO_DIRECTORY, filePath));

    assert.deepEqual(bundledFiles.sort(), [...manifestedFiles].sort());
});

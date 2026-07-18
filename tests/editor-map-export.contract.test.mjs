import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeFilesAtomically } from '../dev/vite/editorDiskApiPlugin.js';

test('map export replaces all staged files and removes transaction artifacts', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'curvios-map-export-'));
    const editorPath = path.join(directory, 'map.editor.json');
    const runtimePath = path.join(directory, 'map.runtime.json');
    try {
        writeFileSync(editorPath, 'old editor', 'utf8');
        writeFilesAtomically([
            { filePath: editorPath, content: 'new editor' },
            { filePath: runtimePath, content: 'new runtime' },
        ]);

        assert.equal(readFileSync(editorPath, 'utf8'), 'new editor');
        assert.equal(readFileSync(runtimePath, 'utf8'), 'new runtime');
        assert.deepEqual(readdirSync(directory).sort(), ['map.editor.json', 'map.runtime.json']);
        assert.equal(existsSync(`${editorPath}.tmp`), false);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

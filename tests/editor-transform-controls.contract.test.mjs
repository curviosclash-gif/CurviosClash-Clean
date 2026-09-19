import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const editorCoreUrl = new URL('../editor/js/EditorCore.js', import.meta.url);

test('EditorCore adds the Three.js TransformControls helper to the scene', async () => {
    const source = await readFile(editorCoreUrl, 'utf8');

    assert.match(source, /this\.scene\.add\(this\.transformControl\.getHelper\(\)\);/);
    assert.doesNotMatch(source, /this\.scene\.add\(this\.transformControl\);/);
});

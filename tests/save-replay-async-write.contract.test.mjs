import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

test('desktop replay saves await the asynchronous write and keep the existing boolean result', () => {
    assert.match(mainSource, /require\(['"]node:fs\/promises['"]\)/);
    const handlerStart = mainSource.indexOf("ipcMain.handle('save-replay'");
    const handlerEnd = mainSource.indexOf("ipcMain.handle('save-recording-video-export'", handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'the replay IPC handler must remain registered');
    const handler = mainSource.slice(handlerStart, handlerEnd);

    assert.match(handler, /withTrustedMainWindowSender\(async \(jsonString, defaultName\)/);
    assert.match(handler, /await writeFile\(result\.filePath, jsonString, 'utf-8'\)/);
    assert.match(handler, /return true/);
    assert.match(handler, /return false/);
    assert.doesNotMatch(handler, /writeFileSync|return writeFile\(/);
});

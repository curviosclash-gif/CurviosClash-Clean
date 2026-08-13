import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const contractPath = [
    path.resolve('build/ffmpeg-win32-x64.json'),
    path.resolve('game-export/ffmpeg-win32-x64.json'),
].find(existsSync);
assert.ok(contractPath, 'Pinned FFmpeg contract is missing.');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const binaryPath = path.resolve('electron/node_modules/ffmpeg-static/ffmpeg.exe');
assert.equal(existsSync(binaryPath), true, `Pinned FFmpeg binary is missing: ${binaryPath}`);
const actualHash = createHash('sha256').update(readFileSync(binaryPath)).digest('hex');
assert.equal(actualHash, contract.sha256, `FFmpeg SHA-256 mismatch for ${contract.url}`);
console.log(JSON.stringify({ binaryPath, sha256: actualHash, source: contract.url }));

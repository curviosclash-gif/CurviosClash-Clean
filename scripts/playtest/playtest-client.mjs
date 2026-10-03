// Sends one playtest step to the running daemon and prints its JSON result.
//   node scripts/playtest/playtest-client.mjs step.mjs
//   node scripts/playtest/playtest-client.mjs --quit
import fs from 'node:fs/promises';
import path from 'node:path';
import { PLAYTEST_TOKEN_HEADER, resolvePlaytestOutDir } from './playtest-support.mjs';

const [target] = process.argv.slice(2);
if (!target) {
    console.error('usage: playtest-client.mjs <step-file> | --quit');
    process.exit(2);
}
const daemon = JSON.parse(await fs.readFile(path.join(resolvePlaytestOutDir(), 'daemon.json'), 'utf8'));
const quit = target === '--quit';
const body = quit ? '' : await fs.readFile(path.resolve(target), 'utf8');
const timeoutMs = Number(process.env.CURVIOS_PLAYTEST_TIMEOUT_MS) || 600_000;
const response = await fetch(`http://127.0.0.1:${daemon.port}/${quit ? 'quit' : 'eval'}`, {
    method: 'POST',
    headers: { [PLAYTEST_TOKEN_HEADER]: daemon.token },
    body,
    signal: AbortSignal.timeout(timeoutMs),
});
console.log(await response.text());
process.exit(response.ok ? 0 : 1);

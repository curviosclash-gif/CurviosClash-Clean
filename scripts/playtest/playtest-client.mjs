// Sends one playtest step to the running daemon and prints its JSON result.
//   node scripts/playtest/playtest-client.mjs step.mjs
//   node scripts/playtest/playtest-client.mjs --quit
import fs from 'node:fs/promises';
import path from 'node:path';
import { PLAYTEST_TOKEN_HEADER, resolveDaemonStateFile } from './playtest-support.mjs';

const [target] = process.argv.slice(2);
if (!target) {
    console.error('usage: playtest-client.mjs <step-file> | --quit');
    process.exit(2);
}
const stateFile = resolveDaemonStateFile();
const daemon = await fs.readFile(stateFile, 'utf8').then(JSON.parse, () => null);
if (!daemon) {
    console.error(`[playtest] no daemon state in ${stateFile}: start it with "npm run playtest:daemon".`);
    process.exit(2);
}
const quit = target === '--quit';
const body = quit ? '' : await fs.readFile(path.resolve(target), 'utf8');
// Longer than the daemon's own step timeout, so its 504 answer arrives first.
const timeoutMs = Number(process.env.CURVIOS_PLAYTEST_TIMEOUT_MS) || 600_000;
let response = null;
try {
    response = await fetch(`http://127.0.0.1:${daemon.port}/${quit ? 'quit' : 'eval'}`, {
        method: 'POST',
        headers: { [PLAYTEST_TOKEN_HEADER]: daemon.token },
        body,
        signal: AbortSignal.timeout(timeoutMs),
    });
} catch (error) {
    const refused = error?.cause?.code === 'ECONNREFUSED';
    console.error(refused
        ? `[playtest] daemon (pid ${daemon.pid}) does not answer on port ${daemon.port}; ${stateFile} is stale. Start it again with "npm run playtest:daemon".`
        : `[playtest] request failed: ${error?.message || error}`);
    process.exit(1);
}
if (response.headers.get('x-playtest-relaunched')) console.error('[playtest] note: the app had crashed and was relaunched before this step');
console.log(await response.text());
process.exit(response.ok ? 0 : 1);

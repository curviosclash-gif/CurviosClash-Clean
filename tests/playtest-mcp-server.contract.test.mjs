import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'scripts', 'playtest', 'playtest-mcp.mjs');

async function connect(nodeArgs = []) {
    const env = { ...process.env, CURVIOS_PLAYTEST_TRAY: '0' };
    const transport = new StdioClientTransport({ command: process.execPath, args: [...nodeArgs, SERVER], cwd: ROOT, env, stderr: 'pipe' });
    const client = new Client({ name: 'contract-test', version: '0' });
    await client.connect(transport);
    return client;
}

const parse = (result) => JSON.parse(result.content[0].text);

test('a real MCP client discovers exactly one tool and can call it without a session', { timeout: 60_000 }, async () => {
    const client = await connect();
    try {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((tool) => tool.name), ['curvios_playtest'], 'exactly one tool');
        const schema = tools[0].inputSchema;
        assert.deepEqual(schema.properties.operation.enum, ['catalog', 'open', 'observe', 'act', 'pilot', 'scenario', 'job', 'balancing', 'close']);
        assert.equal('eval' in schema.properties, false, 'no free JavaScript execution');
        assert.equal('expression' in schema.properties, false);

        const catalog = parse(await client.callTool({ name: 'curvios_playtest', arguments: { operation: 'catalog' } }));
        assert.ok(catalog.scenarios.parcours_acceptance && catalog.scenarios.duel_acceptance && catalog.scenarios.lan);
        assert.deepEqual(catalog.limits, { bots: [0, 8], winsNeeded: [1, 15] });
        assert.ok(catalog.pilotModes.includes('parcours') && catalog.maneuverFields.includes('climb'));
        assert.equal(catalog.maps, null, 'maps need an open session');

        const observed = await client.callTool({ name: 'curvios_playtest', arguments: { operation: 'observe' } });
        assert.equal(observed.isError, true);
        assert.equal(parse(observed).status, 'blocked', 'no session is a blocked state, not a crash');

        const jobs = parse(await client.callTool({ name: 'curvios_playtest', arguments: { operation: 'job' } }));
        assert.deepEqual(jobs, { active: null, jobs: [] });
        assert.deepEqual(parse(await client.callTool({ name: 'curvios_playtest', arguments: { operation: 'close' } })), { closed: false });

        const invalid = await client.callTool({ name: 'curvios_playtest', arguments: { operation: 'pilot', turn: 3 } });
        assert.equal(invalid.isError, true, 'schema bounds are enforced');
    } finally {
        await client.close();
    }
});

test('balancing reads map files without a session and asks for one only for live changes', { timeout: 60_000 }, async () => {
    const client = await connect();
    const call = (args) => client.callTool({ name: 'curvios_playtest', arguments: { operation: 'balancing', ...args } });
    try {
        const maps = parse(await call({ balancingAction: 'list_maps' }));
        assert.ok(maps.maps.some((entry) => entry.mapKey === 'maze'));
        const got = parse(await call({ balancingAction: 'get', map: 'maze' }));
        const speed = got.description.fields.find((row) => row.key === 'speed');
        assert.equal(got.description.modePath, 'fight');
        assert.ok(['mode', 'map'].includes(speed.origin));
        const live = await call({ balancingAction: 'set', scope: 'live', field: 'speed', value: 22 });
        assert.equal(live.isError, true);
        assert.equal(parse(live).status, 'blocked', 'live needs an open session');
        const invalid = await call({ balancingAction: 'save', scope: 'file', map: 'maze' });
        assert.equal(invalid.isError, true, 'save writes the live layer only');
    } finally {
        await client.close();
    }
});

test('a stray rejected promise does not end the server', { timeout: 60_000 }, async () => {
    // Like a scenario that leaves a popup wait behind: it rejects after the server is up.
    const stray = 'data:text/javascript,setTimeout(() => Promise.reject(new Error("stray scenario promise")), 300)';
    const client = await connect(['--import', stray]);
    try {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const jobs = parse(await client.callTool({ name: 'curvios_playtest', arguments: { operation: 'job' } }));
        assert.deepEqual(jobs, { active: null, jobs: [] });
    } finally {
        await client.close();
    }
});

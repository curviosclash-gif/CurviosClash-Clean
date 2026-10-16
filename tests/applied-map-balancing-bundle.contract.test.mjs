import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { APPLIED_MAP_BALANCING_FIELDS, validateAppliedMapBalancingDocument } from '../src/shared/contracts/AppliedMapBalancingContract.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('every versioned approval has a valid complete snapshot and a unique map/mode', () => {
    const folder = path.join(ROOT, 'data/balancing/applied');
    const entries = existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith('.json'))
        .map((file) => JSON.parse(readFileSync(path.join(folder, file), 'utf8'))) : [];
    assert.deepEqual(validateAppliedMapBalancingDocument({ version: 1, entries }), { ok: true, errors: [] });
});

test('a later Vite game build reads versioned approvals, and a local withdrawal overrides the shipped approval', async () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'curvios-applied-build-'));
    mkdirSync(path.join(fixture, 'src/shared/maps'), { recursive: true });
    mkdirSync(path.join(fixture, 'data/balancing/applied'), { recursive: true });
    symlinkSync(path.join(ROOT, 'src/shared/contracts'), path.join(fixture, 'src/shared/contracts'), 'junction');
    copyFileSync(path.join(ROOT, 'src/shared/maps/MapBalancingBundledData.js'), path.join(fixture, 'src/shared/maps/MapBalancingBundledData.js'));
    copyFileSync(path.join(ROOT, 'data/balancing/modes.json'), path.join(fixture, 'data/balancing/modes.json'));
    const modes = JSON.parse(readFileSync(path.join(ROOT, 'data/balancing/modes.json'), 'utf8'));
    const values = Object.fromEntries(APPLIED_MAP_BALANCING_FIELDS.map(({ key }) => [key, modes.modes.fight.values[key]]));
    values.speed = 25;
    const identity = { mapKey: 'maze', modePath: 'fight' };
    writeFileSync(path.join(fixture, 'data/balancing/applied/maze.fight.json'), JSON.stringify({ version: 1, ...identity, enabled: true, values }));
    const server = await createServer({ root: fixture, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null } });
    try {
        const module = await server.ssrLoadModule('/src/shared/maps/MapBalancingBundledData.js');
        assert.equal(module.getAppliedMapBalancing(identity).values.speed, 25);
        assert.equal(module.resolveBundledMapBalancing(identity).values.speed, 25);
        assert.equal(module.getAppliedMapBalancing({ ...identity, modePath: 'normal' }), null);
        module.setLocalAppliedMapBalancing({ version: 1, entries: [{ ...identity, enabled: false }] });
        assert.equal(module.getAppliedMapBalancing(identity), null);
        assert.equal(module.resolveBundledMapBalancing(identity).values.speed, modes.modes.fight.values.speed);
    } finally {
        await server.close();
    }
});

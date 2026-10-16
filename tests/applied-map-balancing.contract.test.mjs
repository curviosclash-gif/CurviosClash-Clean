import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLIED_MAP_BALANCING_FIELDS, normalizeAppliedMapBalancingDocument, validateAppliedMapBalancingDocument } from '../src/shared/contracts/AppliedMapBalancingContract.js';
import { getAppliedMapBalancing, setLocalAppliedMapBalancing, resolveBundledMapBalancing } from '../src/shared/maps/MapBalancingBundledData.js';
import { applyMapBalancingToRuntimeConfig, resetMapBalancingRuntimeState, setMapBalancingAuthoritativeOverride, setMapBalancingWorkingLayer } from '../src/core/balancing/MapBalancingRuntime.js';

const require = createRequire(import.meta.url);
const { createMapBalancingStore } = require('../electron/map-balancing-store.cjs');
const { AppliedMapBalancingService, readAppliedMapBalancingSnapshotSync } = require('../electron/settings-studio/services/AppliedMapBalancingService.cjs');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const modes = JSON.parse(readFileSync(path.join(ROOT, 'data/balancing/modes.json'), 'utf8'));
const target = { mapKey: 'maze', modePath: 'fight' };
const fixtures = new Set();
const makeEntry = (overrides = {}, identity = target) => ({
    ...identity, enabled: true,
    values: Object.fromEntries(APPLIED_MAP_BALANCING_FIELDS.map(({ key }) => [key, overrides[key] ?? modes.modes[identity.modePath].values[key]])),
});
const documentWith = (...entries) => ({ version: 1, entries });
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'curvios-applied-balancing-'));
    fixtures.add(root);
    mkdirSync(path.join(root, 'data/balancing'), { recursive: true });
    copyFileSync(path.join(ROOT, 'data/balancing/modes.json'), path.join(root, 'data/balancing/modes.json'));
    const app = { getPath: () => path.join(root, 'userdata') };
    const drafts = createMapBalancingStore({ root: ROOT, dataRoot: root, writable: true });
    const service = new AppliedMapBalancingService({ app, projectRoot: root });
    return { root, app, drafts, service };
}

test.after(() => {
    for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});
test.afterEach(() => { setLocalAppliedMapBalancing(null); resetMapBalancingRuntimeState(); });

test('applied documents reject invalid, incomplete, duplicate and unsupported values without partially applying them', () => {
    const entry = makeEntry({ speed: 24, portalsEnabled: false });
    assert.equal(validateAppliedMapBalancingDocument(documentWith(entry)).ok, true);
    assert.equal(normalizeAppliedMapBalancingDocument(documentWith(entry)).entries[0].values.portalsEnabled, false);
    const invalid = [null, {}, { version: 99, entries: [] }, documentWith(entry, entry),
        documentWith({ ...entry, mapKey: '../maze' }), documentWith({ ...entry, modePath: 'bad' }),
        documentWith({ ...entry, values: { ...entry.values, speed: 900 } }),
        documentWith({ ...entry, values: { speed: 24 } }),
        documentWith({ ...entry, values: { ...entry.values, stageDuration: 12 } }),
        documentWith({ ...entry, enabled: false })];
    for (const document of invalid) {
        assert.equal(validateAppliedMapBalancingDocument(document).ok, false);
        assert.deepEqual(normalizeAppliedMapBalancingDocument(document).entries, []);
    }
});

test('ordinary matches apply only the approved map/mode, and developer drafts remain separate', () => {
    setLocalAppliedMapBalancing(documentWith(makeEntry({ speed: 24, botCountMax: 2 })));
    setMapBalancingWorkingLayer('maze', { values: { speed: 35 } });
    const base = { session: { ...target, splitScreenVariant: 'standard', numBots: 7 }, player: { speed: 33 } };
    const active = applyMapBalancingToRuntimeConfig(base, { clampBots: true });
    assert.equal(active.player.speed, 24);
    assert.equal(active.session.numBots, 2);
    assert.equal(base.player.speed, 33);
    const otherMode = { ...base, session: { ...base.session, modePath: 'normal' } };
    const otherMap = { ...base, session: { ...base.session, mapKey: 'standard' } };
    assert.equal(applyMapBalancingToRuntimeConfig(otherMode), otherMode);
    assert.equal(applyMapBalancingToRuntimeConfig(otherMap), otherMap);
    const network = { ...base, session: { ...base.session, networkEnabled: true } };
    assert.equal(applyMapBalancingToRuntimeConfig(network), network, 'private approvals never replace host settings');
    assert.equal(resolveBundledMapBalancing(target).values.speed, 24, 'menu and match agree');
    setMapBalancingAuthoritativeOverride(true);
    assert.equal(applyMapBalancingToRuntimeConfig(base).player.speed, 35, 'F7 can still preview a new draft');
    setMapBalancingAuthoritativeOverride(false);
    assert.equal(applyMapBalancingToRuntimeConfig(base), base, 'explicit developer switch off wins');
});

test('apply saves an immutable approved snapshot both locally and for GitHub/release builds', async () => {
    const { drafts, service } = fixture();
    await drafts.saveMapLayer('maze', { values: { speed: 24 } });
    const description = await drafts.describe(target);
    const result = await service.change(description, true, service.valuesFromDescription(description));
    assert.equal(result.enabled, true);
    assert.equal(json(result.sourcePath).values.speed, 24);
    const record = json(result.localPath);
    assert.equal(record.entries[0].values.speed, 24);
    assert.deepEqual(await service.describe(description), { enabled: true, matches: true });
    await drafts.saveMapLayer('maze', { values: { speed: 28 } });
    const changed = await drafts.describe(target);
    assert.deepEqual(await service.describe(changed), { enabled: true, matches: false });
    assert.equal(json(result.localPath).entries[0].values.speed, 24);
    assert.equal(json(result.sourcePath).values.speed, 24);
    await assert.rejects(service.change(changed, true, description.fields.reduce((values, field) => ({ ...values, [field.key]: field.value }), {})), /inzwischen geändert/);
    const withdrawn = await service.change(changed, false);
    assert.deepEqual(json(withdrawn.sourcePath), { version: 1, ...target, enabled: false });
    setLocalAppliedMapBalancing(json(withdrawn.localPath));
    assert.equal(getAppliedMapBalancing(target), null);
    assert.equal(existsSync(path.join(path.dirname(withdrawn.localPath), 'balancing-backups')), true);
});

test('a failed local write restores the release snapshot and leaves the previous local values intact', async () => {
    const { app, root, drafts, service } = fixture();
    const description = await drafts.describe(target);
    const initial = await service.change(description, true, service.valuesFromDescription(description));
    const oldSource = readFileSync(initial.sourcePath, 'utf8');
    const oldLocal = readFileSync(initial.localPath, 'utf8');
    const failing = new AppliedMapBalancingService({ app, projectRoot: root, write: async (file, text) => {
        if (file === initial.localPath) throw new Error('disk write failed');
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text);
    } });
    await assert.rejects(failing.change(description, false), /disk write failed/);
    assert.equal(readFileSync(initial.sourcePath, 'utf8'), oldSource);
    assert.equal(readFileSync(initial.localPath, 'utf8'), oldLocal);
});

test('corrupt local data is never overwritten and simultaneous map approvals do not lose entries', async () => {
    const { drafts, service } = fixture();
    const descriptions = await Promise.all([drafts.describe(target), drafts.describe({ ...target, mapKey: 'standard' })]);
    await Promise.all(descriptions.map((description) => service.change(description, true, service.valuesFromDescription(description))));
    assert.equal(json(service.localPath).entries.length, 2);
    writeFileSync(service.localPath, 'broken');
    assert.notEqual(readAppliedMapBalancingSnapshotSync(service.localPath).error, null);
    await assert.rejects(service.change(descriptions[0], false));
    assert.equal(readFileSync(service.localPath, 'utf8'), 'broken');
});

test('the Settings Studio forwards the real packaged flag, so source launches can edit maps', () => {
    const source = readFileSync(path.join(ROOT, 'electron/settings-studio/main.cjs'), 'utf8');
    assert.match(source, /const settingsDataApp = Object\.freeze\(\{\s*isPackaged: app\.isPackaged/);
    const main = readFileSync(path.join(ROOT, 'electron/main.cjs'), 'utf8');
    assert.match(main, /appliedMapBalancing: readAppliedMapBalancingSnapshotSync/);
});

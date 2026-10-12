import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
    MAP_BALANCING_CONTRACT_VERSION,
    MAP_BALANCING_FIELDS,
    MAP_BALANCING_MODE_IDS,
    MAP_BALANCING_ORIGINS,
    createMapBalancingCatalog,
    describeMapBalancing,
    normalizeMapBalancingLayer,
    normalizeMapBalancingMapDocument,
    normalizeMapBalancingModesDocument,
    resetMapBalancingLayerValue,
    resolveMapBalancing,
    serializeMapBalancingMapDocument,
    setMapBalancingLayerValue,
    validateMapBalancingMapDocument,
    validateMapBalancingModesDocument,
} from '../src/shared/contracts/MapBalancingContract.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { ARCADE_RUN_SETTINGS_RANGES, createDefaultArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { MENU_DEFAULT_EDITOR_CONFIG } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { MODE_PATH_TO_PRESET_ID } from '../src/core/settings/FreshProfileSettingsOps.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODES_FILE = path.join(ROOT, 'data', 'balancing', 'modes.json');
const MAPS_DIR = path.join(ROOT, 'data', 'balancing', 'maps');

function readJson(file) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

// What a fresh profile plays with today in each mode: menu base defaults plus the mode's seed preset.
function todaysFreshValues(modePath) {
    const base = MENU_DEFAULT_EDITOR_CONFIG.baseSettings;
    const preset = MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((entry) => entry.id === MODE_PATH_TO_PRESET_ID[modePath]);
    assert.ok(preset, `preset for ${modePath}`);
    const settings = structuredClone(base);
    for (const [settingsPath, value] of Object.entries(preset.values)) {
        const [head, tail] = settingsPath.split('.');
        if (tail) settings[head] = { ...settings[head], [tail]: value };
        else settings[head] = value;
    }
    return settings;
}

function readSettingsPath(settings, settingsPath) {
    return settingsPath.split('.').reduce((node, part) => node?.[part], settings);
}

test('B0: the mode defaults file holds exactly the values a fresh profile plays with today', () => {
    const modes = normalizeMapBalancingModesDocument(readJson(MODES_FILE));
    assert.equal(modes.version, MAP_BALANCING_CONTRACT_VERSION);
    for (const modePath of Object.values(MAP_BALANCING_MODE_IDS)) {
        const today = todaysFreshValues(modePath);
        const resolved = resolveMapBalancing(createMapBalancingCatalog({ modesDocument: readJson(MODES_FILE) }), {
            modePath,
            mapKey: 'maze',
        });
        for (const field of MAP_BALANCING_FIELDS) {
            if (field.group === 'arcadeStage' && modePath !== MAP_BALANCING_MODE_IDS.ARCADE) continue;
            const expected = field.settingsPath
                ? readSettingsPath(today, field.settingsPath)
                : (field.key === 'botCountMin' ? SETTINGS_LIMITS.session.numBots.min : SETTINGS_LIMITS.session.numBots.max);
            assert.equal(resolved.values[field.key], expected, `${modePath}.${field.key}`);
            assert.equal(resolved.origins[field.key], MAP_BALANCING_ORIGINS.MODE, `${modePath}.${field.key} origin`);
        }
    }
});

test('B0: every field carries the runtime limits instead of its own copy', () => {
    const keys = MAP_BALANCING_FIELDS.map((field) => field.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(MAP_BALANCING_FIELDS.filter((field) => field.group === 'map').length, 16);
    assert.equal(MAP_BALANCING_FIELDS.filter((field) => field.group === 'arcadeStage').length, 5);
    for (const field of MAP_BALANCING_FIELDS) {
        if (field.type === 'boolean') continue;
        const gameplayKey = field.settingsPath?.startsWith('gameplay.') ? field.settingsPath.slice(9) : null;
        const arcadeKey = field.settingsPath?.startsWith('arcade.') ? field.settingsPath.slice(7) : null;
        const expected = gameplayKey
            ? SETTINGS_LIMITS.gameplay[gameplayKey]
            : (arcadeKey ? ARCADE_RUN_SETTINGS_RANGES[arcadeKey] : SETTINGS_LIMITS.session.numBots);
        assert.equal(field.limits, expected, field.key);
        assert.ok(field.step > 0, `${field.key} step`);
        assert.ok(field.label.de && field.help.de, `${field.key} text`);
    }
    const arcadeDefaults = createDefaultArcadeRunSettings();
    const modes = normalizeMapBalancingModesDocument(readJson(MODES_FILE));
    for (const field of MAP_BALANCING_FIELDS.filter((entry) => entry.group === 'arcadeStage')) {
        assert.equal(modes.modes.arcade.values[field.key], arcadeDefaults[field.settingsPath.slice(7)], field.key);
    }
});

test('B0: map and stage layers override only what they carry and report the origin', () => {
    const catalog = createMapBalancingCatalog({
        modesDocument: readJson(MODES_FILE),
        mapDocuments: [
            { version: 1, mapKey: 'maze', values: { speed: 24, portalsEnabled: false, botCountMax: 3 } },
        ],
        stageDocuments: { 'w1-s2': { values: { speed: 26, sectorCount: 3 } } },
    });
    const fight = resolveMapBalancing(catalog, { modePath: 'fight', mapKey: 'maze' });
    assert.equal(fight.values.speed, 24);
    assert.equal(fight.origins.speed, MAP_BALANCING_ORIGINS.MAP);
    assert.equal(fight.values.portalsEnabled, false);
    assert.equal(fight.values.turnSensitivity, 2.4);
    assert.equal(fight.origins.turnSensitivity, MAP_BALANCING_ORIGINS.MODE);
    assert.equal(fight.values.botCountMax, 3);
    assert.equal(fight.inherited.speed, 20, 'inherited value behind the map value');

    const stage = resolveMapBalancing(catalog, { modePath: 'arcade', mapKey: 'maze', stageId: 'w1-s2' });
    assert.equal(stage.values.speed, 26);
    assert.equal(stage.origins.speed, MAP_BALANCING_ORIGINS.STAGE);
    assert.equal(stage.inherited.speed, 24);
    assert.equal(stage.values.sectorCount, 3);

    const otherMap = resolveMapBalancing(catalog, { modePath: 'fight', mapKey: 'standard' });
    assert.equal(otherMap.values.speed, 20);
    assert.equal(otherMap.hasMapLayer, false);

    const unknownMode = resolveMapBalancing(catalog, { modePath: 'quick_action', mapKey: 'maze' });
    assert.equal(unknownMode.modePath, 'normal');
});

test('B0: the tool rows show value, origin, the map value and what a reset brings back', () => {
    const catalog = createMapBalancingCatalog({
        modesDocument: readJson(MODES_FILE),
        mapDocuments: { maze: { mapKey: 'maze', values: { speed: 24 } } },
    });
    const description = describeMapBalancing(catalog, { modePath: 'fight', mapKey: 'maze' });
    assert.equal(description.hasMapLayer, true);
    assert.equal(description.fields.length, MAP_BALANCING_FIELDS.length);
    const speed = description.fields.find((row) => row.key === 'speed');
    assert.deepEqual(
        { value: speed.value, origin: speed.origin, mapValue: speed.mapValue, inherited: speed.inherited, min: speed.min, max: speed.max },
        { value: 24, origin: 'map', mapValue: 24, inherited: 20, min: 8, max: 40 }
    );
    const turn = description.fields.find((row) => row.key === 'turnSensitivity');
    assert.deepEqual([turn.origin, turn.mapValue, turn.inherited], ['mode', null, 2.4]);
    const portals = description.fields.find((row) => row.key === 'portalsEnabled');
    assert.deepEqual([portals.type, portals.min, portals.value], ['boolean', null, true]);
    assert.equal(describeMapBalancing(null).fields.every((row) => row.value === null), true);
});

test('B0: bot range keeps min below max', () => {
    const catalog = createMapBalancingCatalog({
        modesDocument: readJson(MODES_FILE),
        mapDocuments: [{ mapKey: 'maze', values: { botCountMin: 5, botCountMax: 2 } }],
    });
    const resolved = resolveMapBalancing(catalog, { modePath: 'normal', mapKey: 'maze' });
    assert.equal(resolved.values.botCountMin, 5);
    assert.equal(resolved.values.botCountMax, 5);
    assert.deepEqual(validateMapBalancingMapDocument({ mapKey: 'maze', values: { botCountMin: 5, botCountMax: 2 } }).ok, false);
});

test('B0: normalizers accept garbage and clamp to the runtime limits', () => {
    for (const garbage of [undefined, null, [], 'abc', 42]) {
        assert.deepEqual(normalizeMapBalancingLayer(garbage), { values: {} });
        const doc = normalizeMapBalancingMapDocument(garbage);
        assert.equal(doc.version, MAP_BALANCING_CONTRACT_VERSION);
        assert.deepEqual(doc.values, {});
        const modes = normalizeMapBalancingModesDocument(garbage);
        assert.deepEqual(Object.keys(modes.modes).sort(), ['arcade', 'fight', 'normal']);
    }
    const layer = normalizeMapBalancingLayer({
        values: {
            speed: 999, trailLength: 300.7, portalsEnabled: 'yes', lockOnAngle: 'abc', unknown: 4, gapFrequency: -1,
        },
    });
    assert.equal(layer.values.speed, SETTINGS_LIMITS.gameplay.speed.max);
    assert.equal(layer.values.trailLength, 300);
    assert.equal(layer.values.gapFrequency, 0);
    assert.equal('portalsEnabled' in layer.values, false);
    assert.equal('lockOnAngle' in layer.values, false);
    assert.equal('unknown' in layer.values, false);
});

test('B0: validation rejects instead of clamping, so a save never changes a value silently', () => {
    assert.equal(validateMapBalancingMapDocument({ version: 1, mapKey: 'maze', values: { speed: 22 } }).ok, true);
    const bad = validateMapBalancingMapDocument({
        version: 1, mapKey: 'maze', values: { speed: 41, foo: 1, portalsEnabled: 1, trailLength: 300.5 },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors.length, 4);
    assert.equal(validateMapBalancingMapDocument({ values: {} }).ok, false, 'map key is required');
    assert.equal(validateMapBalancingMapDocument({ mapKey: '../x', values: {} }).ok, false, 'map key is a plain id');
    assert.equal(validateMapBalancingMapDocument({ mapKey: 'maze', values: {}, version: 99 }).ok, false);
    assert.equal(validateMapBalancingMapDocument('x').ok, false);
    assert.equal(validateMapBalancingModesDocument(readJson(MODES_FILE)).ok, true);
    const missing = structuredClone(readJson(MODES_FILE));
    delete missing.modes.fight.values.speed;
    assert.equal(validateMapBalancingModesDocument(missing).ok, false, 'mode defaults must be complete');
    assert.equal(validateMapBalancingModesDocument(null).ok, false);
});

test('B0: set and reset keep the layer minimal and serialize stably', () => {
    let layer = setMapBalancingLayerValue({ values: {} }, 'speed', 22);
    layer = setMapBalancingLayerValue(layer, 'portalsEnabled', false);
    layer = setMapBalancingLayerValue(layer, 'botCountMax', 4);
    assert.deepEqual(layer.values, { speed: 22, portalsEnabled: false, botCountMax: 4 });
    assert.throws(() => setMapBalancingLayerValue(layer, 'speed', 99), /speed/);
    assert.throws(() => setMapBalancingLayerValue(layer, 'nope', 1), /nope/);
    layer = resetMapBalancingLayerValue(layer, 'speed');
    assert.deepEqual(layer.values, { portalsEnabled: false, botCountMax: 4 });
    const text = serializeMapBalancingMapDocument('maze', layer);
    assert.ok(text.endsWith('\n'));
    assert.deepEqual(JSON.parse(text), { version: 1, mapKey: 'maze', values: { portalsEnabled: false, botCountMax: 4 } });
    // Field order, not insertion order, decides the key order in the file.
    const reordered = serializeMapBalancingMapDocument('maze', { values: { botCountMax: 4, portalsEnabled: false } });
    assert.equal(reordered, text);
});

test('B0: every committed map balancing file passes the contract', () => {
    if (!existsSync(MAPS_DIR)) return;
    for (const name of readdirSync(MAPS_DIR).filter((entry) => entry.endsWith('.json'))) {
        const document = readJson(path.join(MAPS_DIR, name));
        const result = validateMapBalancingMapDocument(document);
        assert.equal(result.ok, true, `${name}: ${result.errors.join('; ')}`);
        assert.equal(`${document.mapKey}.json`, name, `${name} is named after its map`);
    }
});

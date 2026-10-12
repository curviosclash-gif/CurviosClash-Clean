import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import {
    MAP_BALANCING_AUTHORITATIVE,
    applyMapBalancingToRuntimeConfig,
    isMapBalancingAuthoritative,
    isMapBalancingWorkingLayerDirty,
    resetMapBalancingRuntimeState,
    resolveRuntimeMapBalancing,
    setMapBalancingAuthoritativeOverride,
    setMapBalancingWorkingLayer,
} from '../src/core/balancing/MapBalancingRuntime.js';
import { applyRuntimeConfigLive } from '../src/core/runtime/RuntimeConfigLiveApply.js';
import { MENU_DEFAULT_EDITOR_CONFIG } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { MODE_PATH_TO_PRESET_ID } from '../src/core/settings/FreshProfileSettingsOps.js';

const GAMEPLAY_PATHS = [
    ['player', 'speed'], ['player', 'turnSpeed'], ['player', 'gravityStrength'], ['player', 'modelScale'],
    ['trail', 'width'], ['trail', 'maxSegments'], ['trail', 'gapDuration'], ['trail', 'gapChance'],
    ['powerup', 'maxOnField'], ['projectile', 'cooldown'], ['homing', 'lockOnAngle'],
    ['huntCombat', 'mgTrailAimRadius'], ['huntCombat', 'fightPlayerHp'], ['huntCombat', 'fightMgDamage'],
    ['gameplay', 'planarLevelCount'], ['session', 'portalsEnabled'], ['session', 'numBots'],
];

function freshSettings(modePath, overrides = {}) {
    const settings = structuredClone(MENU_DEFAULT_EDITOR_CONFIG.baseSettings);
    const preset = MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((entry) => entry.id === MODE_PATH_TO_PRESET_ID[modePath]);
    for (const [settingsPath, value] of Object.entries(preset.values)) {
        const [head, tail] = settingsPath.split('.');
        if (tail) settings[head] = { ...settings[head], [tail]: value };
        else settings[head] = value;
    }
    settings.localSettings = { modePath, sessionType: 'single' };
    settings.gameplay = { ...settings.gameplay, ...overrides };
    return settings;
}

function pick(runtimeConfig) {
    return Object.fromEntries(GAMEPLAY_PATHS.map(([section, field]) => [`${section}.${field}`, runtimeConfig[section][field]]));
}

test.afterEach(() => resetMapBalancingRuntimeState());

test('B1: the switch ships off, so the player settings stay in charge', () => {
    assert.equal(MAP_BALANCING_AUTHORITATIVE, false);
    assert.equal(isMapBalancingAuthoritative(), false);
    setMapBalancingWorkingLayer('maze', { values: { speed: 35 } });
    const config = createRuntimeConfigSnapshot({ ...freshSettings('fight', { speed: 33 }), mapKey: 'maze' });
    assert.equal(config.player.speed, 33);
});

test('B1: switched on without a map file, every mode runs with exactly the values of today', () => {
    for (const modePath of ['normal', 'fight', 'arcade']) {
        setMapBalancingAuthoritativeOverride(false);
        const before = pick(createRuntimeConfigSnapshot({ ...freshSettings(modePath), mapKey: 'maze' }));
        setMapBalancingAuthoritativeOverride(true);
        const after = pick(createRuntimeConfigSnapshot({ ...freshSettings(modePath), mapKey: 'maze' }));
        assert.deepEqual(after, before, modePath);
    }
});

test('B1: switched on, the map layer wins over the player and limits the bot count', () => {
    setMapBalancingAuthoritativeOverride(true);
    setMapBalancingWorkingLayer('maze', { values: { speed: 26, trailWidth: 1.1, portalsEnabled: false, botCountMax: 2 } });
    const settings = { ...freshSettings('fight', { speed: 39, fireRate: 1.5 }), mapKey: 'maze', numBots: 7 };
    const config = createRuntimeConfigSnapshot(settings);
    assert.equal(config.player.speed, 26);
    assert.equal(config.trail.width, 1.1);
    assert.equal(config.projectile.cooldown, 0.35, 'player fire rate is replaced by the fight mode default');
    assert.equal(config.session.portalsEnabled, false);
    assert.equal(config.session.numBots, 2);
    const other = createRuntimeConfigSnapshot({ ...settings, mapKey: 'standard' });
    assert.equal(other.player.speed, 20);
    assert.equal(other.session.numBots, 7);
});

test('B1: an arcade sector change resolves the balancing of the new map, without touching bots', () => {
    setMapBalancingAuthoritativeOverride(true);
    setMapBalancingWorkingLayer('parcours_rift', { values: { speed: 14, botCountMax: 0 } });
    const config = createRuntimeConfigSnapshot({ ...freshSettings('arcade'), mapKey: 'maze' });
    const sector = applyMapBalancingToRuntimeConfig({
        ...config,
        session: { ...config.session, mapKey: 'parcours_rift', numBots: 3 },
    });
    assert.equal(sector.player.speed, 14);
    assert.equal(sector.session.numBots, 3);
    assert.equal(config.player.speed, 18, 'the previous snapshot stays untouched');
});

test('B1: five-portal runs keep their portals and force applies while the switch is off', () => {
    setMapBalancingWorkingLayer('maze', { values: { portalsEnabled: false, speed: 31 } });
    const base = { session: { mapKey: 'maze', modePath: 'arcade', portalsEnabled: true }, arcade: { enabled: true, runType: 'five_portals' }, player: { speed: 18 } };
    assert.equal(applyMapBalancingToRuntimeConfig(base), base, 'switch off returns the same object');
    const forced = applyMapBalancingToRuntimeConfig(base, { force: true });
    assert.equal(forced.session.portalsEnabled, true);
    assert.equal(forced.player.speed, 31);
    assert.equal(applyMapBalancingToRuntimeConfig(null, { force: true }), null);
});

test('B1: working layers track whether they match the saved file', () => {
    setMapBalancingWorkingLayer('maze', { values: { speed: 22 } });
    assert.equal(isMapBalancingWorkingLayerDirty('maze'), true);
    setMapBalancingWorkingLayer('maze', { values: { speed: 22 } }, { saved: true });
    assert.equal(isMapBalancingWorkingLayerDirty('maze'), false);
    assert.equal(resolveRuntimeMapBalancing({ modePath: 'fight', mapKey: 'maze' }).origins.speed, 'map');
    assert.equal(setMapBalancingWorkingLayer('', { values: {} }), null);
    assert.equal(setMapBalancingAuthoritativeOverride('yes'), false, 'only booleans override the switch');
});

test('B1: a live runtime config swap updates session state and the entities', () => {
    const calls = [];
    const runtimeState = {
        entityManager: {
            applyLiveRuntimeConfig: (erc, config) => calls.push(['live', config.player.speed]),
            setBotDifficulty: (difficulty) => calls.push(['difficulty', difficulty]),
        },
    };
    const runtimeBundle = { runtimeState: {}, config: null };
    const config = createRuntimeConfigSnapshot({ ...freshSettings('fight'), mapKey: 'maze' });
    const next = { ...config, player: { ...config.player, speed: 27 } };
    assert.equal(applyRuntimeConfigLive(runtimeBundle, runtimeState, next), next);
    assert.deepEqual(calls, [['live', 27], ['difficulty', config.bot.activeDifficulty]]);
});

test('B1: the sector hook and the snapshot hook both go through the balancing runtime', () => {
    const facade = readFileSync(new URL('../src/core/GameRuntimeFacade.js', import.meta.url), 'utf8');
    const runtimeConfig = readFileSync(new URL('../src/core/RuntimeConfig.js', import.meta.url), 'utf8');
    assert.match(facade, /applyMapBalancingToRuntimeConfig\(\{/);
    assert.match(runtimeConfig, /applyMapBalancingToRuntimeConfig\(runtimeConfig, \{ clampBots: true \}\)/);
});

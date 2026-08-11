import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { bindArcadeRunSettings } from '../src/ui/menu/MenuArcadeRunSettingsBindings.js';
import { SETTINGS_CHANGE_KEYS, SETTINGS_CHANGE_PATHS } from '../src/ui/SettingsChangeKeys.js';
import { MATCH_SETTING_CHANGE_KEY_SET } from '../src/core/runtime/GameRuntimeSettingsKeySets.js';
import {
    ARCADE_RUN_SETTINGS_RANGES,
    createDefaultArcadeRunSettings,
} from '../src/shared/contracts/ArcadeRunSettingsContract.js';

function createControl(value) {
    const handlers = new Map();
    return {
        value: String(value),
        min: '',
        max: '',
        add(type, handler) { handlers.set(type, handler); },
        dispatch(type) { handlers.get(type)?.(); },
    };
}

test('Arcade strategy uses its injected run clock for damage timestamps', () => {
    let nowMs = 12_000;
    const strategy = new ArcadeModeStrategy({ nowMs: () => nowMs });
    const player = { hp: 100, maxHp: 100, shieldHP: 0, hasShield: false };

    strategy.applyDamage(player, 10);
    assert.equal(player.lastDamageTimestamp, 12);

    nowMs = 18_000;
    strategy.setActiveModifier('heat_stress');
    player.hp = 1;
    strategy.updateHealthRegen(player, 1);
    assert.equal(player.lastDamageTimestamp, 18);
});

test('Arcade modifier drain uses the entity damage lifecycle and eliminates exactly once', () => {
    const strategy = new ArcadeModeStrategy({ nowMs: () => 21_000 });
    strategy.setActiveModifier('heat_stress');
    const player = {
        index: 0,
        alive: true,
        hp: 1,
        maxHp: 100,
        hasShield: true,
        shieldHP: 40,
        maxShieldHp: 40,
        position: {},
    };
    const kills = [];
    const entityManager = Object.create(EntityManager.prototype);
    entityManager.gameModeStrategy = strategy;
    entityManager._killPlayer = (target, cause) => {
        kills.push(cause);
        target.alive = false;
    };
    entityManager._emitHuntDamageEvent = () => {
        throw new Error('passive modifier damage must not emit hit feedback every frame');
    };

    const result = strategy.updateHealthRegen(player, 1, entityManager);
    strategy.updateHealthRegen(player, 1, entityManager);

    assert.equal(result?.isDead, true);
    assert.equal(player.hp, 0);
    assert.equal(player.shieldHP, 40, 'passive HP drain intentionally bypasses shields');
    assert.equal(player.alive, false);
    assert.deepEqual(kills, ['HEAT_STRESS']);
});

test('Arcade boost tax uses the same lethal lifecycle without consuming shields', () => {
    const strategy = new ArcadeModeStrategy({ nowMs: () => 22_000 });
    strategy.setActiveModifier('boost_tax');
    const player = {
        index: 0,
        alive: true,
        isBoosting: true,
        hp: 1,
        maxHp: 100,
        hasShield: true,
        shieldHP: 40,
        maxShieldHp: 40,
        position: {},
    };
    const kills = [];
    const entityManager = Object.create(EntityManager.prototype);
    entityManager.gameModeStrategy = strategy;
    entityManager._killPlayer = (target, cause) => {
        kills.push(cause);
        target.alive = false;
    };

    const result = strategy.applyBoostTick(player, 1, entityManager);
    strategy.applyBoostTick(player, 1, entityManager);

    assert.equal(result?.isDead, true);
    assert.equal(player.hp, 0);
    assert.equal(player.shieldHP, 40);
    assert.deepEqual(kills, ['BOOST_TAX']);
});

test('Productive Arcade support binds the run clock to an existing strategy', () => {
    const strategy = new ArcadeModeStrategy();
    const entityManager = { gameModeStrategy: strategy, players: [] };
    const runtimeState = { entityManager };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        nowMs: () => 42_000,
    });

    support._bindGameplayCallback(runtimeState);
    const player = { hp: 100, maxHp: 100, shieldHP: 0, hasShield: false };
    strategy.applyDamage(player, 5);

    assert.equal(player.lastDamageTimestamp, 42);
});

test('Arcade combo window and multiplier controls persist through match-setting keys', () => {
    const comboWindowInput = createControl('5000');
    const comboWindowLabel = { textContent: '' };
    const maxMultiplierInput = createControl('8');
    const maxMultiplierLabel = { textContent: '' };
    const sectorCountInput = createControl('5');
    const sectorCountLabel = { textContent: '' };
    const settings = { arcade: createDefaultArcadeRunSettings() };
    const emitted = [];
    const bind = (node, type, handler) => node.add(type, handler);

    bindArcadeRunSettings({
        ui: {
            arcadeSectorCountInput: sectorCountInput,
            arcadeSectorCountLabel: sectorCountLabel,
            arcadeComboWindowInput: comboWindowInput,
            arcadeComboWindowLabel: comboWindowLabel,
            arcadeMaxMultiplierInput: maxMultiplierInput,
            arcadeMaxMultiplierLabel: maxMultiplierLabel,
        },
        settings,
        bind,
        emitSettingsChangedImmediate: (keys) => emitted.push(...keys),
        keys: SETTINGS_CHANGE_KEYS,
    });

    assert.equal(SETTINGS_CHANGE_PATHS['arcade.comboWindowMs'], SETTINGS_CHANGE_KEYS.ARCADE_COMBO_WINDOW);
    assert.equal(SETTINGS_CHANGE_PATHS['arcade.maxMultiplier'], SETTINGS_CHANGE_KEYS.ARCADE_MAX_MULTIPLIER);
    assert.equal(MATCH_SETTING_CHANGE_KEY_SET.has(SETTINGS_CHANGE_KEYS.ARCADE_COMBO_WINDOW), true);
    assert.equal(MATCH_SETTING_CHANGE_KEY_SET.has(SETTINGS_CHANGE_KEYS.ARCADE_MAX_MULTIPLIER), true);
    assert.equal(comboWindowInput.min, String(ARCADE_RUN_SETTINGS_RANGES.comboWindowMs.min));
    assert.equal(comboWindowInput.max, String(ARCADE_RUN_SETTINGS_RANGES.comboWindowMs.max));
    assert.equal(maxMultiplierInput.min, String(ARCADE_RUN_SETTINGS_RANGES.maxMultiplier.min));
    assert.equal(maxMultiplierInput.max, String(ARCADE_RUN_SETTINGS_RANGES.maxMultiplier.max));

    comboWindowInput.value = '9000';
    comboWindowInput.dispatch('input');
    maxMultiplierInput.value = '12';
    maxMultiplierInput.dispatch('input');

    assert.equal(settings.arcade.comboWindowMs, 9000);
    assert.equal(comboWindowLabel.textContent, '9.0 s');
    assert.equal(settings.arcade.maxMultiplier, 12);
    assert.equal(maxMultiplierLabel.textContent, '12x');
    assert.deepEqual(emitted, [
        SETTINGS_CHANGE_KEYS.ARCADE_COMBO_WINDOW,
        SETTINGS_CHANGE_KEYS.ARCADE_MAX_MULTIPLIER,
    ]);
});

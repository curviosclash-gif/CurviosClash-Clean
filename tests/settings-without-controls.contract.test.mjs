import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS, SETTINGS_CHANGE_PATHS } from '../src/shared/settings/SettingsChangeKeys.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { resolveSyncMethodNamesForChangeKeys } from '../src/ui/UISettingsSyncMap.js';
import { bindArcadeRunSettings, syncArcadeRunSettings } from '../src/ui/menu/MenuArcadeRunSettingsBindings.js';
import { bindBotHeuristicControls, syncBotHeuristicControls } from '../src/ui/menu/MenuBotHeuristicBindings.js';
import { bindTrailLengthControl, syncTrailLengthControl } from '../src/ui/menu/MenuTrailLengthControl.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function createHarness() {
    const handlers = new Map();
    const emitted = [];
    return {
        emitted,
        bind: (target, type, handler) => handlers.set(`${target.id}:${type}`, handler),
        fire(target, type) { handlers.get(`${target.id}:${type}`)?.(); },
        emit: (keys) => emitted.push(...keys),
    };
}

const input = (id, value = '') => ({ id, value: String(value), checked: false, min: '', max: '', step: '' });
const label = () => ({ textContent: '' });

test('trail length has a slider next to the trail width in the game rules tab', () => {
    const gameplay = html.match(/<section id="level4-section-gameplay"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(gameplay, /id="trail-width-slider"[\s\S]{0,400}id="trail-length-slider"/);
});

test('the trail length slider writes the setting and the setting fills the slider', () => {
    const harness = createHarness();
    const ui = { trailLengthSlider: input('trail-length-slider'), trailLengthLabel: label() };
    const settings = { gameplay: { trailLength: 5000 } };
    const limits = SETTINGS_LIMITS.gameplay.trailLength;
    bindTrailLengthControl({ ui, settings, bind: harness.bind, limits, emit: harness.emit, keys: SETTINGS_CHANGE_KEYS });
    ui.trailLengthSlider.value = '99999';
    harness.fire(ui.trailLengthSlider, 'input');
    assert.equal(settings.gameplay.trailLength, limits.max, 'clamped to the contract range');
    assert.deepEqual(harness.emitted, [SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_LENGTH]);

    settings.gameplay.trailLength = 3200;
    syncTrailLengthControl(ui, settings, limits);
    assert.equal(ui.trailLengthSlider.value, '3200');
    assert.equal(ui.trailLengthLabel.textContent, '3200 Segmente');
});

test('the expert area carries the arcade fine values and the bot heuristic', () => {
    const expert = html.match(/<div id="expert-unlocked-state"[\s\S]*?<!-- ======= SUBMENU: BENUTZERDEFINIERT/)?.[0] || '';
    for (const id of ['arcade-intermission-slider', 'arcade-combo-decay-slider', 'arcade-replay-hooks-toggle',
        'bot-heuristic-profile-select', 'bot-heuristic-aggression-slider', 'bot-heuristic-survival-slider']) {
        assert.match(expert, new RegExp(`id="${id}"`), id);
    }
});

test('arcade fine values write the arcade block and the block fills the controls', () => {
    const harness = createHarness();
    const ui = {
        arcadeIntermissionInput: input('arcade-intermission-slider'), arcadeIntermissionLabel: label(),
        arcadeComboDecayInput: input('arcade-combo-decay-slider'), arcadeComboDecayLabel: label(),
        arcadeReplayHooksToggle: input('arcade-replay-hooks-toggle'),
    };
    const settings = { arcade: {} };
    bindArcadeRunSettings({ ui, settings, bind: harness.bind, emitSettingsChangedImmediate: harness.emit, keys: SETTINGS_CHANGE_KEYS });
    ui.arcadeIntermissionInput.value = '4';
    harness.fire(ui.arcadeIntermissionInput, 'input');
    ui.arcadeComboDecayInput.value = '2.5';
    harness.fire(ui.arcadeComboDecayInput, 'input');
    ui.arcadeReplayHooksToggle.checked = false;
    harness.fire(ui.arcadeReplayHooksToggle, 'change');
    assert.equal(settings.arcade.intermissionSeconds, 4);
    assert.equal(settings.arcade.comboDecayPerSecond, 2.5);
    assert.equal(settings.arcade.replayHooksEnabled, false);
    assert.deepEqual(harness.emitted, [
        SETTINGS_CHANGE_KEYS.ARCADE_INTERMISSION_SECONDS,
        SETTINGS_CHANGE_KEYS.ARCADE_COMBO_DECAY,
        SETTINGS_CHANGE_KEYS.ARCADE_REPLAY_HOOKS,
    ]);

    syncArcadeRunSettings(ui, { arcade: { intermissionSeconds: 15, comboDecayPerSecond: 0.5, replayHooksEnabled: true } });
    assert.equal(ui.arcadeIntermissionInput.value, '15');
    assert.equal(ui.arcadeIntermissionLabel.textContent, '15 s');
    assert.equal(ui.arcadeComboDecayInput.value, '0.5');
    assert.equal(ui.arcadeReplayHooksToggle.checked, true);
});

test('the heuristic sliders tune the selected profile and follow a profile switch', () => {
    const harness = createHarness();
    const ui = {
        botHeuristicProfileSelect: input('bot-heuristic-profile-select', 'balanced'),
        botHeuristicAggressionSlider: input('bot-heuristic-aggression-slider'), botHeuristicAggressionLabel: label(),
        botHeuristicSurvivalSlider: input('bot-heuristic-survival-slider'), botHeuristicSurvivalLabel: label(),
    };
    const settings = { botHeuristicProfile: 'balanced', botHeuristicTuning: {} };
    bindBotHeuristicControls({ ui, settings, bind: harness.bind, emitSettingsChangedImmediate: harness.emit, keys: SETTINGS_CHANGE_KEYS });
    ui.botHeuristicAggressionSlider.value = '80';
    harness.fire(ui.botHeuristicAggressionSlider, 'input');
    assert.equal(settings.botHeuristicTuning.balanced.aggression, 80);
    assert.equal(settings.botHeuristicTuning.aggressive.aggression, 50, 'other profiles keep their values');

    ui.botHeuristicProfileSelect.value = 'aggressive';
    harness.fire(ui.botHeuristicProfileSelect, 'change');
    assert.equal(settings.botHeuristicProfile, 'aggressive');
    assert.equal(ui.botHeuristicAggressionSlider.value, '50', 'the sliders show the newly selected profile');
    assert.deepEqual(harness.emitted, [SETTINGS_CHANGE_KEYS.BOTS_HEURISTIC_TUNING, SETTINGS_CHANGE_KEYS.BOTS_HEURISTIC_PROFILE]);

    syncBotHeuristicControls(ui, { botHeuristicProfile: 'balanced', botHeuristicTuning: { balanced: { aggression: 70, survivalFocus: 20 } } });
    assert.equal(ui.botHeuristicProfileSelect.value, 'balanced');
    assert.equal(ui.botHeuristicSurvivalSlider.value, '20');
    assert.equal(ui.botHeuristicSurvivalLabel.textContent, '20');
});

test('the new change keys point at their settings and refresh the right controls', () => {
    assert.equal(SETTINGS_CHANGE_PATHS['gameplay.trailLength'], SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_LENGTH);
    assert.equal(SETTINGS_CHANGE_PATHS['arcade.intermissionSeconds'], SETTINGS_CHANGE_KEYS.ARCADE_INTERMISSION_SECONDS);
    assert.equal(SETTINGS_CHANGE_PATHS.botHeuristicProfile, SETTINGS_CHANGE_KEYS.BOTS_HEURISTIC_PROFILE);
    assert.equal(SETTINGS_CHANGE_PATHS.botHeuristicTuning, SETTINGS_CHANGE_KEYS.BOTS_HEURISTIC_TUNING);
    assert.ok(resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_LENGTH]).includes('syncGameplay'));
    assert.ok(resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.ARCADE_COMBO_DECAY]).includes('syncModes'));
    assert.ok(resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.BOTS_HEURISTIC_TUNING]).includes('syncBots'));
});

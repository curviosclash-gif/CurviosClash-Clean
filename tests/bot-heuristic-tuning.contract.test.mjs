import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BOT_HEURISTIC_PROFILE_NAMES,
    createBotHeuristicTuningSnapshot,
} from '../src/shared/contracts/BotHeuristicTuningContract.js';
import {
    HEURISTIC_PROFILES,
    resolveEffectiveHeuristicProfile,
} from '../src/entities/ai/HeuristicBotPolicyOps.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    createSettingsOverrideFieldRegistry,
    validateSettingsOverrideDraft,
    createSettingsOverrideDraft,
} from '../src/core/settings/SettingsOverrideContract.js';
import {
    applyMenuConfigPayload,
    exportMenuConfigAsJson,
} from '../src/ui/menu/MenuConfigShareOps.js';
import { applyLiveRuntimeConfig } from '../src/entities/EntityManagerLiveConfigOps.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

test('neutral heuristic tuning preserves every existing profile value exactly', () => {
    for (const profileName of BOT_HEURISTIC_PROFILE_NAMES) {
        const effective = resolveEffectiveHeuristicProfile(profileName, {
            aggression: 50,
            survivalFocus: 50,
        });
        assert.equal(effective, HEURISTIC_PROFILES[profileName]);
        assert.deepEqual(effective, HEURISTIC_PROFILES[profileName]);
    }
});

test('heuristic tuning clamps values and moves every requested field monotonically', () => {
    const clamped = createBotHeuristicTuningSnapshot({
        balanced: { aggression: 999, survivalFocus: -4 },
    });
    assert.deepEqual(clamped.balanced, { aggression: 100, survivalFocus: 0 });

    const low = resolveEffectiveHeuristicProfile('balanced', { aggression: 0, survivalFocus: 0 });
    const high = resolveEffectiveHeuristicProfile('balanced', { aggression: 100, survivalFocus: 100 });

    assert(high.attackWindow > low.attackWindow);
    assert(high.offensiveItemThresholdScale < low.offensiveItemThresholdScale);
    assert(high.boostBias > low.boostBias);
    assert(high.preferredRange < low.preferredRange);
    assert(high.strafeDistance < low.strafeDistance);
    assert(high.retreatVitality > low.retreatVitality);
    assert(high.retreatPressure < low.retreatPressure);
    assert(high.defensiveItemThresholdScale < low.defensiveItemThresholdScale);
    assert(high.safetyDistance > low.safetyDistance);
    assert.equal(high.escapeLateralBias, 0.5);
    assert.equal(low.escapeLateralBias, 0.5);
    assert.equal(high.attackCutoffBias, 0.5);
    assert.equal(low.attackCutoffBias, 0.5);
    assert.equal(high.finisherBias, 0.5);
    assert.equal(low.finisherBias, 0.5);
    assert.equal(high.openingFanoutBias, 0.5);
    assert.equal(low.openingFanoutBias, 0.5);
    assert.equal(high.opportunistBias, 0.5);
    assert.equal(low.opportunistBias, 0.5);
    assert.equal(high.openingHookBias, 0.5);
    assert.equal(low.openingHookBias, 0.5);
    assert.equal(high.trafficAvoidanceBias, 0.5);
    assert.equal(low.trafficAvoidanceBias, 0.5);
    assert.equal(high.predictiveSafetyBias, 0.75);
    assert.equal(low.predictiveSafetyBias, 0.75);
});

test('validated Hunt profile defaults retain their independent tuning', () => {
    assert.equal(HEURISTIC_PROFILES.defensive.predictiveSafetyBias, 0.85);
    assert.equal(HEURISTIC_PROFILES.defensive.openingFanoutBias, 0.6);
    assert.equal(HEURISTIC_PROFILES.balanced.predictiveSafetyBias, 0.75);
    assert.equal(HEURISTIC_PROFILES.aggressive.predictiveSafetyBias, 0.75);
    assert.equal(HEURISTIC_PROFILES.aggressive.safetyDistance, 0.22);
});

test('settings sanitizer migrates missing tuning and clamps persisted values', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    assert.equal(defaults.settingsVersion, 5);
    assert.equal(defaults.botHeuristicTuning.defensive.aggression, 50);

    const sanitized = manager.sanitizeSettings({
        settingsVersion: 5,
        botHeuristicProfile: 'aggressive',
        botHeuristicTuning: {
            defensive: { aggression: -20, survivalFocus: 130 },
        },
    });
    assert.deepEqual(sanitized.botHeuristicTuning.defensive, {
        aggression: 0,
        survivalFocus: 100,
    });
    assert.deepEqual(sanitized.botHeuristicTuning.balanced, {
        aggression: 50,
        survivalFocus: 50,
    });
    assert.equal(sanitized.botHeuristicProfile, 'aggressive');
    assert.equal(manager.saveSettings(sanitized).success, true);
    const loaded = manager.loadSettings();
    assert.deepEqual(loaded.botHeuristicTuning, sanitized.botHeuristicTuning);
    assert.equal(loaded.botHeuristicProfile, 'aggressive');
});

test('settings studio exposes six labeled base sliders with fixed 0-100 validation', () => {
    const tuningFields = createSettingsOverrideFieldRegistry().filter((field) => (
        field.path.startsWith('baseSettings.botHeuristicTuning.')
    ));
    assert.equal(tuningFields.length, 6);
    for (const field of tuningFields) {
        assert.equal(field.control, 'range');
        assert.deepEqual(field.limits, { min: 0, max: 100, step: 1, integer: true });
        assert.equal(typeof field.label.de, 'string');
        assert.equal(typeof field.label.en, 'string');
        assert.equal(typeof field.help.de, 'string');
        assert.equal(typeof field.help.en, 'string');
    }

    const draft = createSettingsOverrideDraft();
    draft.baseSettings.botHeuristicTuning.aggressive.aggression = 101;
    const result = validateSettingsOverrideDraft(draft);
    assert.equal(result.valid, false);
    assert(result.errors.some((error) => (
        error.path === 'baseSettings.botHeuristicTuning.aggressive.aggression'
        && error.code === 'FIELD_NUMBER_ABOVE_MAX'
    )));
});

test('config share roundtrip carries normalized heuristic tuning', () => {
    const settings = {
        botHeuristicProfile: 'defensive',
        botHeuristicTuning: {
            defensive: { aggression: 12, survivalFocus: 88 },
            balanced: { aggression: 34, survivalFocus: 66 },
            aggressive: { aggression: 150, survivalFocus: -10 },
        },
    };
    const exported = JSON.parse(exportMenuConfigAsJson(settings));
    assert.equal(exported.payload.botHeuristicProfile, 'defensive');
    assert.deepEqual(exported.payload.botHeuristicTuning.aggressive, {
        aggression: 100,
        survivalFocus: 0,
    });

    const imported = {};
    assert.equal(applyMenuConfigPayload(imported, exported.payload), true);
    assert.deepEqual(imported.botHeuristicTuning, exported.payload.botHeuristicTuning);
    assert.equal(imported.botHeuristicProfile, 'defensive');
});

test('runtime resolves tuning once at policy creation and on live apply', () => {
    const runtimeConfig = createRuntimeConfigSnapshot({
        botHeuristicProfile: 'aggressive',
        botHeuristicTuning: {
            aggressive: { aggression: 100, survivalFocus: 0 },
        },
    });
    assert.deepEqual(runtimeConfig.bot.heuristicTuning.aggressive, {
        aggression: 100,
        survivalFocus: 0,
    });

    const policy = new HeuristicBotPolicy({ runtimeConfig });
    assert.equal(policy.profileName, 'aggressive');
    assert.notEqual(policy.profile, HEURISTIC_PROFILES.aggressive);
    const initialProfile = policy.profile;
    const runtimeContext = { observation: null, runtimeConfig };
    policy._syncRuntimeSettings(runtimeContext);
    policy._syncRuntimeSettings(runtimeContext);
    assert.equal(policy.profile, initialProfile);

    const livePolicy = new HeuristicBotPolicy({ profile: 'balanced' });
    const manager = {
        entityRuntimeConfig: { PLAYER: {}, POWERUP: { TYPES: {} }, HUNT: {} },
        runtime: null,
        _runtimeContext: null,
        bots: [{ ai: livePolicy }, { ai: {} }],
        players: [],
    };
    applyLiveRuntimeConfig(manager, manager.entityRuntimeConfig, runtimeConfig);
    assert.equal(livePolicy.profileName, 'aggressive');
    assert.notEqual(livePolicy.profile, HEURISTIC_PROFILES.aggressive);
    assert.equal(livePolicy.getDecisionSnapshot().profile, 'aggressive');
});

import { DEFAULT_VEHICLE_ID } from '../../shared/contracts/GameplayConfigContract.js';
import { deepClone } from './SettingsDomainUtils.js';

export const SETTINGS_VERSION_MIGRATION_IDS = Object.freeze({
    V0_TO_V1: 'settings.v0-to-v1',
    V1_TO_V2: 'settings.v1-to-v2',
    V2_TO_V3: 'settings.v2-to-v3',
    V3_TO_V4: 'settings.v3-to-v4',
    V4_TO_V5: 'settings.v4-to-v5',
});

function ensureLocalSettings(settings) {
    if (!settings.localSettings || typeof settings.localSettings !== 'object' || Array.isArray(settings.localSettings)) {
        settings.localSettings = {};
    }
    return settings.localSettings;
}

function migrateV0ToV1(settings, defaults) {
    const localSettings = ensureLocalSettings(settings);
    if (!localSettings.sessionType) {
        localSettings.sessionType = settings.mode === '2p'
            ? 'splitscreen'
            : (settings.mode === '1p' ? 'single' : defaults?.localSettings?.sessionType || 'single');
    }
    settings.settingsVersion = 1;
    return settings;
}

function migrateV1ToV2(settings, defaults) {
    const localSettings = ensureLocalSettings(settings);
    if (!localSettings.modePath) {
        localSettings.modePath = defaults?.localSettings?.modePath || 'normal';
    }
    if (!settings.botPolicyStrategy) {
        settings.botPolicyStrategy = defaults?.botPolicyStrategy || 'auto';
    }
    settings.settingsVersion = 2;
    return settings;
}

function migrateV2ToV3(settings, defaults) {
    const localSettings = ensureLocalSettings(settings);
    localSettings.splitScreenVariant = 'standard';
    if (!localSettings.fourPlayerPlanar || typeof localSettings.fourPlayerPlanar !== 'object') {
        localSettings.fourPlayerPlanar = deepClone(defaults?.localSettings?.fourPlayerPlanar || {
            mode: 'classic',
            mapKey: 'standard',
            vehicleId: DEFAULT_VEHICLE_ID,
            botCount: 0,
        });
    }
    settings.settingsVersion = 3;
    return settings;
}

function migrateV3ToV4(settings, defaults) {
    if (!settings.gameplay || typeof settings.gameplay !== 'object' || Array.isArray(settings.gameplay)) {
        settings.gameplay = {};
    }
    settings.gameplay.speed ??= defaults?.gameplay?.speed ?? 30;
    settings.gameplay.turnSensitivity ??= defaults?.gameplay?.turnSensitivity ?? 3;
    settings.gameplay.itemAmount ??= defaults?.gameplay?.itemAmount ?? 60;
    settings.numBots ??= defaults?.numBots ?? 8;
    settings.autoRoll ??= defaults?.autoRoll ?? false;
    settings.settingsVersion = 4;
    return settings;
}

function migrateV4ToV5(settings, defaults) {
    settings.botHeuristicTuning = deepClone(defaults?.botHeuristicTuning || {});
    settings.settingsVersion = 5;
    return settings;
}

const SETTINGS_VERSION_MIGRATIONS = Object.freeze([
    Object.freeze({
        id: SETTINGS_VERSION_MIGRATION_IDS.V0_TO_V1,
        fromVersion: 0,
        toVersion: 1,
        migrate: migrateV0ToV1,
    }),
    Object.freeze({
        id: SETTINGS_VERSION_MIGRATION_IDS.V1_TO_V2,
        fromVersion: 1,
        toVersion: 2,
        migrate: migrateV1ToV2,
    }),
    Object.freeze({
        id: SETTINGS_VERSION_MIGRATION_IDS.V2_TO_V3,
        fromVersion: 2,
        toVersion: 3,
        migrate: migrateV2ToV3,
    }),
    Object.freeze({
        id: SETTINGS_VERSION_MIGRATION_IDS.V3_TO_V4,
        fromVersion: 3,
        toVersion: 4,
        migrate: migrateV3ToV4,
    }),
    Object.freeze({
        id: SETTINGS_VERSION_MIGRATION_IDS.V4_TO_V5,
        fromVersion: 4,
        toVersion: 5,
        migrate: migrateV4ToV5,
    }),
]);

function normalizeVersion(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

export function migrateSettingsSnapshot(source, defaults) {
    const settings = deepClone(source && typeof source === 'object' ? source : {});
    const fromVersion = normalizeVersion(settings.settingsVersion, 0);
    const targetVersion = normalizeVersion(defaults?.settingsVersion, fromVersion);
    const appliedMigrations = [];
    let reachedVersion = fromVersion;

    while (reachedVersion < targetVersion) {
        const migration = SETTINGS_VERSION_MIGRATIONS.find((entry) => entry.fromVersion === reachedVersion);
        if (!migration || migration.toVersion > targetVersion) break;
        migration.migrate(settings, defaults);
        reachedVersion = migration.toVersion;
        appliedMigrations.push(migration.id);
    }

    return {
        settings,
        fromVersion,
        targetVersion,
        reachedVersion,
        appliedMigrations,
    };
}

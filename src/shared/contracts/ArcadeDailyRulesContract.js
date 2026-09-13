import { computeDailySeed } from '../utils/ArcadeUtils.js';
import { createDefaultArcadeRunSettings } from './ArcadeRunSettingsContract.js';

export const ARCADE_DAILY_RULES_VERSION = 'arcade-daily.v1';
export const ARCADE_DAILY_VEHICLE_ID = 'ship5';

// A runtime projection: never write these overrides back to personal settings.
export function resolveArcadeDailySettings(settings, date = null) {
    if (settings?.localSettings?.modePath !== 'arcade' || settings?.arcade?.dailyChallenge !== true) return settings;
    return {
        ...settings,
        mode: '1p', gameMode: 'ARCADE', mapKey: 'standard', numBots: 2, maxPlayers: 10, winsNeeded: 1,
        autoRoll: true, portalsEnabled: true, botDifficulty: 'NORMAL', botPolicyStrategy: 'heuristic', botHeuristicProfile: 'balanced',
        botBridge: { enabled: false }, hunt: {},
        vehicles: { PLAYER_1: ARCADE_DAILY_VEHICLE_ID, PLAYER_2: ARCADE_DAILY_VEHICLE_ID },
        gameplay: { nextCheckpointGlowIntensity: settings.gameplay?.nextCheckpointGlowIntensity },
        localSettings: {
            ...settings.localSettings, sessionType: 'single',
            startSetup: { ...settings.localSettings?.startSetup, arcadeGhostDuelMode: 'off', arcadeGhostTrailCollisionEnabled: false },
        },
        arcade: { ...createDefaultArcadeRunSettings(), dailyChallenge: true, seed: computeDailySeed(date) },
    };
}

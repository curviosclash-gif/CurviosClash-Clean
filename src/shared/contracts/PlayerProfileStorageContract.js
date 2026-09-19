import {
    ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
} from './ArcadeVehicleProfileContract.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY, LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY } from './ArcadeRunSettingsContract.js';
import {
    ARCADE_LAST_RUN_STORAGE_KEY,
    ARCADE_SEED_STORAGE_KEY,
} from './ArcadeMenuPersistenceContract.js';
import { HANGAR_BUILD_STORAGE_KEYS } from './HangarModeContract.js';
import { LOBBY_NAME_STORAGE_KEY } from './LobbyNameStorageContract.js';

export const PLAYER_PROFILE_REGISTRY_STORAGE_KEY = 'cuviosclash.player-profiles.v1';
export const PLAYER_PROFILE_MIGRATION_STORAGE_KEY = 'cuviosclash.player-profile-migration.v1';
export const PLAYER_PROFILE_STORAGE_NAMESPACE = 'cuviosclash.player';

export const PLAYER_PROFILE_RECORD_KINDS = Object.freeze({
    ARCADE_VEHICLE_PROFILE: 'arcadeVehicleProfile',
    LEGACY_ARCADE_VEHICLE_PROFILE: 'legacyArcadeVehicleProfile',
    ARCADE_RUN_PROFILE: 'arcadeRunProfile',
    LEGACY_ARCADE_RUN_PROFILE: 'legacyArcadeRunProfile',
    ARCADE_SEED: 'arcadeSeed',
    ARCADE_LAST_RUN: 'arcadeLastRun',
    PARCOURS_LEADERBOARD: 'parcoursLeaderboard',
    GHOST_LIBRARY: 'ghostLibrary',
    ARCADE_HANGAR_BUILDS: 'arcadeHangarBuilds',
    FIGHT_HANGAR_BUILDS: 'fightHangarBuilds',
    ARCADE_HANGAR_DRAFTS: 'arcadeHangarDrafts',
    FIGHT_HANGAR_DRAFTS: 'fightHangarDrafts',
    ARCADE_LOADOUT_PRESETS: 'arcadeLoadoutPresets',
    LOBBY_NAME: 'lobbyName',
});

// The name a player last used in a multiplayer lobby; each player profile keeps its own.
export { LOBBY_NAME_STORAGE_KEY };

const RECORD_DEFINITIONS = Object.freeze([
    { kind: PLAYER_PROFILE_RECORD_KINDS.LEGACY_ARCADE_RUN_PROFILE, legacyKey: LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY, suffix: 'arcade-run-profile.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.LEGACY_ARCADE_VEHICLE_PROFILE, legacyKey: ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY, suffix: 'arcade-vehicle-profile.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.ARCADE_VEHICLE_PROFILE, legacyKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY, suffix: 'arcade-vehicle-profile.v2' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.ARCADE_RUN_PROFILE, legacyKey: ARCADE_RUN_PROFILE_STORAGE_KEY, suffix: 'arcade-run-profile.v3' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.ARCADE_SEED, legacyKey: ARCADE_SEED_STORAGE_KEY, suffix: 'arcade.seed.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.ARCADE_LAST_RUN, legacyKey: ARCADE_LAST_RUN_STORAGE_KEY, suffix: 'arcade.last_run.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.PARCOURS_LEADERBOARD, legacyKey: 'cuviosclash.parcours-leaderboard.v1', suffix: 'parcours-leaderboard.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.GHOST_LIBRARY, legacyKey: 'cuviosclash.arcade-ghost-library.v1', suffix: 'arcade-ghost-library.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.ARCADE_HANGAR_BUILDS, legacyKey: HANGAR_BUILD_STORAGE_KEYS.arcade, suffix: 'hangar.arcade-builds.v2' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.FIGHT_HANGAR_BUILDS, legacyKey: HANGAR_BUILD_STORAGE_KEYS.fight, suffix: 'hangar.fight-builds.v2' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.ARCADE_HANGAR_DRAFTS, legacyKey: 'curviosclash.hangar.arcade-drafts.v1', suffix: 'hangar.arcade-drafts.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.FIGHT_HANGAR_DRAFTS, legacyKey: 'curviosclash.hangar.fight-drafts.v1', suffix: 'hangar.fight-drafts.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.ARCADE_LOADOUT_PRESETS, legacyKey: 'cuviosclash.arcade-vehicle-loadouts.v1', suffix: 'arcade-vehicle-loadouts.v1' },
    { kind: PLAYER_PROFILE_RECORD_KINDS.LOBBY_NAME, legacyKey: LOBBY_NAME_STORAGE_KEY, suffix: 'lobby-name.v1' },
]);

const DEFINITION_BY_LEGACY_KEY = new Map(RECORD_DEFINITIONS.map((entry) => [entry.legacyKey, entry]));
const DEFINITION_BY_KIND = new Map(RECORD_DEFINITIONS.map((entry) => [entry.kind, entry]));

export function listPlayerProfileRecordDefinitions() {
    return RECORD_DEFINITIONS.map((entry) => ({ ...entry }));
}

export function getPlayerProfileRecordDefinitionByKind(kind) {
    const entry = DEFINITION_BY_KIND.get(String(kind || ''));
    return entry ? { ...entry } : null;
}

export function resolvePlayerScopedStorageKey(profileId, legacyStorageKey) {
    const id = String(profileId || '').trim();
    const entry = DEFINITION_BY_LEGACY_KEY.get(String(legacyStorageKey || '').trim());
    return id && entry ? `${PLAYER_PROFILE_STORAGE_NAMESPACE}.${id}.${entry.suffix}` : null;
}

export function resolvePlayerScopedStorageKeyByKind(profileId, kind) {
    const entry = DEFINITION_BY_KIND.get(String(kind || ''));
    const id = String(profileId || '').trim();
    return id && entry ? `${PLAYER_PROFILE_STORAGE_NAMESPACE}.${id}.${entry.suffix}` : null;
}

export function isPlayerProfileRecordStorageKey(storageKey) {
    return DEFINITION_BY_LEGACY_KEY.has(String(storageKey || '').trim());
}

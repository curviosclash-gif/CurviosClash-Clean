import {
    FOUR_PLAYER_PLANAR_PLAYER_COLORS,
    SPLIT_SCREEN_VARIANTS,
    THREE_PLAYER_SPLIT_PLAYER_COLORS,
} from '../../four-player-planar/FourPlayerPlanarContract.js';
import { isArenaWavesRunType } from '../../shared/contracts/ArenaWavesContract.js';
import { isWeaponRaceRunType } from '../../shared/contracts/WeaponRaceContract.js';
import { invalidatePrewarmedArenaSession } from './MatchSessionPrewarmStore.js';
import { normalizeTeamHuntSettings, resolveTeamRoster } from '../../shared/contracts/TeamHuntContract.js';
import { normalizeTeamId } from '../../shared/contracts/TeamCombatContract.js';

function resolveLocalSplitScreenPlayerColor(splitScreenVariant, index) {
    if (splitScreenVariant === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR) return FOUR_PLAYER_PLANAR_PLAYER_COLORS[index];
    if (splitScreenVariant === SPLIT_SCREEN_VARIANTS.THREE_PLAYER) return THREE_PLAYER_SPLIT_PLAYER_COLORS[index];
    return undefined;
}

export function disposeMatchSessionSystems(renderer, currentSession, options = {}) {
    currentSession?.endlessParcoursRuntime?.dispose?.();
    if (currentSession?.entityManager) {
        currentSession.entityManager.dispose();
    }
    if (currentSession?.powerupManager) {
        currentSession.powerupManager.dispose();
    }
    if (currentSession?.arena?.dispose) {
        currentSession.arena.dispose();
    }
    if (currentSession?.particles?.dispose) {
        currentSession.particles.dispose();
    }
    if (options.clearScene !== false) {
        renderer.clearMatchScene();
        invalidatePrewarmedArenaSession();
    }
}

export function buildHumanConfigs(settings, runtimeConfig = null) {
    const runtimeVehicles = runtimeConfig?.player?.vehicles || null;
    const fightLoadouts = runtimeConfig?.session?.modePath === 'fight'
        || isArenaWavesRunType(runtimeConfig?.arcade?.runType)
        || isWeaponRaceRunType(runtimeConfig?.arcade?.runType)
        ? runtimeConfig?.player?.fightLoadouts || null
        : null;
    const session = runtimeConfig?.session || null;
    const configuredHumanCount = Math.max(1, Number(session?.numHumans) || 2);
    // A network match simulates one human entity per slot while numHumans stays
    // the local count, so the slot list is the real length of the human roster.
    const humanEntityCount = Math.max(0, Number(session?.humanEntityCount) || 0);
    const totalHumanCount = Math.max(configuredHumanCount, humanEntityCount);
    const fallbackVehicleId = runtimeVehicles?.PLAYER_1 || settings?.vehicles?.PLAYER_1;
    // Smooth steering is opt-in; only an explicit true switches the ramp on, and only for
    // the slots this machine steers: a guest's own setting must not follow the host's local
    // settings, and vice versa. Remote slots keep the default.
    const smoothSteering = settings?.localSettings?.smoothSteering === true;
    const localPlayerIndex = Math.max(0, Number(session?.localPlayerIndex) || 0);
    const localHumanCount = Math.max(1, Number(session?.localHumanCount) || configuredHumanCount);
    const isLocalSlot = (index) => index >= localPlayerIndex && index < localPlayerIndex + localHumanCount;
    // A network match names each human after the lobby name of its slot.
    const slotNames = new Map((Array.isArray(session?.networkPlayerSlots) ? session.networkPlayerSlots : [])
        .filter((slot) => typeof slot?.displayName === 'string' && slot.displayName.trim())
        .map((slot) => [Number(slot.playerIndex), slot.displayName.trim()]));
    const slotTeams = new Map((Array.isArray(session?.networkPlayerSlots) ? session.networkPlayerSlots : [])
        .map((slot) => [Number(slot.playerIndex), normalizeTeamId(slot?.teamId)])
        .filter(([, teamId]) => teamId));
    const withName = (index, config) => (slotNames.has(index) ? { ...config, name: slotNames.get(index) } : config);
    const configs = [];
    const teamSettings = normalizeTeamHuntSettings(runtimeConfig?.hunt || settings?.hunt);
    const teamRoster = teamSettings.enabled
        ? resolveTeamRoster({ humanCount: totalHumanCount, teamSize: teamSettings.teamSize })
        : null;
    for (let index = 0; index < configuredHumanCount; index += 1) {
        const slot = `PLAYER_${index + 1}`;
        configs.push(withName(index, {
            invertPitch: !!settings?.invertPitch?.[slot],
            smoothSteering: isLocalSlot(index) && smoothSteering,
            cockpitCamera: true,
            vehicleId: runtimeVehicles?.[slot] || settings?.vehicles?.[slot] || fallbackVehicleId,
            fightLoadout: fightLoadouts?.[slot] || fightLoadouts?.PLAYER_1 || null,
            color: resolveLocalSplitScreenPlayerColor(runtimeConfig?.session?.splitScreenVariant, index),
            teamId: teamRoster ? (slotTeams.get(index) || teamRoster.teamIds[index] || null) : null,
        }));
    }
    // Slots beyond the local count keep the sparse shape they had before (the
    // entity setup falls back per field); only the steering preference is filled in.
    for (let index = configuredHumanCount; index < totalHumanCount; index += 1) {
        configs.push(withName(index, {
            smoothSteering: isLocalSlot(index) && smoothSteering,
            teamId: teamRoster ? (slotTeams.get(index) || teamRoster.teamIds[index] || null) : null,
        }));
    }
    return configs;
}

export function buildEntityManagerSetupOptions(settings, runtimeConfig = null, entityRuntimeConfig = null, setupOptions = null) {
    const runtimeBotConfig = runtimeConfig?.bot || null;
    const setupPlanarMode = runtimeConfig?.gameplay?.planarMode ?? settings?.gameplay?.planarMode;
    const humanConfigs = buildHumanConfigs(settings, runtimeConfig);
    const teamSettings = normalizeTeamHuntSettings(runtimeConfig?.hunt || settings?.hunt);
    const teamRoster = teamSettings.enabled
        ? resolveTeamRoster({ humanCount: humanConfigs.length, teamSize: teamSettings.teamSize })
        : null;
    return {
        modelScale: runtimeConfig?.player?.modelScale ?? settings?.gameplay?.planeScale,
        botDifficulty: runtimeConfig?.bot?.activeDifficulty || settings?.botDifficulty || 'NORMAL',
        botPolicyType: runtimeBotConfig?.policyType || null,
        activeGameMode: runtimeConfig?.session?.activeGameMode || settings?.gameMode || null,
        planarMode: typeof setupPlanarMode === 'boolean' ? setupPlanarMode : undefined,
        runtimeConfig,
        entityRuntimeConfig,
        isDesktopRuntime: setupOptions?.isDesktopRuntime,
        humanConfigs,
        botTeamIds: teamRoster?.teamIds.slice(humanConfigs.length) || [],
        teamBotDifficulty: teamSettings.botDifficulty,
    };
}

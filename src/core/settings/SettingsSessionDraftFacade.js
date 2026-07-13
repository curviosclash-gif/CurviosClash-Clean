import {
    ensureMenuContractState,
    MENU_SESSION_TYPES,
    normalizeSessionType,
    SETTINGS_CHANGE_KEYS,
} from '../../composition/core-ui/CoreSettingsPorts.js';

const SESSION_DRAFT_CHANGED_KEYS = Object.freeze([
    SETTINGS_CHANGE_KEYS.SESSION_TYPE,
    SETTINGS_CHANGE_KEYS.MODE,
    SETTINGS_CHANGE_KEYS.MODE_PATH,
    SETTINGS_CHANGE_KEYS.MULTIPLAYER_TRANSPORT,
    SETTINGS_CHANGE_KEYS.LOCAL_THEME_MODE,
    SETTINGS_CHANGE_KEYS.LOCAL_SHADOW_QUALITY,
    SETTINGS_CHANGE_KEYS.ARCADE_GHOST_DUEL_MODE,
    SETTINGS_CHANGE_KEYS.ARCADE_GHOST_TRAIL_COLLISION_ENABLED,
    SETTINGS_CHANGE_KEYS.MAP_KEY,
    SETTINGS_CHANGE_KEYS.GAME_MODE,
    SETTINGS_CHANGE_KEYS.BOTS_COUNT,
    SETTINGS_CHANGE_KEYS.BOTS_DIFFICULTY,
    SETTINGS_CHANGE_KEYS.RULES_WINS_NEEDED,
    SETTINGS_CHANGE_KEYS.RULES_AUTO_ROLL,
    SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED,
    SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
    SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
    SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_TURN_SENSITIVITY,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANE_SCALE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_WIDTH,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_SIZE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_FREQUENCY,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_ITEM_AMOUNT,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_FIRE_RATE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_LOCK_ON_ANGLE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_NEXT_CHECKPOINT_GLOW_INTENSITY,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_MG_TRAIL_AIM_RADIUS,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_PLAYER_HP,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_MG_DAMAGE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_MODE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PORTAL_COUNT,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_LEVEL_COUNT,
    SETTINGS_CHANGE_KEYS.RECORDING_PROFILE,
    SETTINGS_CHANGE_KEYS.RECORDING_HUD_MODE,
    SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_NORMAL,
    SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_REDUCE_MOTION,
    SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_ENABLED,
    SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_INTENSITY,
    SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_ENABLED,
    SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_INTENSITY,
]);

export function createSettingsSessionDraftFacade(options = {}) {
    const menuDraftStore = options.menuDraftStore;
    const getNowIso = typeof options.getNowIso === 'function'
        ? options.getNowIso
        : () => new Date().toISOString();

    function saveSessionDraft(settings, sessionType) {
        ensureMenuContractState(settings);
        const normalizedSessionType = normalizeSessionType(
            sessionType,
            settings?.localSettings?.sessionType || MENU_SESSION_TYPES.SINGLE
        );
        const result = menuDraftStore.saveDraft(normalizedSessionType, settings);
        if (result.success) {
            if (!settings.localSettings.draftStateBySessionType || typeof settings.localSettings.draftStateBySessionType !== 'object') {
                settings.localSettings.draftStateBySessionType = {};
            }
            settings.localSettings.draftStateBySessionType[normalizedSessionType] = {
                updatedAt: getNowIso(),
                mapKey: String(settings.mapKey || ''),
                vehicleP1: String(settings?.vehicles?.PLAYER_1 || ''),
                vehicleP2: String(settings?.vehicles?.PLAYER_2 || ''),
            };
        }
        return {
            ...result,
            reason: result.success ? 'saved' : String(result.reason || 'storage_failed'),
            changedKeys: [],
            metadata: {
                sessionType: normalizedSessionType,
                persistedDraftState: result.success,
            },
        };
    }

    function applySessionDraft(settings, sessionType) {
        ensureMenuContractState(settings);
        const normalizedSessionType = normalizeSessionType(
            sessionType,
            settings?.localSettings?.sessionType || MENU_SESSION_TYPES.SINGLE
        );
        const draftResult = menuDraftStore.applyDraft(settings, normalizedSessionType);
        return {
            ...draftResult,
            sessionType: normalizedSessionType,
            changedKeys: draftResult.success ? SESSION_DRAFT_CHANGED_KEYS.slice() : [],
            metadata: {
                sessionType: normalizedSessionType,
            },
        };
    }

    function switchSessionType(settings, nextSessionType) {
        ensureMenuContractState(settings);
        const currentSessionType = normalizeSessionType(settings?.localSettings?.sessionType, MENU_SESSION_TYPES.SINGLE);
        const targetSessionType = normalizeSessionType(nextSessionType, currentSessionType);
        if (targetSessionType === currentSessionType) {
            return {
                success: true,
                reason: 'unchanged',
                changed: false,
                targetSessionType,
                loadedDraft: false,
                changedKeys: [],
                metadata: {
                    sessionType: targetSessionType,
                    savedCurrentDraft: false,
                },
            };
        }

        const saveResult = saveSessionDraft(settings, currentSessionType);
        const draftResult = applySessionDraft(settings, targetSessionType);
        settings.localSettings.sessionType = targetSessionType;
        settings.mode = targetSessionType === MENU_SESSION_TYPES.SPLITSCREEN ? '2p' : '1p';

        return {
            success: true,
            reason: draftResult.success ? 'draft_applied' : 'session_type_changed_without_draft',
            changed: true,
            targetSessionType,
            loadedDraft: draftResult.success,
            draftResult,
            changedKeys: draftResult.success
                ? draftResult.changedKeys.slice()
                : [
                    SETTINGS_CHANGE_KEYS.SESSION_TYPE,
                    SETTINGS_CHANGE_KEYS.MODE,
                ],
            metadata: {
                sessionType: targetSessionType,
                savedCurrentDraft: saveResult.success,
            },
            warnings: saveResult.success ? [] : ['session_draft_save_failed'],
        };
    }

    return {
        saveSessionDraft,
        applySessionDraft,
        switchSessionType,
    };
}

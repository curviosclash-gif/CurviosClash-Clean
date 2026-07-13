import { CUSTOM_MAP_KEY } from '../../entities/MapSchema.js';
import { GAME_MODE_TYPES, resolveActiveGameMode } from '../../hunt/HuntMode.js';
import { EDITOR_VIEW_PATHS } from '../../shared/contracts/EditorPathContract.js';
import { normalizeShadowQuality } from '../../shared/contracts/ShadowQualityContract.js';
import { PLATFORM_SURFACE_FEATURE_IDS } from '../../shared/contracts/PlatformSurfacePolicyOps.js';
import { GAMEPLAY_COCKPIT_CAMERA_ENABLED } from '../../shared/contracts/CameraModeContract.js';
import { clamp } from '../../utils/MathOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS,
    normalizeMobileClassicControlSettings,
} from '../../shared/contracts/MobileClassicControlsContract.js';
import { bindMenuMultiplayerTransportButtons } from './MenuMultiplayerTransportBindings.js';
import { createRuntimeSettingsLimitsForRuntime } from '../../shared/contracts/SettingsRuntimeLimitsContract.js';
import { bindMenuExtrasButtons } from './MenuExtrasBindings.js';
import { bindArcadeGhostDuelModeSelect } from './MenuArcadeGhostDuelBindings.js';
import { bindMenuRecordingCameraControls } from './MenuRecordingCameraBindings.js';
import {
    HANGAR_SELECTION_PLAYER_SLOTS,
    writeHangarMapSelection,
    writeHangarVehicleSelection,
} from '../hangar/HangarSelectionWritebackContract.js';
export function setupMenuGameplayBindings(ctx) {
    const ui = ctx.ui;
    const settings = ctx.settings;
    const emit = ctx.emit;
    const emitSettingsChangedImmediate = ctx.emitSettingsChangedImmediate;
    const queueInputSettingsChanged = ctx.queueInputSettingsChanged;
    const eventTypes = ctx.eventTypes;
    const keys = ctx.settingsChangeKeys;
    const bind = ctx.bind;
    const gameplayConfig = resolveGameplayConfig({ config: ctx.configSource || null });
    const huntFeatureEnabled = gameplayConfig.HUNT?.ENABLED !== false;
    const runtimeLimits = createRuntimeSettingsLimitsForRuntime();
    const sessionLimits = runtimeLimits.session;
    const gameplayLimits = runtimeLimits.gameplay;
    const mgTrailAimLimits = gameplayLimits.mgTrailAimRadius;
    const fightMgDamageLimits = gameplayLimits.fightMgDamage;
    const ensureMobileControls = () => {
        if (!settings.localSettings || typeof settings.localSettings !== 'object') {
            settings.localSettings = {};
        }
        settings.localSettings.mobileControls = normalizeMobileClassicControlSettings(
            settings.localSettings.mobileControls
        );
        return settings.localSettings.mobileControls;
    };
    const updateMobileControls = (patch) => {
        const current = ensureMobileControls();
        settings.localSettings.mobileControls = normalizeMobileClassicControlSettings({
            ...current,
            ...patch,
        });
        return settings.localSettings.mobileControls;
    };
    settings.cockpitCamera = { ...(settings.cockpitCamera && typeof settings.cockpitCamera === 'object' ? settings.cockpitCamera : {}), PLAYER_1: GAMEPLAY_COCKPIT_CAMERA_ENABLED, PLAYER_2: GAMEPLAY_COCKPIT_CAMERA_ENABLED };
    [ui.cockpitCamP1, ui.cockpitCamP2].forEach((toggle) => { if (toggle) { toggle.checked = GAMEPLAY_COCKPIT_CAMERA_ENABLED; toggle.disabled = true; } });
    const resolveCurrentHangarModePath = () => String(settings?.localSettings?.modePath || 'normal').trim().toLowerCase() || 'normal';
    const isFightModePathActive = () => resolveCurrentHangarModePath() === 'fight';
    const applyPlanarMode = (enabled) => {
        if (!settings.gameplay) settings.gameplay = {};
        settings.gameplay.planarMode = !!enabled;
        const changedKeys = [keys.GAMEPLAY_PLANAR_MODE];
        if (settings.gameplay.planarMode && (settings.gameplay.portalCount || 0) === 0) {
            settings.gameplay.portalCount = 4;
            changedKeys.push(keys.GAMEPLAY_PORTAL_COUNT);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: 'Ebenen-Modus: 4 Portale aktiviert',
            });
        }
        emitSettingsChangedImmediate(changedKeys);
    };

    if (Array.isArray(ui.sessionButtons)) {
        ui.sessionButtons.forEach((button) => {
            bind(button, 'click', () => {
                const sessionType = String(button?.dataset?.sessionType || '').trim().toLowerCase();
                if (!sessionType) return;
                emit(eventTypes.SESSION_TYPE_CHANGE, { sessionType });
            });
        });
    }

    bindMenuMultiplayerTransportButtons({
        ui,
        settings,
        bind,
        emit,
        emitSettingsChangedImmediate,
        eventTypes,
        keys,
    });

    if (Array.isArray(ui.modePathButtons)) {
        ui.modePathButtons.forEach((button) => {
            bind(button, 'click', () => {
                if (button.disabled) return;
                const modePath = String(button?.dataset?.modePath || '').trim().toLowerCase();
                if (!modePath) return;
                emit(eventTypes.MODE_PATH_CHANGE, { modePath });
            });
        });
    }

    if (ui.quickStartLastButton) {
        bind(ui.quickStartLastButton, 'click', () => {
            emit(eventTypes.QUICKSTART_LAST_START);
        });
    }

    if (ui.quickStartEventPlaylistButton) {
        bind(ui.quickStartEventPlaylistButton, 'click', () => {
            emit(eventTypes.QUICKSTART_EVENT_PLAYLIST_START);
        });
    }

    if (ui.quickStartRandomButton) {
        bind(ui.quickStartRandomButton, 'click', () => {
            emit(eventTypes.QUICKSTART_RANDOM_START);
        });
    }

    if (Array.isArray(ui.modeButtons)) {
        ui.modeButtons.forEach((btn) => {
            bind(btn, 'click', () => {
                settings.mode = btn.dataset.mode === '2p' ? '2p' : '1p';
                emitSettingsChangedImmediate([keys.MODE]);
            });
        });
    }

    if (Array.isArray(ui.gameModeButtons)) {
        ui.gameModeButtons.forEach((btn) => {
            bind(btn, 'click', () => {
                const requested = String(btn.dataset.gameMode || GAME_MODE_TYPES.CLASSIC);
                const changedKeys = [keys.GAME_MODE];
                settings.gameMode = resolveActiveGameMode(requested, huntFeatureEnabled);
                if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                    settings.localSettings = {};
                }
                settings.localSettings.modePath = settings.gameMode === GAME_MODE_TYPES.HUNT ? 'fight' : 'normal';
                changedKeys.push(keys.MODE_PATH);
                if (settings.gameMode !== GAME_MODE_TYPES.HUNT) {
                    if (!settings.hunt) settings.hunt = {};
                    settings.hunt.respawnEnabled = false;
                    changedKeys.push(keys.HUNT_RESPAWN_ENABLED);
                }
                emitSettingsChangedImmediate(changedKeys);
            });
        });
    }

    if (Array.isArray(ui.dimensionModeButtons)) {
        ui.dimensionModeButtons.forEach((btn) => {
            bind(btn, 'click', () => {
                const planarRaw = String(btn?.dataset?.planarMode || '').trim().toLowerCase();
                const planarEnabled = planarRaw === 'true' || planarRaw === '1' || planarRaw === 'yes';
                applyPlanarMode(planarEnabled);
            });
        });
    }

    if (ui.huntRespawnToggle) {
        bind(ui.huntRespawnToggle, 'change', () => {
            if (!settings.hunt) settings.hunt = {};
            settings.hunt.respawnEnabled = !!ui.huntRespawnToggle.checked;
            emitSettingsChangedImmediate([keys.HUNT_RESPAWN_ENABLED]);
        });
    }

    if (ui.vehicleSelectP1) {
        bind(ui.vehicleSelectP1, 'change', (e) => {
            const writeback = writeHangarVehicleSelection(
                settings,
                HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1,
                e?.target?.value,
                'ship5',
                { modePath: resolveCurrentHangarModePath() }
            );
            if (writeback.changed) {
                emitSettingsChangedImmediate([keys.VEHICLES_PLAYER_1]);
            }
        });
    }
    if (ui.vehicleSelectP2) {
        bind(ui.vehicleSelectP2, 'change', (e) => {
            const writeback = writeHangarVehicleSelection(
                settings,
                HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2,
                e?.target?.value,
                'ship5',
                { modePath: resolveCurrentHangarModePath() }
            );
            if (writeback.changed) {
                emitSettingsChangedImmediate([keys.VEHICLES_PLAYER_2]);
            }
        });
    }

    bind(ui.mapSelect, 'change', (e) => {
        const selectedMapKey = String(e.target.value || '');
        const hasUiOption = Array.from(ui.mapSelect?.options || [])
            .some((option) => String(option?.value || '') === selectedMapKey);
        const resolvedMapKey = (selectedMapKey === CUSTOM_MAP_KEY || hasUiOption || gameplayConfig.MAPS[selectedMapKey])
            ? selectedMapKey
            : 'standard';
        const writeback = writeHangarMapSelection(settings, resolvedMapKey, 'standard', {
            modePath: resolveCurrentHangarModePath(),
        });
        if (writeback.changed) {
            emitSettingsChangedImmediate([keys.MAP_KEY]);
        }
    });

    if (ui.themeModeSelect) {
        bind(ui.themeModeSelect, 'change', () => {
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            settings.localSettings.themeMode = ui.themeModeSelect.value === 'hell' ? 'hell' : 'dunkel';
            emitSettingsChangedImmediate([keys.LOCAL_THEME_MODE]);
        });
    }
    bindArcadeGhostDuelModeSelect({ ui, settings, bind, emitSettingsChangedImmediate, keys });

    bind(ui.botSlider, 'input', () => {
        settings.numBots = clamp(parseInt(ui.botSlider.value, 10), sessionLimits.numBots.min, sessionLimits.numBots.max);
        queueInputSettingsChanged([keys.BOTS_COUNT]);
    });

    if (ui.botDifficultySelect) {
        bind(ui.botDifficultySelect, 'change', () => {
            const value = String(ui.botDifficultySelect.value || '').toUpperCase();
            settings.botDifficulty = ['EASY', 'NORMAL', 'HARD'].includes(value) ? value : 'NORMAL';
            emitSettingsChangedImmediate([keys.BOTS_DIFFICULTY]);
        });
    }

    if (ui.botPolicyStrategySelect) {
        bind(ui.botPolicyStrategySelect, 'change', () => {
            const value = String(ui.botPolicyStrategySelect.value || '').trim().toLowerCase();
            const settingsManager = ctx.game?.settingsManager || null;
            const result = typeof settingsManager?.setBotPolicyStrategy === 'function'
                ? settingsManager.setBotPolicyStrategy(settings, value)
                : null;
            if (result && result.success) {
                emitSettingsChangedImmediate(result.changedKeys.length > 0
                    ? result.changedKeys
                    : [keys.BOTS_POLICY_STRATEGY]);
                return;
            }
            settings.botPolicyStrategy = ['auto', 'heuristic', 'rule-based', 'bridge'].includes(value)
                ? value
                : 'auto';
            emitSettingsChangedImmediate([keys.BOTS_POLICY_STRATEGY]);
        });
    }

    bind(ui.winSlider, 'input', () => {
        settings.winsNeeded = clamp(parseInt(ui.winSlider.value, 10), sessionLimits.winsNeeded.min, sessionLimits.winsNeeded.max);
        queueInputSettingsChanged([keys.RULES_WINS_NEEDED]);
    });

    bind(ui.autoRollToggle, 'change', () => {
        settings.autoRoll = !!ui.autoRollToggle.checked;
        emitSettingsChangedImmediate([keys.RULES_AUTO_ROLL]);
    });

    bind(ui.invertP1, 'change', () => {
        settings.invertPitch.PLAYER_1 = !!ui.invertP1.checked;
        emitSettingsChangedImmediate([keys.RULES_INVERT_P1]);
    });

    bind(ui.invertP2, 'change', () => {
        settings.invertPitch.PLAYER_2 = !!ui.invertP2.checked;
        emitSettingsChangedImmediate([keys.RULES_INVERT_P2]);
    });

    bind(ui.cockpitCamP1, 'change', () => {
        settings.cockpitCamera.PLAYER_1 = GAMEPLAY_COCKPIT_CAMERA_ENABLED;
        ui.cockpitCamP1.checked = GAMEPLAY_COCKPIT_CAMERA_ENABLED;
        emitSettingsChangedImmediate([keys.RULES_COCKPIT_P1]);
    });

    bind(ui.cockpitCamP2, 'change', () => {
        settings.cockpitCamera.PLAYER_2 = GAMEPLAY_COCKPIT_CAMERA_ENABLED;
        ui.cockpitCamP2.checked = GAMEPLAY_COCKPIT_CAMERA_ENABLED;
        emitSettingsChangedImmediate([keys.RULES_COCKPIT_P2]);
    });

    if (ui.planarModeToggle) {
        bind(ui.planarModeToggle, 'change', (e) => {
            applyPlanarMode(!!e.target.checked);
        });
    }

    bind(ui.portalsToggle, 'change', () => {
        settings.portalsEnabled = !!ui.portalsToggle.checked;
        emitSettingsChangedImmediate([keys.RULES_PORTALS_ENABLED]);
    });

    if (ui.mobileTiltSensitivitySlider) {
        bind(ui.mobileTiltSensitivitySlider, 'input', () => {
            const percent = clamp(
                parseInt(ui.mobileTiltSensitivitySlider.value, 10),
                Math.round(MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.min * 100),
                Math.round(MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.max * 100)
            );
            updateMobileControls({ tiltSensitivity: percent / 100 });
            queueInputSettingsChanged([keys.LOCAL_MOBILE_TILT_SENSITIVITY]);
        });
    }

    if (ui.mobileTiltAssistSelect) {
        bind(ui.mobileTiltAssistSelect, 'change', () => {
            updateMobileControls({ tiltAssistMode: ui.mobileTiltAssistSelect.value });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_ASSIST_MODE]);
        });
    }

    if (ui.mobileTiltPitchModeSelect) {
        bind(ui.mobileTiltPitchModeSelect, 'change', () => {
            updateMobileControls({ tiltPitchMode: ui.mobileTiltPitchModeSelect.value });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_PITCH_MODE]);
        });
    }

    if (ui.mobileTiltDebugToggle) {
        bind(ui.mobileTiltDebugToggle, 'change', () => {
            updateMobileControls({ tiltDebugVisible: !!ui.mobileTiltDebugToggle.checked });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_DEBUG_VISIBLE]);
        });
    }

    if (ui.mobileTiltSensorHzToggle) {
        bind(ui.mobileTiltSensorHzToggle, 'change', () => {
            updateMobileControls({ tiltSensorHzVisible: !!ui.mobileTiltSensorHzToggle.checked });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_SENSOR_HZ_VISIBLE]);
        });
    }

    bind(ui.speedSlider, 'input', () => {
        settings.gameplay.speed = clamp(parseFloat(ui.speedSlider.value), gameplayLimits.speed.min, gameplayLimits.speed.max);
        queueInputSettingsChanged([keys.GAMEPLAY_SPEED]);
    });

    bind(ui.turnSlider, 'input', () => {
        settings.gameplay.turnSensitivity = clamp(
            parseFloat(ui.turnSlider.value),
            gameplayLimits.turnSensitivity.min,
            gameplayLimits.turnSensitivity.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_TURN_SENSITIVITY]);
    });

    bind(ui.planeSizeSlider, 'input', () => {
        settings.gameplay.planeScale = clamp(
            parseFloat(ui.planeSizeSlider.value),
            gameplayLimits.planeScale.min,
            gameplayLimits.planeScale.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_PLANE_SCALE]);
    });

    bind(ui.trailWidthSlider, 'input', () => {
        settings.gameplay.trailWidth = clamp(
            parseFloat(ui.trailWidthSlider.value),
            gameplayLimits.trailWidth.min,
            gameplayLimits.trailWidth.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_TRAIL_WIDTH]);
    });

    bind(ui.gapSizeSlider, 'input', () => {
        settings.gameplay.gapSize = clamp(
            parseFloat(ui.gapSizeSlider.value),
            gameplayLimits.gapSize.min,
            gameplayLimits.gapSize.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_GAP_SIZE]);
    });

    bind(ui.gapFrequencySlider, 'input', () => {
        settings.gameplay.gapFrequency = clamp(
            parseFloat(ui.gapFrequencySlider.value),
            gameplayLimits.gapFrequency.min,
            gameplayLimits.gapFrequency.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_GAP_FREQUENCY]);
    });

    bind(ui.itemAmountSlider, 'input', () => {
        settings.gameplay.itemAmount = clamp(
            parseInt(ui.itemAmountSlider.value, 10),
            gameplayLimits.itemAmount.min,
            gameplayLimits.itemAmount.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_ITEM_AMOUNT]);
    });

    bind(ui.fireRateSlider, 'input', () => {
        settings.gameplay.fireRate = clamp(
            parseFloat(ui.fireRateSlider.value),
            gameplayLimits.fireRate.min,
            gameplayLimits.fireRate.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_FIRE_RATE]);
    });

    bind(ui.lockOnSlider, 'input', () => {
        settings.gameplay.lockOnAngle = clamp(
            parseInt(ui.lockOnSlider.value, 10),
            gameplayLimits.lockOnAngle.min,
            gameplayLimits.lockOnAngle.max
        );
        queueInputSettingsChanged([keys.GAMEPLAY_LOCK_ON_ANGLE]);
    });

    if (ui.nextCheckpointGlowSlider) {
        bind(ui.nextCheckpointGlowSlider, 'input', () => {
            settings.gameplay.nextCheckpointGlowIntensity = clamp(
                parseFloat(ui.nextCheckpointGlowSlider.value),
                gameplayLimits.nextCheckpointGlowIntensity.min,
                gameplayLimits.nextCheckpointGlowIntensity.max
            );
            queueInputSettingsChanged([keys.GAMEPLAY_NEXT_CHECKPOINT_GLOW_INTENSITY]);
        });
    }

    if (ui.mgTrailAimSlider) {
        bind(ui.mgTrailAimSlider, 'input', () => {
            settings.gameplay.mgTrailAimRadius = clamp(
                parseFloat(ui.mgTrailAimSlider.value),
                mgTrailAimLimits.min,
                mgTrailAimLimits.max
            );
            queueInputSettingsChanged([keys.GAMEPLAY_MG_TRAIL_AIM_RADIUS]);
        });
    }
    if (ui.fightPlayerHpSlider) {
        bind(ui.fightPlayerHpSlider, 'input', () => {
            if (!isFightModePathActive()) return;
            settings.gameplay.fightPlayerHp = clamp(
                parseInt(ui.fightPlayerHpSlider.value, 10),
                gameplayLimits.fightPlayerHp.min,
                gameplayLimits.fightPlayerHp.max
            );
            queueInputSettingsChanged([keys.GAMEPLAY_FIGHT_PLAYER_HP]);
        });
    }
    if (ui.fightMgDamageSlider) {
        bind(ui.fightMgDamageSlider, 'input', () => {
            if (!isFightModePathActive()) return;
            settings.gameplay.fightMgDamage = clamp(
                parseFloat(ui.fightMgDamageSlider.value),
                fightMgDamageLimits.min,
                fightMgDamageLimits.max
            );
            queueInputSettingsChanged([keys.GAMEPLAY_FIGHT_MG_DAMAGE]);
        });
    }

    if (ui.shadowQualitySlider) {
        bind(ui.shadowQualitySlider, 'input', () => {
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            settings.localSettings.shadowQuality = normalizeShadowQuality(ui.shadowQualitySlider.value);
            queueInputSettingsChanged([keys.LOCAL_SHADOW_QUALITY]);
        });
    }
    bindMenuRecordingCameraControls(ctx);

    bind(ui.startButton, 'click', () => {
        emit(eventTypes.START_MATCH);
    });

    bindMenuExtrasButtons(ctx);
}

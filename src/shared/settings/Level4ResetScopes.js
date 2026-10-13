// Which settings the "<tab> zurücksetzen" button of the settings drawer puts back, per tab.
// Pure data and functions: the drawer reads the labels, the runtime applies the reset.
import { SETTINGS_CHANGE_KEYS as K } from './SettingsChangeKeys.js';
import { normalizeGraphicsQualitySetting } from '../contracts/GraphicsQualityContract.js';
import { createDefaultAudioSettings } from '../contracts/AudioSettingsContract.js';
import { createDefaultHudAppearance } from '../contracts/HudAppearanceContract.js';
import { DEFAULT_MENU_SCALE } from '../contracts/MenuScaleContract.js';

function ensureLocalSettings(settings) {
    if (!settings.localSettings || typeof settings.localSettings !== 'object') settings.localSettings = {};
    return settings.localSettings;
}

function copyBlock(value, fallback = {}) {
    return { ...(value && typeof value === 'object' ? value : fallback) };
}

/** @type {Readonly<Record<string, { label: string, changeKeys: readonly string[], apply: (settings: any, defaults: any) => void }>>} */
export const LEVEL4_RESET_SCOPES = Object.freeze({
    controls: {
        label: 'Steuerung',
        changeKeys: Object.freeze([
            K.RULES_AUTO_ROLL, K.RULES_INVERT_P1, K.RULES_INVERT_P2, K.RULES_INVERT_P3,
            K.LOCAL_MOUSE_STEERING, K.LOCAL_GAMEPAD_VIBRATION, K.LOCAL_SMOOTH_STEERING,
        ]),
        apply(settings, defaults) {
            const local = ensureLocalSettings(settings);
            settings.autoRoll = defaults.autoRoll;
            settings.invertPitch = copyBlock(defaults.invertPitch);
            local.mouseSteering = defaults.localSettings?.mouseSteering === true;
            local.gamepadVibration = defaults.localSettings?.gamepadVibration !== false;
            local.smoothSteering = defaults.localSettings?.smoothSteering === true;
        },
    },
    graphics: {
        label: 'Grafik & Kamera',
        changeKeys: Object.freeze([
            K.LOCAL_GRAPHICS_STYLE, K.LOCAL_SHADOW_QUALITY, K.LOCAL_BLOOM_QUALITY, K.LOCAL_GRAPHICS_QUALITY,
            K.LOCAL_MAP_BRIGHTNESS, K.LOCAL_VIEW_DISTANCE, K.LOCAL_MENU_SCALE,
            K.RULES_COCKPIT_P1, K.RULES_COCKPIT_P2,
            K.CAMERA_PERSPECTIVE_REDUCE_MOTION,
            K.CAMERA_PERSPECTIVE_REACTOR_FLASH, K.CAMERA_PERSPECTIVE_REACTOR_SHAKE,
            K.CAMERA_PERSPECTIVE_SPEED_FOV_ENABLED, K.CAMERA_PERSPECTIVE_SPEED_FOV_INTENSITY,
            K.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_ENABLED, K.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_INTENSITY,
        ]),
        apply(settings, defaults) {
            const local = ensureLocalSettings(settings);
            const base = defaults.localSettings || {};
            local.graphicsStyle = base.graphicsStyle;
            local.shadowQuality = base.shadowQuality;
            local.bloomQuality = base.bloomQuality;
            local.bloomQualityUserSet = false;
            local.graphicsQuality = normalizeGraphicsQualitySetting(base.graphicsQuality);
            local.mapBrightness = base.mapBrightness;
            local.viewDistance = base.viewDistance;
            local.menuScale = base.menuScale ?? DEFAULT_MENU_SCALE;
            settings.cockpitCamera = copyBlock(defaults.cockpitCamera);
            // The video perspective select sits in the recording tab and is reset there.
            settings.cameraPerspective = {
                ...copyBlock(defaults.cameraPerspective),
                ...(settings.cameraPerspective && 'normal' in settings.cameraPerspective
                    ? { normal: settings.cameraPerspective.normal } : {}),
            };
        },
    },
    audio: {
        label: 'Audio',
        changeKeys: Object.freeze([
            K.LOCAL_AUDIO_ENABLED, K.LOCAL_AUDIO_MASTER_VOLUME, K.LOCAL_AUDIO_MUSIC_VOLUME,
            K.LOCAL_AUDIO_SFX_VOLUME, K.LOCAL_AUDIO_ENGINE_VOLUME, K.LOCAL_AUDIO_UI_VOLUME,
            K.LOCAL_AUDIO_AMBIENCE_VOLUME,
        ]),
        apply(settings, defaults) {
            ensureLocalSettings(settings).audio = copyBlock(defaults.localSettings?.audio, createDefaultAudioSettings());
        },
    },
    hud: {
        label: 'HUD',
        changeKeys: Object.freeze([K.LOCAL_HUD_SCALE, K.LOCAL_HUD_OPACITY, K.LOCAL_HUD_COLOR_PRESET]),
        apply(settings, defaults) {
            ensureLocalSettings(settings).hud = copyBlock(defaults.localSettings?.hud, createDefaultHudAppearance());
        },
    },
    recording: {
        label: 'Aufnahme',
        changeKeys: Object.freeze([
            K.RECORDING_PROFILE, K.RECORDING_HUD_MODE, K.RECORDING_ORIENTATION, K.CAMERA_PERSPECTIVE_NORMAL,
        ]),
        apply(settings, defaults) {
            settings.recording = copyBlock(defaults.recording);
            // The video perspective select belongs to the recording tab; the other camera options stay in graphics.
            settings.cameraPerspective = {
                ...copyBlock(settings.cameraPerspective),
                normal: defaults.cameraPerspective?.normal,
            };
        },
    },
});

/** Tabs without an entry (Spieler, Werkzeuge, Mobile) have nothing to reset and hide the button. */
export function isLevel4ResetSection(sectionId) {
    return Object.prototype.hasOwnProperty.call(LEVEL4_RESET_SCOPES, String(sectionId || '').trim());
}

/** Button text for a tab, e.g. "Grafik & Kamera zurücksetzen"; empty when the tab has no reset. */
export function resolveLevel4ResetLabel(sectionId) {
    const scope = isLevel4ResetSection(sectionId) ? LEVEL4_RESET_SCOPES[String(sectionId).trim()] : null;
    return scope ? `${scope.label} zurücksetzen` : '';
}

/**
 * Puts the settings of one tab back to the defaults. Returns the change keys to publish,
 * or null when the tab has no reset (nothing is touched then).
 */
export function applyLevel4Reset(settings, defaults, sectionId) {
    if (!isLevel4ResetSection(sectionId)) return null;
    const scope = LEVEL4_RESET_SCOPES[String(sectionId).trim()];
    scope.apply(settings, defaults || {});
    return [...scope.changeKeys];
}

// @ts-check
/* global __APP_TARGET__ */

import { GAME_MODE_TYPES } from '../hunt/HuntMode.js';
import { MENU_SESSION_TYPES } from '../composition/core-ui/CoreSettingsPorts.js';
import { MENU_MODE_PATHS } from '../ui/menu/MenuStateContracts.js';
import {
    ARCADE_GHOST_DUEL_MODES,
} from '../shared/contracts/ArcadeGhostDuelContract.js';
import { normalizeMobileClassicControlSettings } from '../shared/contracts/MobileClassicControlsContract.js';
import { ensureMobileClassicStyles } from './MobileClassicStyles.js';
import { setupMobileClassicUpdateUi } from './MobileClassicUpdateUi.js';
import {
    MOBILE_ARCADE_DEFAULT_MAP_KEY,
    resolveMobileArcadeMapKey,
} from '../mobile-arcade/MobileArcadeApp.js';
import {
    applyMobileClassicMenuUiLocks,
    ensureMobileAndroidStartSetup,
    resolveMobileAndroidLevel4SectionId,
    resolveMobileAndroidModePath,
    setupMobileClassicMenuDocumentState,
} from './MobileClassicMenuUi.js';

export const MOBILE_CLASSIC_APP_TARGET = 'mobile-classic';

export {
    checkMobileClassicGithubRelease,
    hydrateMobileClassicUpdateConfig,
    openMobileClassicUpdateTarget,
    setupMobileClassicUpdateUi,
} from './MobileClassicUpdateUi.js';

function normalizeTarget(value = '') {
    return String(value || '').trim().toLowerCase();
}

export function isMobileClassicTargetValue(value = '') {
    return normalizeTarget(value) === MOBILE_CLASSIC_APP_TARGET;
}

export function isMobileClassicAppTarget() {
    // Build-time define; the typeof guard keeps tests and non-Vite callers safe.
    return typeof __APP_TARGET__ !== 'undefined' && isMobileClassicTargetValue(__APP_TARGET__);
}

function resolveExistingArcadeMapKey(settings) {
    return settings?.localSettings?.startSetup?.modeSelections?.arcade?.mapKey
        || settings?.mapKey
        || MOBILE_ARCADE_DEFAULT_MAP_KEY;
}

function applyMobileAndroidArcadeSettings(settings) {
    const startSetup = ensureMobileAndroidStartSetup(settings);
    const mapKey = resolveMobileArcadeMapKey(resolveExistingArcadeMapKey(settings));
    settings.mapKey = mapKey;
    startSetup.modeSelections.arcade.mapKey = mapKey;
    startSetup.arcadeGhostDuelMode = ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST;
    startSetup.arcadeGhostTrailCollisionEnabled = false;
}

export function applyMobileClassicSettings(settings = null) {
    if (!settings || typeof settings !== 'object') {
        return settings;
    }
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    if (!settings.gameplay || typeof settings.gameplay !== 'object') {
        settings.gameplay = {};
    }
    if (!settings.hunt || typeof settings.hunt !== 'object') {
        settings.hunt = {};
    }

    const modePath = resolveMobileAndroidModePath(settings);
    settings.mode = '1p';
    settings.gameMode = GAME_MODE_TYPES.CLASSIC;
    settings.localSettings.sessionType = MENU_SESSION_TYPES.SINGLE;
    settings.localSettings.modePath = modePath;
    settings.localSettings.mobileControls = normalizeMobileClassicControlSettings(settings.localSettings.mobileControls);
    if (!settings.invertPitch || typeof settings.invertPitch !== 'object') {
        settings.invertPitch = {};
    }
    // Phone tilt already maps the calibrated hand posture directly; desktop pitch-invert feels reversed here.
    settings.invertPitch.PLAYER_1 = false;
    if (!settings.localSettings.toolsState || typeof settings.localSettings.toolsState !== 'object') {
        settings.localSettings.toolsState = {};
    }
    settings.localSettings.toolsState.activeSection = resolveMobileAndroidLevel4SectionId(
        settings.localSettings.toolsState.activeSection,
    );
    settings.gameplay.planarMode = false;
    settings.hunt.respawnEnabled = false;
    if (modePath === MENU_MODE_PATHS.ARCADE) {
        applyMobileAndroidArcadeSettings(settings);
    }

    return settings;
}

function ensureViewportFit(doc = document) {
    const viewport = doc.querySelector('meta[name="viewport"]');
    if (!viewport) return;
    const content = String(viewport.getAttribute('content') || '');
    if (content.includes('viewport-fit=cover')) return;
    viewport.setAttribute('content', `${content}, viewport-fit=cover`.replace(/^,\s*/, ''));
}

export function applyMobileClassicDocumentState(doc = document) {
    if (!doc?.documentElement || !doc.body) {
        return;
    }
    doc.documentElement.classList.add('mobile-classic-app');
    doc.body.classList.add('mobile-classic-app');
    doc.documentElement.dataset.appTarget = MOBILE_CLASSIC_APP_TARGET;
    doc.body.dataset.appTarget = MOBILE_CLASSIC_APP_TARGET;
    ensureViewportFit(doc);
    ensureMobileClassicStyles(doc);
    setupMobileClassicMenuDocumentState(doc);
    setupMobileClassicUpdateUi(doc);
}

export function applyMobileClassicUiLocks(game = null) {
    applyMobileClassicMenuUiLocks(game, { applyMobileClassicSettings });
}

// @ts-check
/* global __APP_TARGET__ */

import { MENU_SESSION_TYPES } from '../composition/core-ui/CoreSettingsPorts.js';
import { normalizeMobileClassicControlSettings } from '../shared/contracts/MobileClassicControlsContract.js';
import { ensureMobileClassicStyles } from './MobileClassicStyles.js';
import { setupMobileClassicUpdateUi } from './MobileClassicUpdateUi.js';
import {
    applyMobileClassicMenuUiLocks,
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

// The Android app offers every desktop game feature except splitscreen: one phone, one player.
export function applyMobileClassicSettings(settings = null) {
    if (!settings || typeof settings !== 'object') {
        return settings;
    }
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }

    const sessionType = normalizeTarget(settings.localSettings.sessionType);
    if (sessionType === MENU_SESSION_TYPES.SPLITSCREEN) {
        settings.localSettings.sessionType = MENU_SESSION_TYPES.SINGLE;
    }
    // A multiplayer snapshot keeps the host's player layout; locally the phone always seats one player.
    if (sessionType !== MENU_SESSION_TYPES.MULTIPLAYER) {
        settings.mode = '1p';
    }
    settings.localSettings.mobileControls = normalizeMobileClassicControlSettings(settings.localSettings.mobileControls);
    if (!settings.invertPitch || typeof settings.invertPitch !== 'object') {
        settings.invertPitch = {};
    }
    // Phone tilt already maps the calibrated hand posture directly; desktop pitch-invert feels reversed here.
    settings.invertPitch.PLAYER_1 = false;

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

// @ts-check
/* global __APP_TARGET__ */

import { GAME_MODE_TYPES } from '../hunt/HuntMode.js';
import { MENU_MODE_PATHS, MENU_SESSION_TYPES } from '../ui/menu/MenuStateContracts.js';
import {
    ARCADE_GHOST_DUEL_MODES,
} from '../shared/contracts/ArcadeGhostDuelContract.js';
import { normalizeMobileClassicControlSettings } from '../shared/contracts/MobileClassicControlsContract.js';

export const MOBILE_ARCADE_APP_TARGET = 'mobile-arcade';
export const MOBILE_ARCADE_DEFAULT_MAP_KEY = 'parcours_rift_sprint';
export const MOBILE_ARCADE_ROUTE_ALLOWLIST = Object.freeze([
    'parcours_rift_sprint',
    'micro_maw',
    'mirror_docks',
    'glass_serpent',
]);

const MOBILE_ARCADE_STYLE_ID = 'mobile-arcade-app-style';
const MOBILE_ARCADE_GHOST_STATUS_ID = 'mobile-arcade-ghost-status';

function normalizeTarget(value = '') {
    return String(value || '').trim().toLowerCase();
}

export function isMobileArcadeTargetValue(value = '') {
    return normalizeTarget(value) === MOBILE_ARCADE_APP_TARGET;
}

export function isMobileArcadeAppTarget() {
    return typeof __APP_TARGET__ !== 'undefined' && isMobileArcadeTargetValue(__APP_TARGET__);
}

export function listMobileArcadeRouteAllowlist() {
    return [...MOBILE_ARCADE_ROUTE_ALLOWLIST];
}

export function isMobileArcadeRouteAllowed(mapKey = '') {
    return MOBILE_ARCADE_ROUTE_ALLOWLIST.includes(normalizeTarget(mapKey));
}

export function resolveMobileArcadeMapKey(mapKey = '') {
    const normalizedMapKey = normalizeTarget(mapKey);
    return isMobileArcadeRouteAllowed(normalizedMapKey)
        ? normalizedMapKey
        : MOBILE_ARCADE_DEFAULT_MAP_KEY;
}

function ensureStartSetup(settings) {
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    if (!settings.localSettings.startSetup || typeof settings.localSettings.startSetup !== 'object') {
        settings.localSettings.startSetup = {};
    }
    const startSetup = settings.localSettings.startSetup;
    if (!startSetup.modeSelections || typeof startSetup.modeSelections !== 'object') {
        startSetup.modeSelections = {};
    }
    if (!startSetup.modeSelections.arcade || typeof startSetup.modeSelections.arcade !== 'object') {
        startSetup.modeSelections.arcade = {};
    }
    return startSetup;
}

function resolveExistingArcadeMapKey(settings) {
    return settings?.localSettings?.startSetup?.modeSelections?.arcade?.mapKey
        || settings?.mapKey
        || MOBILE_ARCADE_DEFAULT_MAP_KEY;
}

export function applyMobileArcadeSettings(settings = null) {
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

    const startSetup = ensureStartSetup(settings);
    const mapKey = resolveMobileArcadeMapKey(resolveExistingArcadeMapKey(settings));

    settings.mode = '1p';
    settings.gameMode = GAME_MODE_TYPES.CLASSIC;
    settings.mapKey = mapKey;
    settings.localSettings.sessionType = MENU_SESSION_TYPES.SINGLE;
    settings.localSettings.modePath = MENU_MODE_PATHS.ARCADE;
    settings.localSettings.mobileControls = normalizeMobileClassicControlSettings(settings.localSettings.mobileControls);
    settings.gameplay.planarMode = false;
    settings.hunt.respawnEnabled = false;
    startSetup.modeSelections.arcade.mapKey = mapKey;
    startSetup.arcadeGhostDuelMode = ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST;
    startSetup.arcadeGhostTrailCollisionEnabled = false;

    return settings;
}

function ensureViewportFit(doc = document) {
    const viewport = doc.querySelector?.('meta[name="viewport"]');
    if (!viewport) return;
    const content = String(viewport.getAttribute('content') || '');
    if (content.includes('viewport-fit=cover')) return;
    viewport.setAttribute('content', `${content}, viewport-fit=cover`.replace(/^,\s*/, ''));
}

function ensureMobileArcadeStyles(doc = document) {
    if (doc.getElementById?.(MOBILE_ARCADE_STYLE_ID)) {
        return;
    }
    const style = doc.createElement('style');
    style.id = MOBILE_ARCADE_STYLE_ID;
    style.textContent = `
html.mobile-arcade-app,
body.mobile-arcade-app {
    width: 100%;
    min-height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
    touch-action: manipulation;
    background: #04070b;
}

body.mobile-arcade-app {
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}

body.mobile-arcade-app .nav-btn[data-session-type="multiplayer"],
body.mobile-arcade-app .nav-btn[data-session-type="splitscreen"],
body.mobile-arcade-app .mode-path-btn[data-mode-path="normal"],
body.mobile-arcade-app .mode-path-btn[data-mode-path="fight"],
body.mobile-arcade-app #submenu-multiplayer,
body.mobile-arcade-app #multiplayer-inline-stub,
body.mobile-arcade-app #btn-open-expert,
body.mobile-arcade-app #btn-open-developer,
body.mobile-arcade-app #btn-open-debug,
body.mobile-arcade-app #hunt-mode-hint,
body.mobile-arcade-app #fight-player-hp-setting,
body.mobile-arcade-app #fight-mg-damage-setting,
body.mobile-arcade-app #fight-tuning-hint,
body.mobile-arcade-app #arcade-ghost-duel-row,
body.mobile-arcade-app #arcade-ghost-trail-collision-row {
    display: none !important;
}

body.mobile-arcade-app #menu-nav {
    grid-template-columns: minmax(0, 1fr);
}

body.mobile-arcade-app #game-container {
    min-height: 100dvh;
}

body.mobile-arcade-app #main-menu {
    max-width: min(460px, calc(100vw - 22px));
    max-height: calc(100dvh - max(18px, env(safe-area-inset-top)) - max(18px, env(safe-area-inset-bottom)));
    margin: max(10px, env(safe-area-inset-top)) auto max(10px, env(safe-area-inset-bottom));
    border-color: rgba(255, 210, 118, 0.34);
}

body.mobile-arcade-app #menu-selection-summary {
    font-size: 13px;
    line-height: 1.35;
}

body.mobile-arcade-app #touch-controls {
    position: fixed;
    inset: 0;
    pointer-events: auto;
    z-index: 1000;
}

body.mobile-arcade-app .touch-joystick {
    left: max(14px, env(safe-area-inset-left)) !important;
    bottom: max(22px, env(safe-area-inset-bottom)) !important;
    width: 108px !important;
    height: 108px !important;
    border-color: rgba(116, 225, 255, 0.76) !important;
    background: rgba(2, 14, 24, 0.42) !important;
}

body.mobile-arcade-app #touch-controls[data-touch-control-mode="tilt"] .touch-joystick {
    opacity: 0.58;
}

body.mobile-arcade-app #touch-controls[data-tilt-active="1"] .touch-joystick {
    display: none !important;
}

body.mobile-arcade-app .touch-button {
    border-color: rgba(255, 210, 118, 0.78) !important;
    background: rgba(6, 16, 24, 0.54) !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34) !important;
    letter-spacing: 0 !important;
}

body.mobile-arcade-app #touch-controls[data-touch-control-mode="tilt"] .touch-button-fire {
    right: max(18px, env(safe-area-inset-right)) !important;
    bottom: max(26px, env(safe-area-inset-bottom)) !important;
    width: 92px !important;
    height: 92px !important;
    border-width: 3px !important;
    border-color: rgba(255, 214, 118, 0.95) !important;
    background: radial-gradient(circle at 35% 30%, rgba(255, 234, 166, 0.95), rgba(242, 126, 45, 0.88) 56%, rgba(70, 18, 8, 0.72)) !important;
    color: #10151b !important;
    font-size: 13px !important;
    font-weight: 900 !important;
}

body.mobile-arcade-app #touch-controls[data-touch-control-mode="tilt"] .touch-button-useItem {
    right: calc(max(18px, env(safe-area-inset-right)) + 118px) !important;
    bottom: max(28px, env(safe-area-inset-bottom)) !important;
    width: 56px !important;
    height: 56px !important;
}

body.mobile-arcade-app #touch-controls[data-touch-control-mode="tilt"] .touch-button-nextItem {
    right: calc(max(18px, env(safe-area-inset-right)) + 182px) !important;
    bottom: max(28px, env(safe-area-inset-bottom)) !important;
    width: 50px !important;
    height: 50px !important;
}

body.mobile-arcade-app #touch-controls[data-touch-control-mode="tilt"] .touch-button-boost {
    right: max(18px, env(safe-area-inset-right)) !important;
    bottom: calc(max(28px, env(safe-area-inset-bottom)) + 102px) !important;
    width: 60px !important;
    height: 60px !important;
}

body.mobile-arcade-app .touch-button-pause {
    top: max(14px, env(safe-area-inset-top)) !important;
    right: max(14px, env(safe-area-inset-right)) !important;
    bottom: auto !important;
    width: 58px !important;
    height: 42px !important;
    border-radius: 8px !important;
    font-size: 11px !important;
    z-index: 1002 !important;
}

body.mobile-arcade-app .touch-tilt-button {
    left: max(14px, env(safe-area-inset-left)) !important;
    top: max(14px, env(safe-area-inset-top)) !important;
    min-width: 92px !important;
}

body.mobile-arcade-app .touch-tilt-status {
    left: max(16px, env(safe-area-inset-left)) !important;
    top: max(58px, calc(env(safe-area-inset-top) + 56px)) !important;
}

body.mobile-arcade-app #parcours-hud {
    top: max(12px, env(safe-area-inset-top)) !important;
    left: 50% !important;
    min-width: 150px !important;
    max-width: min(44vw, 230px) !important;
    padding: 7px 9px !important;
    border-radius: 8px !important;
    font-size: 12px !important;
    pointer-events: none !important;
    z-index: 912 !important;
}

body.mobile-arcade-app #parcours-route {
    font-size: 0.58rem !important;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

body.mobile-arcade-app #parcours-progress {
    font-size: 0.92rem !important;
}

body.mobile-arcade-app #parcours-timer,
body.mobile-arcade-app #parcours-status {
    font-size: 0.68rem !important;
}

body.mobile-arcade-app #parcours-minimap {
    top: max(68px, calc(env(safe-area-inset-top) + 66px)) !important;
    right: max(10px, env(safe-area-inset-right)) !important;
    width: 118px !important;
    height: 118px !important;
    opacity: 0.92;
    z-index: 909 !important;
}

body.mobile-arcade-app #arcade-score-hud {
    top: max(68px, calc(env(safe-area-inset-top) + 66px)) !important;
    left: max(10px, env(safe-area-inset-left)) !important;
    min-width: 154px !important;
    max-width: 178px !important;
    padding: 7px 8px !important;
    gap: 5px !important;
    font-size: 10px !important;
}

body.mobile-arcade-app #arcade-score-hud .arcade-score-hud-breakdown,
body.mobile-arcade-app #arcade-score-hud .arcade-score-hud-modifier {
    display: none !important;
}

body.mobile-arcade-app #arcade-mission-hud {
    top: max(190px, calc(env(safe-area-inset-top) + 188px)) !important;
    right: max(10px, env(safe-area-inset-right)) !important;
    max-width: 150px !important;
    font-size: 10px !important;
}

body.mobile-arcade-app #arcade-mission-hud .arcade-mission-card {
    min-width: 128px !important;
    padding: 4px 7px !important;
}

body.mobile-arcade-app #parcours-xp-notification,
body.mobile-arcade-app #parcours-split-delta,
body.mobile-arcade-app #arcade-stats-flash,
body.mobile-arcade-app #parcours-penalty-notification {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    max-width: min(70vw, 280px);
    padding: 6px 9px;
    border-radius: 8px;
    background: rgba(7, 17, 27, 0.88);
    border: 1px solid rgba(255, 210, 118, 0.48);
    color: #f8f4df;
    font-size: 0.74rem;
    font-weight: 800;
    text-align: center;
    pointer-events: none;
    z-index: 913;
}

body.mobile-arcade-app #parcours-xp-notification,
body.mobile-arcade-app #arcade-stats-flash {
    top: max(132px, calc(env(safe-area-inset-top) + 130px));
}

body.mobile-arcade-app #parcours-split-delta,
body.mobile-arcade-app #parcours-penalty-notification {
    top: max(168px, calc(env(safe-area-inset-top) + 166px));
}

body.mobile-arcade-app #parcours-split-delta.split-better {
    color: #a8ffbf;
    border-color: rgba(126, 255, 170, 0.58);
}

body.mobile-arcade-app #parcours-split-delta.split-worse,
body.mobile-arcade-app #parcours-penalty-notification {
    color: #ffb2a2;
    border-color: rgba(255, 132, 112, 0.62);
}

body.mobile-arcade-app #mobile-arcade-ghost-status {
    position: fixed;
    left: max(14px, env(safe-area-inset-left));
    bottom: calc(max(22px, env(safe-area-inset-bottom)) + 126px);
    max-width: 118px;
    color: rgba(210, 245, 255, 0.82);
    font-size: 10px;
    font-weight: 800;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.7);
    pointer-events: none;
    z-index: 1001;
}
`;
    doc.head?.appendChild(style);
}

function ensureMobileArcadeStatusUi(doc = document) {
    if (!doc?.createElement || typeof doc.body?.appendChild !== 'function'
        || doc.getElementById?.(MOBILE_ARCADE_GHOST_STATUS_ID)) {
        return;
    }
    const status = doc.createElement('div');
    status.id = MOBILE_ARCADE_GHOST_STATUS_ID;
    status.textContent = 'Ghost: Selbstduell';
    doc.body.appendChild(status);
}

export function applyMobileArcadeDocumentState(doc = document) {
    if (!doc?.documentElement || !doc.body) {
        return;
    }
    doc.documentElement.classList.add('mobile-arcade-app');
    doc.body.classList.add('mobile-arcade-app');
    doc.documentElement.dataset.appTarget = MOBILE_ARCADE_APP_TARGET;
    doc.body.dataset.appTarget = MOBILE_ARCADE_APP_TARGET;
    ensureViewportFit(doc);
    ensureMobileArcadeStyles(doc);
    ensureMobileArcadeStatusUi(doc);
}

function setButtonLocked(button, locked) {
    if (!button) return;
    button.disabled = !!locked;
    button.setAttribute?.('aria-hidden', locked ? 'true' : 'false');
    button.tabIndex = locked ? -1 : 0;
}

function setButtonLabel(button, label) {
    if (!button) return;
    const labelNode = button.querySelector?.('.nav-btn-label, .menu-choice-title');
    if (labelNode) {
        labelNode.textContent = label;
    } else {
        button.textContent = label;
    }
    button.title = '';
}

function pruneMapSelectToAllowlist(select) {
    if (!select?.options) {
        return;
    }
    const options = Array.from(select.options);
    for (let i = options.length - 1; i >= 0; i -= 1) {
        const option = options[i];
        if (!isMobileArcadeRouteAllowed(option?.value)) {
            option.remove?.();
        }
    }
    const currentValue = resolveMobileArcadeMapKey(select.value);
    const hasCurrentOption = Array.from(select.options).some((option) => option.value === currentValue);
    if (hasCurrentOption) {
        select.value = currentValue;
    }
}

export function applyMobileArcadeUiLocks(game = null) {
    const ui = game?.runtimeCoordinator?.getRuntimeHandle?.('ui') || game?.ui || null;
    if (!ui) {
        return;
    }
    if (Array.isArray(ui.sessionButtons)) {
        ui.sessionButtons.forEach((button) => {
            const sessionType = normalizeTarget(button?.dataset?.sessionType);
            setButtonLocked(button, sessionType && sessionType !== MENU_SESSION_TYPES.SINGLE);
            if (sessionType === MENU_SESSION_TYPES.SINGLE) {
                setButtonLabel(button, 'Arcade-Parcours');
            }
        });
    }
    if (Array.isArray(ui.modePathButtons)) {
        ui.modePathButtons.forEach((button) => {
            const modePath = normalizeTarget(button?.dataset?.modePath);
            setButtonLocked(button, modePath && modePath !== MENU_MODE_PATHS.ARCADE);
            if (modePath === MENU_MODE_PATHS.ARCADE) {
                setButtonLabel(button, 'Parcours');
            }
        });
    }
    pruneMapSelectToAllowlist(ui.mapSelect);
    if (ui.startButton) {
        ui.startButton.textContent = 'Arcade-Parcours starten';
        ui.startButton.title = '';
    }
    if (ui.menuContext) {
        ui.menuContext.textContent = 'Arcade-Parcours';
    }
}

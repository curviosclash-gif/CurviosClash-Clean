// Pure text and decision logic for the pause window, the result screen's menu button and the
// loading screen (menu rebuild, stage 3). No DOM and no runtime access: the callers pass in plain
// settings and snapshots, so every rule here can be checked in Node.

import {
    isGamepadInputEnabled,
    resolveSplitscreenInputDevice,
} from '../shared/contracts/GamepadControlsContract.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import {
    isThreePlayerSplitVariant,
    normalizeThreePlayerSplitDeviceAssignment,
} from '../four-player-planar/FourPlayerPlanarContract.js';
import { formatKeyCodeShort } from './KeybindLabels.js';

export const PAUSE_LABELS = Object.freeze({
    resume: 'Fortsetzen',
    leave: 'Match verlassen',
    leaveConfirm: 'Match wirklich verlassen? Erneut drücken',
    disconnect: 'Verbindung trennen',
    restart: 'Neu starten',
    restartConfirm: 'Wirklich neu starten? Erneut drücken',
    controlsShow: 'Steuerung anzeigen',
    controlsHide: 'Steuerung ausblenden',
    hostPaused: 'Gastgeber hat pausiert',
});

/** @param {unknown} sessionType */
function normalizeSessionType(sessionType) {
    const value = String(sessionType || '').trim().toLowerCase();
    return value === 'multiplayer' || value === 'splitscreen' ? value : 'single';
}

/**
 * Where "back to the menu" really lands, as words: the result screen button and the line under the
 * pause window's leave button.
 * @param {{ sessionType?: string, arcade?: boolean } | null} [context]
 * @returns {{ resultLabel: string, pauseHint: string }}
 */
export function resolveMenuReturnTarget(context = null) {
    const sessionType = normalizeSessionType(context?.sessionType);
    const pauseHint = sessionType === 'multiplayer' ? 'zurück zur Lobby' : 'zurück zur Spielauswahl';
    if (context?.arcade === true) return { resultLabel: 'Zur Arcade-Reise', pauseHint };
    if (sessionType === 'multiplayer') return { resultLabel: 'Zur Lobby', pauseHint };
    if (sessionType === 'splitscreen') return { resultLabel: 'Zur Spielauswahl', pauseHint };
    return { resultLabel: 'Zum freien Spiel', pauseHint };
}

/**
 * Lobby role for MenuVisibilityContract: only a network client is a guest.
 * @param {unknown} sessionType
 * @param {{ isHost?: boolean } | null} [sessionSnapshot]
 * @returns {'none' | 'host' | 'guest'}
 */
export function resolvePauseLobbyRole(sessionType, sessionSnapshot = null) {
    if (normalizeSessionType(sessionType) !== 'multiplayer') return 'none';
    return sessionSnapshot?.isHost === false ? 'guest' : 'host';
}

/**
 * Number (1-based) of the local player a pad steers, or 0 when it steers nobody on this machine.
 * "auto" merges pad and keyboard: pad N then belongs to player N + 1.
 * @param {any} settings
 * @param {number} padIndex
 */
export function resolveGamepadOwnerPlayer(settings, padIndex) {
    if (!Number.isInteger(padIndex) || padIndex < 0) return 0;
    const sessionType = normalizeSessionType(settings?.localSettings?.sessionType);
    if (sessionType === 'multiplayer' || !isGamepadInputEnabled(settings?.controls)) return 0;
    if (sessionType === 'single') return padIndex === 0 ? 1 : 0;
    if (isThreePlayerSplitVariant(settings)) {
        const assignment = normalizeThreePlayerSplitDeviceAssignment(settings?.localSettings?.threePlayerSplit?.deviceAssignment);
        const slot = assignment.indexOf(`gamepad-${padIndex + 1}`);
        return slot >= 0 ? slot + 1 : 0;
    }
    const layout = settings?.controls?.SPLITSCREEN?.layout;
    for (let player = 0; player < 2; player += 1) {
        const device = resolveSplitscreenInputDevice(layout, player);
        if (device) {
            if (device.type === 'gamepad' && device.gamepadIndex === padIndex) return player + 1;
        } else if (padIndex === player) {
            return player + 1;
        }
    }
    return 0;
}

/**
 * W2: a pad that drops out of a running local match pauses it, so nobody flies on without control.
 * @param {{ settings: any, padIndex: number, gameState: string }} input
 * @returns {{ pause: boolean, playerNumber: number, notice: string }}
 */
export function decideGamepadDisconnectPause({ settings, padIndex, gameState }) {
    const none = { pause: false, playerNumber: 0, notice: '' };
    if (gameState !== GAME_STATE_IDS.PLAYING) return none;
    const playerNumber = resolveGamepadOwnerPlayer(settings, padIndex);
    if (playerNumber === 0) return none;
    return { pause: true, playerNumber, notice: `Controller von Spieler ${playerNumber} getrennt` };
}

// A short list: the first line of text under the map name while a match loads.
export const LOADING_TIPS = Object.freeze([
    'Spuren und Wände sind tödlich. Plane deine Kurve früh.',
    'Im Pausenmenü zeigt „Steuerung anzeigen“ alle Tasten.',
    'Mit der Kamera-Taste wechselst du die Perspektive.',
    'Die Zeitlupe hilft bei engen Durchflügen.',
    'Items nutzt du mit der Item-Taste, mit der Wechsel-Taste schaltest du durch.',
    'Einen Controller belegst du in den Einstellungen unter Steuerung neu.',
]);

/**
 * Same map, same tip: no randomness, so a load screen never flickers between tips.
 * @param {unknown} mapKey
 */
export function pickLoadingTip(mapKey) {
    const key = String(mapKey || 'standard');
    let sum = 0;
    for (let i = 0; i < key.length; i += 1) sum = (sum * 31 + key.charCodeAt(i)) >>> 0;
    return LOADING_TIPS[sum % LOADING_TIPS.length];
}

const CONTROL_ROW_SPECS = Object.freeze([
    { label: 'Lenken', keys: ['LEFT', 'RIGHT'] },
    { label: 'Nase senken / heben', keys: ['UP', 'DOWN'] },
    { label: 'Rollen', keys: ['ROLL_LEFT', 'ROLL_RIGHT'] },
    { label: 'Boost', keys: ['BOOST'] },
    { label: 'Zeitlupe', keys: ['SLOWMO'] },
    { label: 'Rakete / MG', keys: ['SHOOT', 'SHOOT_MG'] },
    { label: 'Item nutzen / wechseln', keys: ['USE_ITEM', 'NEXT_ITEM'] },
    { label: 'Kamera', keys: ['CAMERA'] },
]);

/**
 * Key overview for the pause window: one block per local player, keys as the player bound them.
 * @param {any} settings
 * @returns {Array<{ title: string, rows: Array<{ label: string, keys: string[] }> }>}
 */
export function resolvePauseControlRows(settings) {
    const sessionType = normalizeSessionType(settings?.localSettings?.sessionType);
    const count = sessionType !== 'splitscreen' ? 1 : (isThreePlayerSplitVariant(settings) ? 3 : 2);
    const blocks = [];
    for (let player = 1; player <= count; player += 1) {
        const bindings = settings?.controls?.[`PLAYER_${player}`] || {};
        const rows = CONTROL_ROW_SPECS
            .filter((spec) => spec.keys.some((key) => bindings[key]))
            .map((spec) => ({
                label: spec.label,
                keys: spec.keys.filter((key) => bindings[key]).map((key) => formatKeyCodeShort(bindings[key])),
            }));
        blocks.push({ title: count > 1 ? `Spieler ${player}` : '', rows });
    }
    return blocks;
}

/**
 * Text of the loading screen: map name plus one tip. The name comes from the menu's map catalog.
 * @param {string} mapKey
 * @param {string} mapName
 */
export function buildLoadingMessages(mapKey, mapName) {
    return {
        messageText: `Lade ${String(mapName || mapKey || 'Arena')}...`,
        messageSub: `Tipp: ${pickLoadingTip(mapKey)}`,
    };
}

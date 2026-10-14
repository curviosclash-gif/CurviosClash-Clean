// "Spieler & Geräte" in the hub of the shared screen: player count (2, 3 or 4), devices, screen
// split and the profile per seat. Two and three players share every other field of the match menu;
// four players fly the planar module, whose entry card the visibility contract shows instead of the
// Arcade and free play cards.

import {
    SPLITSCREEN_INPUT_LAYOUTS,
    normalizeSplitscreenInputLayout,
} from '../../shared/contracts/GamepadControlsContract.js';
import { readGamepad } from '../../shared/input/GamepadInputSource.js';
import {
    SPLIT_SCREEN_VARIANTS,
    THREE_PLAYER_SPLIT_DEVICE_LABELS,
    clampThreePlayerSplitBotCount,
    isThreePlayerSplitModePathAllowed,
    isThreePlayerSplitVariant,
    normalizeSplitScreenVariant,
    normalizeThreePlayerSplitDeviceAssignment,
    normalizeThreePlayerSplitSettings,
    resolveSplitScreenDeviceIssue,
} from '../../four-player-planar/FourPlayerPlanarContract.js';
import { HANGAR_SELECTION_PLAYER_SLOTS, writeHangarVehicleSelection } from '../hangar/HangarSelectionWritebackContract.js';
import { resolveMenuVisibility } from '../../shared/contracts/MenuVisibilityContract.js';
import { resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';
import { applyMenuVisibility } from '../menu/MenuVisibilityApplier.js';
import { formatKeyCodeShort } from '../KeybindLabels.js';
import { bindSplitProfileSeats } from './StartSetupSplitSeatProfiles.js';

const THREE_PLAYER_HINT = 'Mit 3 Spielern: höchstens 6 Bots, kein Team-Modus.';
const UNSUPPORTED_MODE_HINT = 'Für diesen Spielstil ist die Drei-Spieler-Aufteilung nicht verfügbar.';
const FOUR_PLAYER_HINT = '4 Spieler fliegen im Ebenenflug: Öffne unten die Karte „4 Spieler – Ebenenflug“.';

function isSplitScreen(settings) {
    return String(settings?.localSettings?.sessionType || '').trim().toLowerCase() === 'splitscreen';
}

/** True when the next local split-screen match runs with three players. */
export function isThreePlayerSplitSelected(settings) {
    return isThreePlayerSplitVariant(settings)
        && isThreePlayerSplitModePathAllowed(settings?.localSettings?.modePath);
}

/** Players on the shared screen: 2, 3 (three-player split) or 4 (planar flight). */
export function resolveSplitPlayerCount(settings) {
    if (normalizeSplitScreenVariant(settings?.localSettings?.splitScreenVariant) === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR) return 4;
    return isThreePlayerSplitSelected(settings) ? 3 : 2;
}

/** The planar module is not mounted on the mobile surfaces, so four players are not offered there. */
function isPlanarOffered(section) {
    const appTarget = String(section?.ownerDocument?.documentElement?.dataset?.appTarget || '').trim().toLowerCase();
    return appTarget !== 'mobile-classic' && appTarget !== 'mobile-arcade';
}

/** Bot count the match really starts with; three players leave room for six bots. */
export function resolveMenuBotCount(settings) {
    const count = Math.max(0, Number(settings?.numBots) || 0);
    return isThreePlayerSplitSelected(settings) ? clampThreePlayerSplitBotCount(count) : count;
}

export function resolveMenuBotLimits(settings, limits) {
    if (!isThreePlayerSplitSelected(settings)) return limits;
    return { ...limits, max: Math.min(Number(limits?.max) || 0, clampThreePlayerSplitBotCount(Infinity)) };
}

/** Summary entries for the local pilots beyond the first. */
export function createLocalPilotSummaryBlocks(settings, sessionType, vehiclePreviewP2) {
    if (sessionType !== 'splitscreen' && sessionType !== 'multiplayer') return [];
    const blocks = [{ label: 'Flugzeug P2', value: vehiclePreviewP2.label }];
    if (sessionType === 'splitscreen' && isThreePlayerSplitSelected(settings)) {
        blocks.unshift({ label: 'Spieler', value: '3 Spieler', secondary: true });
        blocks.push({ label: 'Flugzeug P3', value: resolveVehiclePreview(settings?.vehicles?.PLAYER_3).label });
    }
    return blocks;
}

function ensureOptions(select, entries) {
    if (!select || select.options.length === entries.length) return;
    const doc = select.ownerDocument;
    select.replaceChildren(...entries.map(([value, label]) => {
        const option = doc.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
    }));
}

export function renderSplitDeviceStatus(ui, settings, getGamepad = readGamepad) {
    const status = ui?.splitDeviceStatus;
    if (!status) return;
    const issue = isSplitScreen(settings) ? resolveSplitScreenDeviceIssue(settings, getGamepad) : '';
    status.textContent = issue;
    status.classList.toggle('hidden', !issue);
    status.classList.toggle('is-error', !!issue);
}

export function syncSplitPlayersSection({ ui, settings, sessionType, getGamepad = readGamepad }) {
    const section = ui?.splitPlayersSection;
    const playerCount = resolveSplitPlayerCount(settings);
    // One contract decides which hub cards and blocks show; the surface policy keeps its own locks.
    applyMenuVisibility(ui?.hubPanel, resolveMenuVisibility({ sessionType, playerCount }), { touchDisabled: false });
    if (!section) return;
    const visible = sessionType === 'splitscreen';
    section.classList.toggle('hidden', !visible);
    section.setAttribute('aria-hidden', String(!visible));
    if (!visible) return;

    const threeAllowed = isThreePlayerSplitModePathAllowed(settings?.localSettings?.modePath);
    const planarOffered = isPlanarOffered(section);
    for (const button of ui.splitPlayerCountButtons || []) {
        const count = Number(button.dataset.splitPlayerCount);
        const active = count === playerCount;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
        button.disabled = count === 3 && !threeAllowed;
        button.hidden = count === 4 && !planarOffered;
        button.title = button.disabled ? UNSUPPORTED_MODE_HINT : '';
    }
    if (ui.splitPlayerCountHint) {
        ui.splitPlayerCountHint.textContent = playerCount === 4
            ? FOUR_PLAYER_HINT
            : (!threeAllowed ? UNSUPPORTED_MODE_HINT : (playerCount === 3 ? THREE_PLAYER_HINT : ''));
    }
    for (const node of ui.splitPlayersForNodes || []) {
        node.classList.toggle('hidden', node.dataset.splitPlayersFor !== String(playerCount));
    }

    ensureOptions(ui.splitInputLayoutSelect, SPLITSCREEN_INPUT_LAYOUTS.map((layout) => [layout.value, layout.label]));
    if (ui.splitInputLayoutSelect) {
        ui.splitInputLayoutSelect.value = normalizeSplitscreenInputLayout(settings?.controls?.SPLITSCREEN?.layout);
    }
    const threePlayerSettings = normalizeThreePlayerSplitSettings(settings?.localSettings?.threePlayerSplit);
    (ui.splitDeviceSelects || []).forEach((select, index) => {
        ensureOptions(select, Object.entries(THREE_PLAYER_SPLIT_DEVICE_LABELS));
        select.value = threePlayerSettings.deviceAssignment[index];
        const hint = ui.splitKeyboardHints?.[index];
        if (!hint) return;
        hint.hidden = select.value !== 'keyboard';
        const keys = settings?.controls?.[`PLAYER_${index + 1}`];
        if (keys) hint.textContent = `Tastatur: ${['UP', 'DOWN', 'LEFT', 'RIGHT'].map((key) => formatKeyCodeShort(keys[key])).join(' / ')}`;
    });
    if (ui.splitViewportLayoutSelect) ui.splitViewportLayoutSelect.value = threePlayerSettings.viewportLayout;
    renderSplitDeviceStatus(ui, settings, getGamepad);
}

function ensureThreePlayerSplit(settings) {
    if (!settings.localSettings) settings.localSettings = {};
    settings.localSettings.threePlayerSplit = normalizeThreePlayerSplitSettings(settings.localSettings.threePlayerSplit);
    return settings.localSettings.threePlayerSplit;
}

/**
 * A gamepad picked for one player moves away from whoever had it, so the pick
 * always wins instead of being normalized back.
 */
export function assignThreePlayerSplitDevice(deviceAssignment, playerIndex, device) {
    const next = normalizeThreePlayerSplitDeviceAssignment(deviceAssignment);
    const previousOwner = String(device).startsWith('gamepad-') ? next.indexOf(device) : -1;
    if (previousOwner >= 0 && previousOwner !== playerIndex) next[previousOwner] = next[playerIndex];
    next[playerIndex] = device;
    return normalizeThreePlayerSplitDeviceAssignment(next);
}

export function bindSplitPlayersSection({
    ui,
    settings,
    bind,
    emitSettingsChangedImmediate,
    settingsChangeKeys,
    runtimeAccess = null,
    getGamepad = readGamepad,
    resolveModePath = () => settings?.localSettings?.modePath,
}) {
    // Player count and devices are part of the session: the session key also clears a
    // start block that a missing pad left behind.
    const changed = () => emitSettingsChangedImmediate([settingsChangeKeys?.SESSION_TYPE].filter(Boolean));
    for (const button of ui?.splitPlayerCountButtons || []) {
        bind(button, 'click', () => {
            if (button.disabled) return;
            if (!settings.localSettings) settings.localSettings = {};
            // Four players use the variant the planar module itself stores in openSetup.
            settings.localSettings.splitScreenVariant = {
                3: SPLIT_SCREEN_VARIANTS.THREE_PLAYER,
                4: SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR,
            }[Number(button.dataset.splitPlayerCount)] || SPLIT_SCREEN_VARIANTS.STANDARD;
            changed();
        });
    }
    bind(ui?.splitInputLayoutSelect, 'change', () => {
        if (!settings.controls) settings.controls = {};
        settings.controls.SPLITSCREEN = {
            ...settings.controls.SPLITSCREEN,
            layout: normalizeSplitscreenInputLayout(ui.splitInputLayoutSelect.value),
        };
        changed();
    });
    (ui?.splitDeviceSelects || []).forEach((select, index) => {
        bind(select, 'change', () => {
            const threePlayerSplit = ensureThreePlayerSplit(settings);
            threePlayerSplit.deviceAssignment = assignThreePlayerSplitDevice(
                threePlayerSplit.deviceAssignment,
                index,
                select.value
            );
            changed();
        });
    });
    bind(ui?.splitViewportLayoutSelect, 'change', () => {
        settings.localSettings.threePlayerSplit = normalizeThreePlayerSplitSettings({
            ...ensureThreePlayerSplit(settings),
            viewportLayout: ui.splitViewportLayoutSelect.value,
        });
        changed();
    });
    bindSplitProfileSeats({ ui, settings, runtimeAccess, bind, changed });
    bind(ui?.vehicleSelectP3, 'change', () => {
        const writeback = writeHangarVehicleSelection(
            settings,
            HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_3,
            ui.vehicleSelectP3.value,
            'ship5',
            { modePath: resolveModePath() }
        );
        if (writeback.changed) changed();
    });
    const view = ui?.splitPlayersSection?.ownerDocument?.defaultView || null;
    // Only while the section is offered in the menu; a pad plugged in mid-match changes nothing.
    const refreshStatus = () => {
        const section = ui?.splitPlayersSection;
        const offered = isSplitScreen(settings) && section && !section.classList.contains('hidden')
            && !section.closest?.('#submenu-custom')?.classList?.contains('hidden');
        if (offered) changed();
        else renderSplitDeviceStatus(ui, settings, getGamepad);
    };
    bind(view, 'gamepadconnected', refreshStatus);
    bind(view, 'gamepaddisconnected', refreshStatus);
}

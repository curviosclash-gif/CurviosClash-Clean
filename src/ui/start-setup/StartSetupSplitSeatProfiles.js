// Profile per seat for the local split screen. Seat 1 is always the active player profile (shown
// only); seats 2 and 3 pick one of the player profiles or create a new one. The choice lives in the
// field the Arcade menu already uses (startSetup.arcadePlayerProfileIds, mirrored to the older
// demolitionProfileIds), so both menus read and write the same truth.

import { isThreePlayerSplitVariant } from '../../four-player-planar/FourPlayerPlanarContract.js';

export const NEW_PROFILE_VALUE = '__new_profile__';

const SEAT_COUNT_MAX = 3;
const DUPLICATE_HINT = 'Ein Profil kann pro Match nur einmal mitspielen.';
const NEW_PROFILE_FAILURE_HINTS = Object.freeze({
    profile_limit: 'Mehr Profile sind nicht möglich (Grenze erreicht).',
});
const NEW_PROFILE_FAILED_HINT = 'Das Profil konnte nicht angelegt werden.';

function toId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** Stored ids as exactly three strings; the Arcade field wins when it holds anything. */
function readSavedIds(startSetup) {
    const current = startSetup?.arcadePlayerProfileIds;
    const source = Array.isArray(current) && current.some((id) => toId(id)) ? current : startSetup?.demolitionProfileIds;
    return Array.from({ length: SEAT_COUNT_MAX }, (_, index) => toId(Array.isArray(source) ? source[index] : ''));
}

function resolveSeatCount(settings) {
    return isThreePlayerSplitVariant(settings) ? 3 : 2;
}

/**
 * Which profile sits at which seat, judged against the profiles that exist.
 * @returns {{ ids: string[], missingSeats: number[], duplicateSeats: number[] }}
 */
export function resolveSeatProfiles({ startSetup, profiles = [], activeId = '', seatCount = 2 }) {
    const known = new Set(profiles.map((profile) => profile.id));
    const saved = readSavedIds(startSetup);
    const ids = saved.map((id, index) => (index === 0 ? toId(activeId) : (known.has(id) ? id : '')));
    const missingSeats = [];
    const duplicateSeats = [];
    for (let seat = 1; seat < seatCount; seat += 1) {
        if (saved[seat] && !ids[seat]) missingSeats.push(seat);
    }
    for (let seat = 0; seat < seatCount; seat += 1) {
        if (ids[seat] && ids.some((id, other) => other !== seat && other < seatCount && id === ids[seat])) {
            duplicateSeats.push(seat);
        }
    }
    return { ids, missingSeats, duplicateSeats };
}

/**
 * Checks one pick for a seat and returns the three ids to store.
 * @returns {{ ok: true, ids: string[] } | { ok: false, reason: 'active_seat'|'unknown_profile'|'duplicate' }}
 */
export function planSeatProfilePick({ startSetup, profiles = [], activeId = '', seatCount = 2, seatIndex, profileId }) {
    if (!Number.isInteger(seatIndex) || seatIndex < 1 || seatIndex >= SEAT_COUNT_MAX) return { ok: false, reason: 'active_seat' };
    const id = toId(profileId);
    if (id && !profiles.some((profile) => profile.id === id)) return { ok: false, reason: 'unknown_profile' };
    const ids = readSavedIds(startSetup);
    ids[0] = toId(activeId);
    ids[seatIndex] = id;
    if (id && ids.some((other, seat) => seat !== seatIndex && seat < seatCount && other === id)) {
        return { ok: false, reason: 'duplicate' };
    }
    return { ok: true, ids };
}

export function writeSeatProfileIds(startSetup, ids) {
    const next = Array.from({ length: SEAT_COUNT_MAX }, (_, index) => toId(ids?.[index]));
    startSetup.arcadePlayerProfileIds = next;
    startSetup.demolitionProfileIds = next.slice();
    return next;
}

function fillSelect(select, entries, chosen) {
    const key = JSON.stringify(entries);
    if (select.dataset && select.dataset.seatOptions !== key) {
        const doc = select.ownerDocument;
        select.replaceChildren(...entries.map(([value, label, disabled]) => {
            const option = doc.createElement('option');
            option.value = value;
            option.textContent = label;
            option.disabled = disabled;
            return option;
        }));
        select.dataset.seatOptions = key;
    }
    select.value = chosen;
}

function showHint(hint, text) {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('hidden', !text);
}

export function renderSplitProfileSeats({ ui, settings, runtimeAccess, notice = '' }) {
    const selects = ui?.splitProfileSelects || [];
    if (!ui?.splitProfileActiveName && selects.length === 0) return;
    const profiles = runtimeAccess?.getPlayerProfiles?.() || [];
    const activeProfile = runtimeAccess?.getActivePlayerProfile?.() || null;
    const seatCount = resolveSeatCount(settings);
    const state = resolveSeatProfiles({
        startSetup: settings?.localSettings?.startSetup,
        profiles,
        activeId: activeProfile?.id,
        seatCount,
    });
    if (ui.splitProfileActiveName) {
        ui.splitProfileActiveName.textContent = activeProfile
            ? String(activeProfile.displayName || 'Spielerprofil')
            : 'Kein aktives Profil';
    }
    selects.forEach((select, index) => {
        const seat = index + 1;
        const chosen = state.ids[seat];
        const takenElsewhere = new Set(state.ids.filter((id, other) => id && other !== seat && other < seatCount));
        const entries = [];
        if (!chosen) {
            entries.push(['', state.missingSeats.includes(seat) ? 'Profil fehlt – neu zuordnen' : 'Profil wählen', false]);
        }
        for (const profile of profiles) {
            entries.push([profile.id, String(profile.displayName || 'Spielerprofil'), takenElsewhere.has(profile.id) && profile.id !== chosen]);
        }
        entries.push([NEW_PROFILE_VALUE, 'Neues Profil …', false]);
        fillSelect(select, entries, chosen);
    });
    showHint(ui.splitProfileHint, notice || (state.duplicateSeats.length > 0 ? DUPLICATE_HINT : ''));
}

/**
 * @param {{ ui: object, settings: object, runtimeAccess?: object, bind: Function, changed: Function }} options
 * @returns {{ render: () => void }}
 */
export function bindSplitProfileSeats({ ui, settings, runtimeAccess, bind, changed }) {
    const render = (notice = '') => renderSplitProfileSeats({ ui, settings, runtimeAccess, notice });
    (ui?.splitProfileSelects || []).forEach((select, index) => {
        const seatIndex = index + 1;
        bind(select, 'focus', () => render());
        bind(select, 'change', () => {
            let profileId = select.value;
            if (profileId === NEW_PROFILE_VALUE) {
                const created = runtimeAccess?.createPlayerProfile?.(`Spieler ${seatIndex + 1}`);
                if (!created?.ok) {
                    render(NEW_PROFILE_FAILURE_HINTS[created?.reason] || NEW_PROFILE_FAILED_HINT);
                    return;
                }
                profileId = created.profile.id;
            }
            const plan = planSeatProfilePick({
                startSetup: settings?.localSettings?.startSetup,
                profiles: runtimeAccess?.getPlayerProfiles?.() || [],
                activeId: runtimeAccess?.getActivePlayerProfile?.()?.id,
                seatCount: resolveSeatCount(settings),
                seatIndex,
                profileId,
            });
            if (plan.ok === false) {
                render(plan.reason === 'duplicate' ? DUPLICATE_HINT : '');
                return;
            }
            if (!settings.localSettings) settings.localSettings = {};
            if (!settings.localSettings.startSetup) settings.localSettings.startSetup = {};
            writeSeatProfileIds(settings.localSettings.startSetup, plan.ids);
            render();
            changed();
        });
    });
    // The profile list can change in the settings or the Arcade menu while this one stays loaded.
    for (const button of ui?.sessionButtons || []) bind(button, 'click', () => render());
    render();
    return { render };
}

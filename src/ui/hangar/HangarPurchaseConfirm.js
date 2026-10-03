// Shared hangar confirmation (Plan, Hangar-Bedienung: "Alles, was XP kostet, ist endgültig und
// braucht eine Bestätigung mit Kosten sowie alten und neuen Werten"). Taken out of the size panel
// (Paket 2a) so the stones (Paket 3) and later the weapon tiers use the same rules:
// - the offer is evaluated again at the moment of "Kaufen", so a stale preview never spends XP,
//   and re-rendering (refresh) keeps an open dialog on current numbers or closes it;
// - a held Enter key (key repeat) never confirms, only a fresh key press does;
// - Escape cancels, and the focus returns to the button that opened the dialog.
// It also asks for the free stone transfer between vehicles before an activation.
import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import {
    diffArcadeVehicleBuildStats,
    resolveArcadeSpendableXp,
} from '../../shared/contracts/ArcadeVehicleBuildContract.js';

export const HANGAR_STAT_LABELS = Object.freeze({
    maxHpPct: 'Leben',
    regenDelay: 'Heilung nach Treffer',
    damagePct: 'Schaden',
    rangePct: 'Reichweite',
    turnPct: 'Wendigkeit',
    rollPct: 'Rollen',
    speedPct: 'Tempo',
    boostDurationPct: 'Boost-Dauer',
    shieldPct: 'Schild',
    itemCapacity: 'Item-Plätze',
    rocketCapacity: 'Raketen-Plätze',
});
// Health and storages are absolute numbers; the regeneration wait is seconds; the rest is percent.
const ABSOLUTE_STATS = new Set(['maxHpPct', 'itemCapacity', 'rocketCapacity']);

/** @param {unknown} value */
export function formatHangarNumber(value) {
    return Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function formatHangarStat(key, value) {
    if (key === 'regenDelay') return `${formatHangarNumber(value)} s`;
    return ABSOLUTE_STATS.has(key) ? formatHangarNumber(value) : `${formatHangarNumber(value)} %`;
}

/**
 * "Wert: alt → neu" for every stat that changes between two stat sets of the one calculation.
 * @param {any} before
 * @param {any} after
 * @returns {string[]}
 */
export function describeHangarStatChanges(before, after) {
    return diffArcadeVehicleBuildStats(before, after).map((entry) => (
        `${HANGAR_STAT_LABELS[/** @type {keyof typeof HANGAR_STAT_LABELS} */ (entry.key)]}: `
        + `${formatHangarStat(entry.key, entry.before)} → ${formatHangarStat(entry.key, entry.after)}`
    ));
}

/**
 * The lines of an XP purchase: cost, XP old → new, the offer's own lines, finality.
 * @param {{ cost: number, next: any }} result
 * @param {any} profile the paying vehicle before the purchase
 * @param {string[]} [lines]
 */
export function formatHangarPurchaseLines(result, profile, lines = []) {
    return [
        `Kosten: ${formatHangarNumber(result.cost)} XP`,
        `XP: ${formatHangarNumber(resolveArcadeSpendableXp(profile))} → ${formatHangarNumber(resolveArcadeSpendableXp(result.next))}`,
        ...lines,
        'XP-Käufe sind endgültig.',
    ];
}

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

let dialogCount = 0;

/**
 * @typedef {{ ok: boolean, reason?: string }} HangarConfirmResult
 * @typedef {{ trigger?: any, heading: string, acceptLabel?: string,
 *   evaluate: () => any, lines: (result: any) => string[],
 *   commit: (result: any) => unknown, successText?: string|((result: any) => string) }} HangarConfirmRequest
 *   evaluate: the offer with the state of this moment (called on ask, refresh and accept);
 *   commit: returns false or { ok: false } when saving failed.
 */

/**
 * @param {{ bind: Function, toast: (message: string, tone?: string) => void, className?: string,
 *   describeReason?: (result: any) => string }} options
 *   className: prefix of the dialog classes (e.g. "hangar-size-confirm" → "-title", "-lines", "-accept").
 */
export function createHangarPurchaseConfirm({
    bind, toast, className = 'hangar-purchase-confirm', describeReason = () => 'Nicht möglich',
}) {
    dialogCount += 1;
    const root = el('div', `${className} hidden`);
    root.setAttribute('role', 'alertdialog');
    const title = el('h5', `${className}-title`, '');
    title.id = `${className}-title-${dialogCount}`;
    const list = el('ul', `${className}-lines`);
    list.id = `${className}-lines-${dialogCount}`;
    root.setAttribute('aria-labelledby', title.id);
    root.setAttribute('aria-describedby', list.id);
    const accept = button(`primary-btn ${className}-accept`, 'Kaufen');
    const cancel = button(`secondary-btn ${className}-cancel`, 'Abbrechen');
    root.append(title, list, accept, cancel);
    /** @type {HangarConfirmRequest|null} */
    let pending = null;

    function hide(returnFocus = true) {
        const trigger = pending?.trigger;
        pending = null;
        root.classList.add('hidden');
        if (returnFocus && trigger && !trigger.disabled) trigger.focus();
    }

    // Builds the open dialog from the state of this moment; an offer that no longer holds is returned.
    function render() {
        const request = /** @type {HangarConfirmRequest} */ (pending);
        const result = request.evaluate();
        if (!result?.ok) return result || { ok: false };
        title.textContent = request.heading;
        accept.textContent = request.acceptLabel || 'Kaufen';
        list.replaceChildren(...request.lines(result).map((line) => el('li', '', line)));
        return result;
    }

    /** @param {HangarConfirmRequest} request @returns {boolean} the dialog is open */
    function ask(request) {
        pending = request;
        const result = render();
        if (!result.ok) {
            pending = null;
            toast(describeReason(result), 'warning');
            return false;
        }
        root.classList.remove('hidden');
        accept.focus();
        return true;
    }

    bind(accept, 'click', () => {
        if (!pending) return;
        const { evaluate, commit, successText } = pending;
        const result = evaluate();
        hide();
        if (!result?.ok) {
            toast(describeReason(result), 'warning');
            return;
        }
        const saved = /** @type {any} */ (commit(result));
        if (saved === false || saved?.ok === false) {
            toast(describeReason(saved || result), 'warning');
            return;
        }
        const text = typeof successText === 'function' ? successText(result) : successText;
        if (text) toast(text, 'success');
    });
    bind(cancel, 'click', () => hide());
    bind(root, 'keydown', (/** @type {any} */ event) => {
        // A held Enter repeats and would click "Kaufen": only a fresh key press confirms.
        if (event.key === 'Enter' && event.repeat) {
            event.preventDefault();
            return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        hide();
    });

    return Object.freeze({
        root,
        ask,
        /** Re-evaluates an open dialog; closes it without moving focus when the offer no longer holds. */
        refresh() {
            if (pending && !render().ok) hide(false);
        },
        hide,
        isOpen: () => pending !== null,
    });
}

// Hangar tab "Ausbau", section "Größe" (Paket 2a): unlock the size workshop, move part sizes in
// 5 % steps with a value preview before "Übernehmen", undo free redistributions and buy size
// steps or storage tiers after a confirmation that names cost, old and new values.
// The editor and every storage tier are visible from the start; before their condition is met
// they are dimmed, name it and cannot be used (HangarLockedSection).
// All rules come from ArcadeVehicleBuildContract; this module only shows and asks.
import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { createHangarLockedSection } from './HangarLockedSection.js';
import {
    ARCADE_PART_SIZE_GROUPS,
    ARCADE_PART_SIZE_MAX_PCT,
    ARCADE_PART_SIZE_MIN_PCT,
    ARCADE_PART_SIZE_STEP_PCT,
} from '../../shared/contracts/ArcadeVehicleSizeContract.js';
import {
    ARCADE_SIZE_MAX_PURCHASED_STEPS,
    ARCADE_SIZE_UNLOCK_COST_XP,
} from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    countArcadeSizeSteps,
    diffArcadeVehicleBuildStats,
    evaluateArcadeSizeResize,
    evaluateArcadeSizeStepPurchase,
    evaluateArcadeSizeUnlock,
    evaluateArcadeStoragePurchase,
    normalizeArcadeSizeProfileFields,
    resolveArcadeSpendableXp,
    resolveArcadeStorageOffer,
    resolveArcadeVehicleBuildStats,
} from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { measureArcadeHitboxSurface } from '../../shared/contracts/ArcadeVehicleHitboxContract.js';

const GROUP_LABELS = Object.freeze({
    hull: 'Rumpf', nose: 'Nase', wings: 'Flügelpaar', engines: 'Antriebspaar', utility: 'Utility',
});
const GROUP_EFFECTS = Object.freeze({
    hull: 'Leben, Heilung setzt früher ein',
    nose: 'Schaden, Reichweite',
    wings: 'Wendigkeit, Rollen',
    engines: 'Tempo, Boost-Dauer',
    utility: 'Schild, Lagerstufen',
});
const STAT_LABELS = Object.freeze({
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
const STORAGE_LABELS = Object.freeze({ items: 'Item-Lager', rockets: 'Raketen-Lager' });
const REASON_TEXT = Object.freeze({
    insufficient_xp: 'Nicht genug XP',
    max_steps: `Alle ${ARCADE_SIZE_MAX_PURCHASED_STEPS} Schritte gekauft`,
    max_tiers: 'Alle drei Stufen gekauft',
    storage_full: 'Lager hat schon 10 Plätze',
    utility_too_small: 'Utility zu klein',
    locked: 'Erst den Größenumbau freischalten',
    already_unlocked: 'Schon freigeschaltet',
    over_capacity: 'Mehr Schritte belegt als gekauft',
    invalid_size: 'Ungültige Größe',
});
// Health, storages and XP are absolute numbers; the other stats are percent of the ship's base.
const ABSOLUTE_STATS = new Set(['maxHpPct', 'itemCapacity', 'rocketCapacity']);

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

function formatNumber(value) {
    return Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function formatStat(key, value) {
    if (key === 'regenDelay') return `${formatNumber(value)} s`;
    return ABSOLUTE_STATS.has(key) ? formatNumber(value) : `${formatNumber(value)} %`;
}

function reasonText(result) {
    return REASON_TEXT[result?.reason] || 'Nicht möglich';
}

/**
 * @param {{ bind: Function, getProfile: () => any, saveProfile: (profile: any) => void,
 *   toast: (message: string, tone?: string) => void, onDraftChange: () => void,
 *   partsOf?: (vehicleId: string) => ReadonlyArray<any> }} options
 *   partsOf: the ship's factory parts, for the hit zone line of the value preview.
 */
export function createHangarSizePanel({ bind, getProfile, saveProfile, toast, onDraftChange, partsOf = () => [] }) {
    const root = el('section', 'hangar-size-panel');
    root.setAttribute('aria-labelledby', 'hangar-size-title');
    const title = el('h4', 'arcade-vehicle-subtitle', 'Größe');
    title.id = 'hangar-size-title';
    title.tabIndex = -1;
    const hint = el('p', 'field-hint', 'Größere Bauteile verbessern ihre Werte und sind sichtbar größer. Umverteilen ist kostenlos; XP-Käufe sind endgültig.');
    const xpLine = el('p', 'hangar-size-xp', '');

    const unlockButton = button('primary-btn hangar-size-unlock', 'Freischalten');
    // The short visible text needs the condition line beside it; screen readers get the full name.
    unlockButton.setAttribute('aria-label', `Größenumbau freischalten (${formatNumber(ARCADE_SIZE_UNLOCK_COST_XP)} XP)`);
    const editorLock = createHangarLockedSection({ className: 'hangar-size-lock', action: unlockButton });

    const editor = el('div', 'hangar-size-editor');
    const stepsLine = el('p', 'hangar-size-steps', '');
    stepsLine.setAttribute('aria-live', 'polite');
    const groupList = el('div', 'hangar-size-groups');
    groupList.setAttribute('role', 'group');
    groupList.setAttribute('aria-label', 'Bauteilgruppen');
    const rows = new Map();
    for (const group of ARCADE_PART_SIZE_GROUPS) {
        const row = el('div', 'hangar-size-row');
        row.dataset.sizeGroup = group;
        const minus = button('secondary-btn hangar-size-minus', '−');
        minus.dataset.sizeStep = '-1';
        minus.setAttribute('aria-label', `${GROUP_LABELS[group]} um 5 % verkleinern`);
        const plus = button('secondary-btn hangar-size-plus', '+');
        plus.dataset.sizeStep = '1';
        plus.setAttribute('aria-label', `${GROUP_LABELS[group]} um 5 % vergrößern`);
        const value = el('output', 'hangar-size-value', '100 %');
        value.setAttribute('aria-label', `Größe ${GROUP_LABELS[group]}`);
        row.append(
            el('span', 'hangar-size-label', GROUP_LABELS[group]),
            minus,
            value,
            plus,
            el('span', 'hangar-size-effect', GROUP_EFFECTS[group]),
        );
        rows.set(group, { minus, plus, value });
        groupList.appendChild(row);
    }
    const preview = el('ul', 'hangar-size-preview');
    preview.setAttribute('aria-label', 'Wertvorschau');
    preview.setAttribute('aria-live', 'polite');
    const actions = el('div', 'hangar-size-actions');
    const applyButton = button('primary-btn hangar-size-apply', 'Übernehmen');
    const resetButton = button('secondary-btn hangar-size-reset', 'Verwerfen');
    const undoButton = button('secondary-btn hangar-size-undo', 'Rückgängig');
    actions.append(applyButton, resetButton, undoButton);

    const shop = el('div', 'hangar-size-shop');
    const buyStep = button('secondary-btn hangar-size-buy-step', '');
    const buyItems = button('secondary-btn hangar-size-buy-storage', '');
    buyItems.dataset.storage = 'items';
    const buyRockets = button('secondary-btn hangar-size-buy-storage', '');
    buyRockets.dataset.storage = 'rockets';
    // A storage tier waits for its utility size: visible, dimmed, with the size it needs.
    const storageLocks = new Map([buyItems, buyRockets].map((node) => {
        const lock = createHangarLockedSection({ className: 'hangar-size-storage' });
        lock.body.appendChild(node);
        return [node, lock];
    }));
    shop.append(el('h5', 'hangar-size-shop-title', 'Mit XP kaufen'), buyStep, ...Array.from(storageLocks.values(), (lock) => lock.root));
    editor.append(stepsLine, groupList, el('h5', 'hangar-size-preview-title', 'Vorschau'), preview, actions, shop);
    editorLock.body.appendChild(editor);

    const confirmBox = el('div', 'hangar-size-confirm hidden');
    confirmBox.setAttribute('role', 'alertdialog');
    confirmBox.setAttribute('aria-labelledby', 'hangar-size-confirm-title');
    confirmBox.setAttribute('aria-describedby', 'hangar-size-confirm-lines');
    const confirmTitle = el('h5', 'hangar-size-confirm-title', '');
    confirmTitle.id = 'hangar-size-confirm-title';
    const confirmLines = el('ul', 'hangar-size-confirm-lines');
    confirmLines.id = 'hangar-size-confirm-lines';
    const confirmAccept = button('primary-btn hangar-size-confirm-accept', 'Kaufen');
    const confirmCancel = button('secondary-btn hangar-size-confirm-cancel', 'Abbrechen');
    confirmBox.append(confirmTitle, confirmLines, confirmAccept, confirmCancel);
    root.append(title, hint, xpLine, editorLock.root, confirmBox);

    let vehicleId = '';
    let profile = {};
    let draft = null;
    let pending = null;
    const history = new Map();

    const committedSizes = () => normalizeArcadeSizeProfileFields(profile).partSizes;
    const statsOf = (source) => resolveArcadeVehicleBuildStats(vehicleId, source);
    const isDirty = () => ARCADE_PART_SIZE_GROUPS.some((group) => draft[group] !== committedSizes()[group]);

    function statLines(before, after) {
        return diffArcadeVehicleBuildStats(statsOf(before), statsOf(after))
            .map((entry) => `${STAT_LABELS[entry.key]}: ${formatStat(entry.key, entry.before)} → ${formatStat(entry.key, entry.after)}`);
    }

    // Hit zone in percent of the factory ship: bigger parts are easier to hit (full part boxes).
    function hitboxLines(before, after) {
        const parts = partsOf(vehicleId);
        if (parts.length === 0) return [];
        const factory = measureArcadeHitboxSurface(parts, null);
        const pct = (sizes) => Math.round((measureArcadeHitboxSurface(parts, sizes) / factory) * 1000) / 10;
        const from = pct(before);
        const to = pct(after);
        return from === to ? [] : [`Trefferzone: ${formatNumber(from)} % → ${formatNumber(to)} %`];
    }

    function renderPreview() {
        const fields = normalizeArcadeSizeProfileFields(profile);
        const lines = [...statLines(profile, { ...fields, partSizes: draft }), ...hitboxLines(fields.partSizes, draft)];
        preview.replaceChildren(...(lines.length > 0 ? lines : ['Keine Änderung']).map((line) => el('li', '', line)));
    }

    function renderShop(unlocked) {
        const step = evaluateArcadeSizeStepPurchase(profile);
        buyStep.textContent = step.ok || step.reason === 'insufficient_xp'
            ? `Größenschritt kaufen (${formatNumber(step.cost)} XP)`
            : `Größenschritt: ${reasonText(step)}`;
        buyStep.disabled = !step.ok;
        for (const [node, lock] of storageLocks) {
            const storage = node.dataset.storage;
            const offer = resolveArcadeStorageOffer(profile, storage);
            const result = evaluateArcadeStoragePurchase(profile, storage);
            node.disabled = !result.ok;
            // Before the workshop unlock its own lock covers the shop; one dimming is enough.
            const waitsForUtility = unlocked && !!offer && !offer.utilityReached;
            lock.setLocked(waitsForUtility, waitsForUtility ? `Utility auf ${offer.requiredUtilityPct} % bringen` : '');
            if (!offer) {
                node.textContent = `${STORAGE_LABELS[storage]}: voll ausgebaut`;
                node.removeAttribute('aria-description');
                node.removeAttribute('title');
                continue;
            }
            node.textContent = `${STORAGE_LABELS[storage]} Stufe ${offer.tier} kaufen (${formatNumber(offer.cost)} XP)`;
            node.setAttribute('aria-description', offer.utilityReached
                ? (result.ok ? 'Kaufbar' : reasonText(result))
                : `Braucht Utility ab ${offer.requiredUtilityPct} % (übernommen)`);
            node.title = node.getAttribute('aria-description') || '';
        }
    }

    function update() {
        const fields = normalizeArcadeSizeProfileFields(profile);
        xpLine.textContent = `Verfügbare XP: ${formatNumber(resolveArcadeSpendableXp(profile))}`;
        editorLock.setLocked(!fields.sizeWorkshopUnlocked, `Größenumbau freischalten: ${formatNumber(ARCADE_SIZE_UNLOCK_COST_XP)} XP`);
        const unlock = evaluateArcadeSizeUnlock(profile);
        unlockButton.disabled = !unlock.ok;
        unlockButton.setAttribute('aria-description', unlock.ok ? 'Kaufbar' : reasonText(unlock));
        const used = countArcadeSizeSteps(draft);
        stepsLine.textContent = `Schritte belegt ${used} / gekauft ${fields.purchasedSizeSteps} (höchstens ${ARCADE_SIZE_MAX_PURCHASED_STEPS})`;
        for (const [group, row] of rows) {
            row.value.textContent = `${draft[group]} %`;
            row.minus.disabled = draft[group] <= ARCADE_PART_SIZE_MIN_PCT;
            row.plus.disabled = draft[group] >= ARCADE_PART_SIZE_MAX_PCT || used >= fields.purchasedSizeSteps;
        }
        const dirty = isDirty();
        applyButton.disabled = !dirty;
        resetButton.disabled = !dirty;
        undoButton.disabled = !(history.get(vehicleId)?.length > 0);
        renderPreview();
        renderShop(fields.sizeWorkshopUnlocked);
        keepFocus();
    }

    function isUsable(node) {
        for (let current = node; current && current !== root; current = current.parentElement) {
            if (current.disabled || current.classList?.contains('hidden')) return false;
        }
        return true;
    }

    // A control that disables or hides itself (limit reached, purchase done, unlock) would drop
    // the keyboard focus to the page start. Move it to the other button of the same size row,
    // otherwise to the section title.
    function keepFocus() {
        const focused = document.activeElement;
        if (!focused || !root.contains(focused) || isUsable(focused)) return;
        let counterpart = title;
        for (const row of rows.values()) {
            if (focused === row.plus && isUsable(row.minus)) counterpart = row.minus;
            if (focused === row.minus && isUsable(row.plus)) counterpart = row.plus;
        }
        counterpart.focus();
    }

    function hideConfirm(returnFocus = true) {
        const trigger = pending?.trigger;
        pending = null;
        confirmBox.classList.add('hidden');
        if (returnFocus && trigger && !trigger.disabled) trigger.focus();
    }

    // Builds the open confirmation from the current profile; render() calls it again, so an open
    // confirmation never shows stale XP or values.
    function renderConfirm() {
        const result = pending.evaluate(profile);
        if (!result.ok) return result;
        confirmTitle.textContent = pending.heading;
        const lines = [
            `Kosten: ${formatNumber(result.cost)} XP`,
            `XP: ${formatNumber(resolveArcadeSpendableXp(profile))} → ${formatNumber(resolveArcadeSpendableXp(result.next))}`,
            ...pending.extraLines(result.next),
            ...statLines(profile, result.next),
            'XP-Käufe sind endgültig.',
        ];
        confirmLines.replaceChildren(...lines.map((line) => el('li', '', line)));
        return result;
    }

    // Every XP purchase goes through here: preview with the current profile, confirm, then
    // evaluate again with the profile of that moment so a stale preview never spends XP.
    function askPurchase(trigger, heading, evaluate, extraLines, successText) {
        pending = { trigger, heading, evaluate, extraLines, successText };
        const result = renderConfirm();
        if (!result.ok) {
            pending = null;
            toast(reasonText(result), 'warning');
            return;
        }
        confirmBox.classList.remove('hidden');
        confirmAccept.focus();
    }

    bind(confirmAccept, 'click', () => {
        if (!pending) return;
        const { evaluate, successText } = pending;
        const result = evaluate(getProfile());
        hideConfirm();
        if (!result.ok) {
            toast(reasonText(result), 'warning');
            return;
        }
        saveProfile(result.next);
        toast(successText, 'success');
    });
    bind(confirmCancel, 'click', () => hideConfirm());
    bind(confirmBox, 'keydown', (event) => {
        // A held Enter repeats and would click "Kaufen": only a fresh key press confirms XP.
        if (event.key === 'Enter' && event.repeat) {
            event.preventDefault();
            return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        hideConfirm();
    });

    bind(unlockButton, 'click', () => askPurchase(
        unlockButton,
        'Größenumbau freischalten?',
        evaluateArcadeSizeUnlock,
        () => ['Größenumbau: gesperrt → freigeschaltet'],
        'Größenumbau freigeschaltet',
    ));
    bind(buyStep, 'click', () => askPurchase(
        buyStep,
        'Größenschritt kaufen?',
        evaluateArcadeSizeStepPurchase,
        (next) => [`Gekaufte Schritte: ${normalizeArcadeSizeProfileFields(profile).purchasedSizeSteps} → ${next.purchasedSizeSteps}`],
        'Größenschritt gekauft',
    ));
    for (const node of [buyItems, buyRockets]) {
        const storage = node.dataset.storage;
        const field = storage === 'items' ? 'purchasedItemSlots' : 'purchasedRocketSlots';
        bind(node, 'click', () => askPurchase(
            node,
            `${STORAGE_LABELS[storage]}-Stufe kaufen?`,
            (source) => evaluateArcadeStoragePurchase(source, storage),
            (next) => [`Gekaufte Stufen ${STORAGE_LABELS[storage]}: ${normalizeArcadeSizeProfileFields(profile)[field]} → ${next[field]}`],
            `${STORAGE_LABELS[storage]}-Stufe gekauft`,
        ));
    }

    bind(groupList, 'click', (event) => {
        const control = event.target?.closest?.('[data-size-step]');
        const group = control?.closest?.('[data-size-group]')?.dataset.sizeGroup;
        if (!control || control.disabled || !group) return;
        draft = { ...draft, [group]: draft[group] + Number(control.dataset.sizeStep) * ARCADE_PART_SIZE_STEP_PCT };
        update();
        onDraftChange();
    });
    bind(applyButton, 'click', () => {
        const before = committedSizes();
        const result = evaluateArcadeSizeResize(getProfile(), draft);
        if (!result.ok) {
            toast(reasonText(result), 'warning');
            return;
        }
        history.set(vehicleId, [...(history.get(vehicleId) || []), before]);
        saveProfile(result.next);
        toast('Größe übernommen · mit „Rückgängig“ jederzeit kostenlos zurück', 'success');
    });
    bind(resetButton, 'click', () => {
        draft = committedSizes();
        update();
        onDraftChange();
    });
    bind(undoButton, 'click', () => {
        const stack = history.get(vehicleId) || [];
        const previous = stack[stack.length - 1];
        if (!previous) return;
        const result = evaluateArcadeSizeResize(getProfile(), previous);
        if (!result.ok) {
            toast(reasonText(result), 'warning');
            return;
        }
        history.set(vehicleId, stack.slice(0, -1));
        draft = { ...previous };
        saveProfile(result.next);
        toast('Letzte Größenänderung zurückgenommen', 'success');
    });

    return Object.freeze({
        root,
        /** Sizes the 3D preview shows: the unapplied draft while editing. */
        getDraftSizes: () => ({ ...(draft || committedSizes()) }),
        /**
         * @param {string} nextVehicleId
         * @param {any} nextProfile
         * @param {boolean} [editing] false outside the "Ausbau" tab: an unapplied draft is dropped,
         *   so no other view shows a ship that differs from the one that flies.
         */
        render(nextVehicleId, nextProfile, editing = true) {
            const id = String(nextVehicleId || '');
            const previousCommitted = draft ? committedSizes() : null;
            profile = nextProfile && typeof nextProfile === 'object' ? nextProfile : {};
            if (id !== vehicleId) {
                vehicleId = id;
                draft = null;
                hideConfirm(false);
            }
            if (!editing) draft = null;
            // A clean draft follows the saved sizes (apply, undo, purchases); an edited one stays.
            const wasClean = !draft || !previousCommitted
                || ARCADE_PART_SIZE_GROUPS.every((group) => draft[group] === previousCommitted[group]);
            if (wasClean) draft = committedSizes();
            if (pending && !renderConfirm().ok) hideConfirm(false);
            update();
        },
    });
}

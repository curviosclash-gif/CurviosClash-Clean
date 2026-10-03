// Hangar tab "Ausbau", section "Steine" (Paket 3): the seven stone slots of the selected vehicle,
// the workshop pool with its XP purchases (new stone, upgrade, slot packages) and the rules the
// workshop asks before a draft changes or a build is activated. Locked slot packages and tiers
// stay visible, dimmed and name their condition (HangarLockedSection); a stone that works weaker
// than its tier carries a warning symbol with the reason. Placing and moving stones is free and
// goes through the workshop draft (undo/redo); only "Für nächsten Run aktivieren" writes the
// placement into the pool, and a stone that leaves another vehicle needs a confirmation first.
// All rules come from the stone contracts; this module shows, asks and keeps the pool in memory.
import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { createHangarLockedSection } from './HangarLockedSection.js';
import {
    HANGAR_STAT_LABELS,
    createHangarPurchaseConfirm,
    describeHangarStatChanges,
    formatHangarNumber,
    formatHangarPurchaseLines,
} from './HangarPurchaseConfirm.js';
import {
    createArcadeStoneSlotRows,
    formatArcadeStoneLabel,
    formatArcadeStoneSlotLabel as slotLabel,
} from './ArcadeStoneSlotRows.js';
import { normalizeHangarBuild } from './HangarBuildDraftState.js';
import { ARCADE_STONE_MAX_OWNED, ARCADE_STONE_PRICE_XP } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    ARCADE_STONE_SLOT_IDS,
    commitArcadeStoneWorkshopResult,
    evaluateArcadeStonePurchase,
    evaluateArcadeStoneSlotPackagePurchase,
    evaluateArcadeStoneUpgrade,
    formatArcadeStonePackageLabel,
    normalizeArcadeStoneId,
    readArcadeStoneWorkshopRecord,
    resolveArcadeStoneRequiredLevel,
    resolveArcadeStoneSlotStatus,
    resolveArcadeStoneUpgradeCost,
    resolveArcadeStoneVehicleLevel,
} from '../../shared/contracts/ArcadeStoneWorkshopContract.js';
import {
    applyArcadeStonePlacement,
    listArcadeStonesForVehicle,
    normalizeArcadeStoneSlots,
    resolveArcadeStoneDraftSteps,
    resolveArcadeStoneEffectiveLevel,
    resolveArcadeStoneExtraSteps,
    resolveArcadeStonePlacementPlan,
    resolveArcadeStoneVisualPartId,
} from '../../shared/contracts/ArcadeStonePlacementContract.js';
import { ARCADE_BUILD_STAT_KEYS, normalizeArcadeSizeProfileFields } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { resolveArcadeSizeGroupForRole } from '../../shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeVehicleActiveStats } from '../../shared/contracts/ArcadeVehicleActiveStatsContract.js';

const REASON_TEXT = Object.freeze({
    insufficient_xp: 'Nicht genug XP',
    stone_limit: `Höchstens ${ARCADE_STONE_MAX_OWNED} Steine`,
    stone_level_locked: 'Diese Stufe braucht ein höheres Level',
    package_level_locked: 'Dieses Paket braucht ein höheres Level',
    already_owned: 'Schon freigeschaltet',
    unknown_stone: 'Diesen Stein gibt es nicht im Vorrat',
    storage_unavailable: 'Steinspeicher nicht lesbar',
    pool_read_failed: 'Steinspeicher nicht lesbar – die Steinänderung wurde nicht gespeichert',
    pool_save_failed: 'Steinspeicher konnte nicht gespeichert werden – es wurden keine XP ausgegeben',
    profile_save_failed: 'Profil konnte nicht gespeichert werden; die Steinänderung wurde zurückgenommen',
    profile_save_failed_pool_rollback_failed: 'Profil konnte nicht gespeichert werden; Pooländerung blieb bestehen (Zurückrollen fehlgeschlagen)',
    transfer_confirmation_required: 'Den Wechsel zwischen Fahrzeugen erst bestätigen',
});
const UNAVAILABLE_TEXT = 'Steinspeicher nicht lesbar: Kaufen, Umstecken und Aktivieren von Steinen sind gesperrt, bis er wieder gelesen werden kann.';
const DRAFT_DIFFERS_TEXT = 'Entwurf weicht vom aktiven Build ab – erst „Für nächsten Run aktivieren“ übernimmt die Steine.';
// A longer wait before healing is worse; every other stat is better when it grows.
const LOWER_IS_BETTER = new Set(['regenDelay']);

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

function reasonText(result) {
    return REASON_TEXT[/** @type {keyof typeof REASON_TEXT} */ (result?.reason)] || 'Nicht möglich';
}

/** @param {unknown} value */
function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * @param {{ bind: Function, toast: (message: string, tone?: string) => void, store: any, shell: any,
 *   getProfile: () => any, saveProfile: (profile: any) => void, profileFor: (vehicleId: string) => any,
 *   getDraft: () => any, vehicleLabel?: (vehicleId: string) => string,
 *   onSelectStone?: (stoneId: string) => void, onChange?: () => void, nowMs?: () => number }} options
 *   store: the player record store (readJsonRecordResult/saveJsonRecord); shell: the workshop shell,
 *   whose slot grid, validation box and history bar move into this section; getProfile/saveProfile:
 *   the selected vehicle, which pays for purchases.
 */
export function createArcadeStonePanel({
    bind, toast, store, shell, getProfile, saveProfile, profileFor, getDraft,
    vehicleLabel = (vehicleId) => vehicleId, onSelectStone = () => {}, onChange = () => {}, nowMs = () => Date.now(),
}) {
    // null while the record is unreadable: no purchase, no move, no activation, nothing is written.
    let pool = readArcadeStoneWorkshopRecord(store, nowMs()).pool;
    const stoneOf = (stoneId) => pool?.stones.find((entry) => entry.stoneId === stoneId) || null;
    const profileOf = (vehicleId) => profileFor(vehicleId) || {};

    function activeSlots(vehicleId) {
        const slots = normalizeArcadeStoneSlots(null);
        for (const entry of listArcadeStonesForVehicle(pool, vehicleId)) slots[entry.slotId] = entry.stoneId;
        return slots;
    }

    /** Effective tier of a stone on a slot of this vehicle (size and level rule of the contract). */
    function effectiveOf(stone, slotId, profile) {
        const sizes = normalizeArcadeSizeProfileFields(profile).partSizes;
        const groupSize = sizes[/** @type {string} */ (resolveArcadeSizeGroupForRole(slotId))];
        return { ...resolveArcadeStoneEffectiveLevel(stone.level, resolveArcadeStoneVehicleLevel(profile), groupSize), groupSize };
    }

    // --- DOM: heading, status, the shell's slot grid with one locked section per slot package ---
    const root = el('section', 'hangar-stone-panel');
    const title = el('h4', 'arcade-vehicle-subtitle hangar-stone-title', 'Steine');
    title.id = 'hangar-stone-title';
    title.tabIndex = -1;
    root.setAttribute('aria-labelledby', title.id);
    const hint = el('p', 'field-hint', 'Ein Stein verstärkt das Bauteil, in dem er steckt, ohne die Trefferzone zu vergrößern. '
        + 'Stein auswählen, dann einen Steinplatz anklicken. Umstecken ist kostenlos und rückgängig zu machen; XP-Käufe sind endgültig.');
    const status = el('p', 'hangar-stone-status hidden');
    status.setAttribute('aria-live', 'polite');

    const slotRows = createArcadeStoneSlotRows({
        bind, grid: shell.slotGrid, describeReason: reasonText, onBuyPackage: (packageId, trigger) => askPackage(packageId, trigger),
    });

    // --- DOM: the pool ---
    const poolTitle = el('h5', 'hangar-stone-pool-title', 'Steinvorrat');
    poolTitle.id = 'hangar-stone-pool-title';
    const count = el('p', 'hangar-stone-count', '');
    const poolList = el('ul', 'hangar-stone-pool');
    poolList.setAttribute('aria-labelledby', poolTitle.id);
    const buyStone = button('secondary-btn hangar-stone-buy', `Neuer Stein (${formatHangarNumber(ARCADE_STONE_PRICE_XP)} XP)`);
    const confirm = createHangarPurchaseConfirm({ bind, toast, className: 'hangar-stone-confirm', describeReason: reasonText });
    // Shown beside "Für nächsten Run aktivieren", so it is visible from every tab.
    const transferConfirm = createHangarPurchaseConfirm({ bind, toast, className: 'hangar-stone-transfer-confirm', describeReason: reasonText });
    shell.activationDock.appendChild(transferConfirm.root);
    root.append(title, hint, status, shell.slotsPanel, shell.validationBox, shell.historyBar, poolTitle, count, poolList, buyStone, confirm.root);

    const items = new Map();
    let renderedOrder = '';
    function itemFor(stoneId) {
        if (items.has(stoneId)) return items.get(stoneId);
        const node = el('li', 'hangar-stone-item');
        node.dataset.stoneId = stoneId;
        const select = button('hangar-stone-select', '');
        select.dataset.stoneSelect = stoneId;
        const location = el('span', 'hangar-stone-location', '');
        const upgrade = button('secondary-btn hangar-stone-upgrade', '');
        upgrade.dataset.stoneUpgrade = stoneId;
        const lock = createHangarLockedSection({ className: 'hangar-stone-upgrade-lock' });
        lock.body.appendChild(upgrade);
        node.append(select, location, lock.root);
        bind(select, 'click', () => onSelectStone(stoneId));
        bind(upgrade, 'click', () => askUpgrade(stoneId, upgrade));
        const item = { root: node, select, location, upgrade, lock };
        items.set(stoneId, item);
        return item;
    }

    // --- Purchases: always confirmed, pool before profile (commitArcadeStoneWorkshopResult) ---
    function commitResult(result) {
        const previousPool = pool;
        if (result.pool) pool = result.pool;
        const committed = commitArcadeStoneWorkshopResult(store, result, saveProfile);
        if (result.pool && !committed.ok) {
            pool = committed.reason === 'profile_save_failed_pool_rollback_failed'
                ? result.pool
                : readArcadeStoneWorkshopRecord(store, nowMs()).pool || previousPool;
            onChange();
        }
        return committed;
    }

    /** Values of the shown draft before and after a purchase, through the one calculation. */
    function valueLines(profileBefore, poolBefore, profileAfter, poolAfter) {
        const draft = getDraft();
        const stats = (profile, source) => resolveArcadeVehicleActiveStats(
            draft.vehicleId, profile, resolveArcadeStoneDraftSteps(source, draft.vehicleId, draft.stoneSlots, profile),
        );
        const lines = describeHangarStatChanges(stats(profileBefore, poolBefore), stats(profileAfter, poolAfter));
        return lines.length > 0 ? lines : ['Werte dieses Entwurfs: keine Änderung'];
    }

    bind(buyStone, 'click', () => confirm.ask({
        trigger: buyStone,
        heading: 'Neuen Stein kaufen?',
        evaluate: () => evaluateArcadeStonePurchase(pool, getProfile(), nowMs()),
        lines: (result) => formatHangarPurchaseLines(result, getProfile(), [
            `Steine: ${pool.stones.length} → ${result.pool.stones.length} von ${ARCADE_STONE_MAX_OWNED}`,
            'Werte: keine Änderung – der neue Stein ist frei, bis du ihn einsetzt',
        ]),
        commit: commitResult,
        successText: (result) => `${formatArcadeStoneLabel(result.pool.stones.at(-1).stoneId)} gekauft`,
    }));

    function askUpgrade(stoneId, trigger) {
        const label = formatArcadeStoneLabel(stoneId);
        confirm.ask({
            trigger,
            heading: `${label} aufwerten?`,
            evaluate: () => evaluateArcadeStoneUpgrade(pool, getProfile(), stoneId, nowMs()),
            lines: (result) => {
                const next = result.pool.stones.find((entry) => entry.stoneId === stoneId);
                return formatHangarPurchaseLines(result, getProfile(), [
                    `${label}: T${stoneOf(stoneId)?.level} → T${next.level}`,
                    ...valueLines(getProfile(), pool, result.next, result.pool),
                ]);
            },
            commit: commitResult,
            successText: (result) => `${label} ist jetzt T${result.pool.stones.find((entry) => entry.stoneId === stoneId).level}`,
        });
    }

    function askPackage(packageId, trigger) {
        const label = formatArcadeStonePackageLabel(packageId);
        confirm.ask({
            trigger,
            heading: `Steinplätze ${label} freischalten?`,
            evaluate: () => (pool ? evaluateArcadeStoneSlotPackagePurchase(getProfile(), packageId) : { ok: false, reason: 'storage_unavailable' }),
            lines: (result) => formatHangarPurchaseLines(result, getProfile(), [
                `Steinplätze ${label}: gesperrt → frei`,
                ...valueLines(getProfile(), pool, result.next, pool),
            ]),
            commit: commitResult,
            successText: `Steinplätze ${label} freigeschaltet`,
        });
    }

    // --- Rules the workshop asks (same result shapes as the Fight drop validation) ---
    function rejectDrop(build, code, slotId, message) {
        return { ok: false, code, message, build, changedSlots: [], errors: [{ code, slotId, message }] };
    }

    function evaluateInstall(build, stoneId, slotId) {
        const current = normalizeHangarBuild(build);
        if (!pool) return rejectDrop(current, 'storage_unavailable', slotId, 'Steinspeicher nicht lesbar: Umstecken ist gesperrt.');
        const id = normalizeArcadeStoneId(stoneId);
        const stone = id ? stoneOf(id) : null;
        if (!stone) return rejectDrop(current, 'unknown_stone', slotId, `${formatArcadeStoneLabel(stoneId)} ist nicht im Vorrat.`);
        if (!ARCADE_STONE_SLOT_IDS.includes(slotId)) return rejectDrop(current, 'unknown_target', slotId, 'Unbekannter Steinplatz.');
        const slot = resolveArcadeStoneSlotStatus(profileOf(current.vehicleId), slotId);
        if (!slot.unlocked) {
            return rejectDrop(current, 'slot_locked', slotId, `${slotLabel(slotId)}: Steinplatz gesperrt – erst „${formatArcadeStonePackageLabel(slot.packageId)}“ `
                + `freischalten (ab Level ${slot.requiredLevel}, ${formatHangarNumber(slot.costXp)} XP)`);
        }
        const slots = normalizeArcadeStoneSlots(current.stoneSlots);
        const from = ARCADE_STONE_SLOT_IDS.find((key) => slots[key] === id) || '';
        if (from === slotId) return rejectDrop(current, 'already_installed', slotId, `${formatArcadeStoneLabel(id)} steckt schon dort.`);
        // Moving a stone between two slots swaps it with the stone that was there.
        const displaced = slots[slotId];
        slots[slotId] = id;
        if (from) slots[from] = displaced;
        const next = { ...current, stoneSlots: slots, updatedAtMs: Math.max(current.updatedAtMs + 1, nowMs()) };
        return { ok: true, code: 'drop_accepted', build: next, changedSlots: from ? [slotId, from] : [slotId], errors: [] };
    }

    function evaluateRemoval(build, slotId) {
        const current = normalizeHangarBuild(build);
        if (!pool) return rejectDrop(current, 'storage_unavailable', slotId, 'Steinspeicher nicht lesbar: Umstecken ist gesperrt.');
        const slots = normalizeArcadeStoneSlots(current.stoneSlots);
        if (!slots[slotId]) return rejectDrop(current, 'slot_empty', slotId, 'Der Steinplatz ist leer.');
        slots[slotId] = null;
        return { ok: true, code: 'removed', build: { ...current, stoneSlots: slots, updatedAtMs: Math.max(current.updatedAtMs + 1, nowMs()) }, changedSlots: [slotId], errors: [] };
    }

    /** Stones on unbought slots or twice in one build block it; missing stones only stay empty. */
    function validate(build, _level, profile = null) {
        const current = normalizeHangarBuild(build);
        const plan = resolveArcadeStonePlacementPlan(pool, current.vehicleId, current.stoneSlots, profile || profileOf(current.vehicleId));
        const errors = plan.errors.map((error) => ({
            ...error,
            message: error.code === 'slot_locked'
                ? `${slotLabel(error.slotId)}: Steinplatz gesperrt`
                : `${formatArcadeStoneLabel(error.stoneId)} steckt doppelt`,
        }));
        return { ok: errors.length === 0, build: current, errors, warnings: [], stats: {}, limits: {} };
    }

    function confirmTransfers(build, onAccept) {
        const current = normalizeHangarBuild(build);
        if (!pool) {
            toast(UNAVAILABLE_TEXT, 'warning');
            return { ok: false, code: 'storage_unavailable' };
        }
        const validation = validate(current);
        if (!validation.ok) {
            toast(`Aktivieren nicht möglich: ${validation.errors[0].message}`, 'warning');
            return { ok: false, code: validation.errors[0].code };
        }
        const transfersOf = (source) => resolveArcadeStonePlacementPlan(pool, source.vehicleId, source.stoneSlots, profileOf(source.vehicleId)).transfers;
        const listed = JSON.stringify(transfersOf(current));
        if (listed === '[]') return onAccept();
        // Only the listed transfers are confirmed: a draft changed meanwhile closes the dialog.
        const evaluate = () => {
            if (!pool) return { ok: false, reason: 'storage_unavailable' };
            const latest = normalizeHangarBuild(getDraft());
            const transfers = transfersOf(latest);
            const same = latest.vehicleId === current.vehicleId && JSON.stringify(transfers) === listed;
            return same ? { ok: true, transfers } : { ok: false, reason: 'transfer_confirmation_required' };
        };
        transferConfirm.ask({
            trigger: shell.activateButton,
            heading: 'Steine aus anderen Fahrzeugen holen?',
            acceptLabel: 'Umstecken und aktivieren',
            evaluate,
            lines: (result) => [
                ...result.transfers.map((entry) => (
                    `${formatArcadeStoneLabel(entry.stoneId)} wird aus ${vehicleLabel(entry.fromVehicleId)} · ${slotLabel(entry.fromSlot)} entfernt`
                )),
                'Umstecken kostet keine XP.',
            ],
            commit: () => onAccept(),
        });
        return { ok: false, code: 'transfer_confirmation_pending' };
    }

    /** Writes the build's stones into the pool; a transfer between vehicles needs `confirmed`. */
    function commit(build, { confirmed = false } = {}) {
        const current = normalizeHangarBuild(build);
        const result = applyArcadeStonePlacement(pool, current.vehicleId, current.stoneSlots, profileOf(current.vehicleId), {
            confirmTransfers: confirmed === true, nowMs: nowMs(),
        });
        if (!commitArcadeStoneWorkshopResult(store, result, null).ok) return false;
        pool = result.pool;
        onChange();
        return true;
    }

    // --- Rendering: called by the workshop renderer on every sync; nodes are kept, so focus stays ---
    function locationText(stone, vehicleId, draftSlot) {
        const parts = draftSlot ? [`im Entwurf: ${slotLabel(draftSlot)}`] : [];
        const placed = stone.placement;
        if (placed && !(placed.vehicleId === vehicleId && placed.slotId === draftSlot)) {
            parts.push(`aktiv: ${vehicleLabel(placed.vehicleId)} · ${slotLabel(placed.slotId)}`);
        }
        return parts.join(' · ') || 'frei';
    }

    function renderPool(state, profile, wished) {
        const stones = pool ? pool.stones : [];
        const order = stones.map((entry) => entry.stoneId).join('|');
        if (order !== renderedOrder) {
            poolList.replaceChildren(...stones.map((entry) => itemFor(entry.stoneId).root));
            renderedOrder = order;
        }
        const draftSlotOf = new Map(ARCADE_STONE_SLOT_IDS.filter((slotId) => wished[slotId]).map((slotId) => [wished[slotId], slotId]));
        for (const entry of stones) {
            const item = itemFor(entry.stoneId);
            const selected = state.selectedPartId === entry.stoneId;
            item.select.textContent = formatArcadeStoneLabel(entry.stoneId, entry.level);
            item.select.setAttribute('aria-pressed', String(selected));
            item.root.classList.toggle('is-selected', selected);
            item.location.textContent = locationText(entry, state.draft.vehicleId, draftSlotOf.get(entry.stoneId));
            const target = entry.level + 1;
            const offer = evaluateArcadeStoneUpgrade(pool, profile, entry.stoneId, nowMs());
            item.upgrade.textContent = `Auf T${target} aufwerten (${formatHangarNumber(resolveArcadeStoneUpgradeCost(target))} XP)`;
            item.upgrade.disabled = !offer.ok;
            item.upgrade.setAttribute('aria-description', offer.ok ? 'Kaufbar' : reasonText(offer));
            item.lock.setLocked(offer.reason === 'stone_level_locked', `T${target} ab Level ${resolveArcadeStoneRequiredLevel(target)}`);
        }
        count.textContent = `Steine: ${stones.length} / ${ARCADE_STONE_MAX_OWNED}`;
        const offer = evaluateArcadeStonePurchase(pool, profile, nowMs());
        buyStone.disabled = !offer.ok;
        buyStone.setAttribute('aria-description', offer.ok ? 'Kaufbar' : reasonText(offer));
    }

    // A purchase that hides or locks its own button (package bought, next tier needs a higher level,
    // 21st stone) would drop the keyboard focus to the page start: it moves to the section title.
    function keepFocus() {
        const focused = /** @type {any} */ (document.activeElement);
        if (!focused || !root.contains(focused)) return;
        for (let node = focused; node && node !== root; node = node.parentElement) {
            if (node.disabled || node.classList.contains('hidden')) {
                title.focus();
                return;
            }
        }
    }

    let shownVehicleId = '';
    function render(state, activePartId) {
        // The selected vehicle pays: a vehicle switch closes an open purchase (as in the size panel),
        // so the newly selected vehicle never pays for an offer confirmed for another one.
        if (state.draft.vehicleId !== shownVehicleId) {
            shownVehicleId = state.draft.vehicleId;
            confirm.hide(false);
        }
        const profile = profileOf(state.draft.vehicleId);
        const wished = normalizeArcadeStoneSlots(state.draft.stoneSlots);
        const viewportStates = slotRows.render({
            state, profile, wished, activePartId, stoneOf, effectiveOf, vehicleLabel, evaluateInstall,
            hasPool: !!pool,
            packageOffer: (packageId) => (pool ? evaluateArcadeStoneSlotPackagePurchase(profile, packageId) : { ok: false, reason: 'storage_unavailable' }),
        });
        renderPool(state, profile, wished);
        const active = activeSlots(state.draft.vehicleId);
        const message = !pool ? UNAVAILABLE_TEXT
            : (ARCADE_STONE_SLOT_IDS.some((slotId) => wished[slotId] !== active[slotId]) ? DRAFT_DIFFERS_TEXT : '');
        status.textContent = message;
        status.classList.toggle('hidden', !message);
        confirm.refresh();
        transferConfirm.refresh();
        keepFocus();
        return viewportStates;
    }

    // --- Build statistics and 3D preview through the one calculation ---
    function projectStats(build) {
        const current = normalizeHangarBuild(build);
        const profile = profileOf(current.vehicleId);
        // Builds of the shown vehicle (draft, baseline, presets) count their own stones; another
        // vehicle in the comparison counts the stones that fly with it.
        const steps = current.vehicleId === getDraft()?.vehicleId
            ? resolveArcadeStoneDraftSteps(pool, current.vehicleId, current.stoneSlots, profile)
            : resolveArcadeStoneExtraSteps(pool, current.vehicleId, profile);
        return resolveArcadeVehicleActiveStats(current.vehicleId, profile, steps);
    }

    function compareStats(current, reference) {
        return ARCADE_BUILD_STAT_KEYS.map((key) => {
            const value = round2(current?.[key]);
            const referenceValue = round2(reference?.[key]);
            const delta = round2(value - referenceValue);
            const better = LOWER_IS_BETTER.has(key) ? delta < 0 : delta > 0;
            return {
                key, label: HANGAR_STAT_LABELS[/** @type {keyof typeof HANGAR_STAT_LABELS} */ (key)], value, referenceValue, delta,
                tone: delta === 0 ? 'neutral' : (better ? 'positive' : 'negative'),
            };
        });
    }

    /** The build with a stone part per slot in its effective tier, for the 3D preview. */
    function visualBuild(build) {
        if (!build) return null;
        const profile = profileOf(build.vehicleId);
        const wished = normalizeArcadeStoneSlots(build.stoneSlots);
        const slots = {};
        for (const slotId of ARCADE_STONE_SLOT_IDS) {
            const stone = wished[slotId] ? stoneOf(wished[slotId]) : null;
            const usable = stone && resolveArcadeStoneSlotStatus(profile, slotId).unlocked;
            slots[slotId] = usable ? resolveArcadeStoneVisualPartId(effectiveOf(stone, slotId, profile).effective) : null;
        }
        return { ...build, slots };
    }

    return Object.freeze({
        root,
        getPool: () => pool,
        /** Compensate a later failed active-build write; false means storage could not be restored. */
        restorePool(previousPool) {
            if (!previousPool || !commitArcadeStoneWorkshopResult(store, { ok: true, pool: previousPool }, null).ok) return false;
            pool = previousPool;
            onChange();
            return true;
        },
        /** A pool stone as the workshop selects it (label, the slots it may go to), or null. */
        resolveStone(stoneId) {
            const id = normalizeArcadeStoneId(stoneId);
            const stone = id ? stoneOf(id) : null;
            if (!stone) return null;
            const profile = getProfile();
            const open = ARCADE_STONE_SLOT_IDS.filter((slotId) => resolveArcadeStoneSlotStatus(profile, slotId).unlocked);
            return { id, label: formatArcadeStoneLabel(id, stone.level), compatibleSlots: open.length > 0 ? open : [...ARCADE_STONE_SLOT_IDS] };
        },
        evaluateInstall,
        evaluateRemoval,
        validate,
        /** The build with the stones that sit in its vehicle in the pool (the active build). */
        withActivePlacement(build) {
            return build ? normalizeHangarBuild({ ...build, stoneSlots: activeSlots(build.vehicleId) }) : build;
        },
        confirmTransfers,
        commit,
        arcadeView: Object.freeze({ renderSlots: render, projectStats, compareStats, visualBuild }),
    });
}

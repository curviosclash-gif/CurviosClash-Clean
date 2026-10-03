// The seven stone slots of the arcade hangar (Paket 3), grouped by slot package: core and nose are
// free, wings, engines and utility are bought as packages. A package that is not bought yet stays
// visible, dimmed, names its condition and offers its purchase (HangarLockedSection). Each row
// shows the wished stone of the draft, its effective tier, a warning symbol when the stone works
// weaker than its tier, and a grey note for stones that sit in another vehicle or are missing.
// The rows use the classes and data attributes of the Fight sockets, so the workshop's click,
// keyboard and drag handlers on the slot grid work unchanged. Nodes are built once and updated,
// so the keyboard focus stays where it is.
import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { createHangarLockedSection } from './HangarLockedSection.js';
import { formatHangarNumber } from './HangarPurchaseConfirm.js';
import { ARCADE_STONE_SLOT_PACKAGES } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    ARCADE_STONE_SLOT_IDS,
    formatArcadeStonePackageLabel,
    resolveArcadeStoneSlotStatus,
    resolveArcadeStoneVehicleLevel,
} from '../../shared/contracts/ArcadeStoneWorkshopContract.js';
import { describeArcadeStoneWeakness } from '../../shared/contracts/ArcadeStonePlacementContract.js';

export const ARCADE_STONE_SLOT_LABELS = Object.freeze({
    core: 'Rumpf', nose: 'Nase', wing_left: 'Flügel L', wing_right: 'Flügel R',
    engine_left: 'Antrieb L', engine_right: 'Antrieb R', utility: 'Utility',
});
const PACKAGE_ORDER = Object.freeze(['base', 'wings', 'engines', 'utility']);

/** @param {unknown} slotId */
export function formatArcadeStoneSlotLabel(slotId) {
    return ARCADE_STONE_SLOT_LABELS[/** @type {keyof typeof ARCADE_STONE_SLOT_LABELS} */ (slotId)] || String(slotId || '');
}

/**
 * "Stein 3 · T2" (with a tier) or "Stein 3".
 * @param {unknown} stoneId
 * @param {number} [level]
 */
export function formatArcadeStoneLabel(stoneId, level = 0) {
    const serial = Number(String(stoneId || '').slice('stone-'.length)) || 0;
    return level > 0 ? `Stein ${serial} · T${level}` : `Stein ${serial}`;
}

function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

/**
 * @typedef {{ state: any, profile: any, wished: Record<string, string|null>, hasPool: boolean,
 *   stoneOf: (stoneId: string) => any, effectiveOf: (stone: any, slotId: string, profile: any) => any,
 *   vehicleLabel: (vehicleId: string) => string, activePartId: string,
 *   evaluateInstall: (build: any, stoneId: string, slotId: string) => any,
 *   packageOffer: (packageId: string) => { ok: boolean, reason?: string } }} ArcadeStoneSlotRenderInput
 */

/**
 * @param {{ bind: Function, grid: HTMLElement, onBuyPackage: (packageId: string, trigger: HTMLElement) => void,
 *   describeReason: (result: any) => string }} options
 */
export function createArcadeStoneSlotRows({ bind, grid, onBuyPackage, describeReason }) {
    const rows = new Map();
    const packages = new Map();
    for (const packageId of PACKAGE_ORDER) {
        const pkg = /** @type {Record<string, any>} */ (ARCADE_STONE_SLOT_PACKAGES)[packageId];
        const label = formatArcadeStonePackageLabel(packageId);
        const buy = packageId === 'base' ? null : button('secondary-btn hangar-stone-package-buy', `Freischalten (${formatHangarNumber(pkg.costXp)} XP)`);
        if (buy) {
            buy.dataset.stonePackageBuy = packageId;
            buy.setAttribute('aria-label', `Steinplätze ${label} freischalten (${formatHangarNumber(pkg.costXp)} XP)`);
            bind(buy, 'click', () => onBuyPackage(packageId, buy));
        }
        const lock = createHangarLockedSection({ className: 'hangar-stone-package', action: buy });
        lock.root.dataset.stonePackage = packageId;
        for (const slotId of pkg.slots) {
            const row = createRow(slotId);
            rows.set(slotId, row);
            lock.body.appendChild(row.root);
        }
        packages.set(packageId, { lock, buy, label, firstSlot: pkg.slots[0] });
        grid.appendChild(lock.root);
    }

    function createRow(slotId) {
        const label = formatArcadeStoneSlotLabel(slotId);
        const row = el('div', 'arcade-vehicle-slot-row hangar-slot-row hangar-stone-slot-row');
        row.dataset.hangarSlotRow = slotId;
        const select = button('hangar-slot-select arcade-vehicle-slot-label', label);
        select.dataset.selectSlot = slotId;
        select.setAttribute('aria-label', `Steinplatz ${label} wählen`);
        const installed = button('hangar-installed-part', 'Leer');
        installed.dataset.installedSlot = slotId;
        const tier = el('span', 'arcade-vehicle-slot-tier', '—');
        // Warning symbol: hovering or focusing shows the reason (CSS); a tap or Enter keeps it open.
        const warning = el('span', 'hangar-stone-warning hidden', '⚠');
        warning.tabIndex = 0;
        warning.setAttribute('role', 'button');
        warning.setAttribute('aria-label', `${label}: Stein wirkt schwächer`);
        warning.setAttribute('aria-expanded', 'false');
        const warningText = el('span', 'hangar-stone-warning-text', '');
        warningText.id = `hangar-stone-warning-${slotId}`;
        warning.setAttribute('aria-describedby', warningText.id);
        const remove = button('secondary-btn hangar-slot-remove', '×');
        remove.dataset.removeSlot = slotId;
        remove.setAttribute('aria-label', `${label}: Stein entfernen`);
        const note = el('p', 'hangar-stone-slot-note hidden', '');
        row.append(select, installed, tier, warning, warningText, remove, note);
        const toggle = () => warning.setAttribute('aria-expanded', String(warningText.classList.toggle('is-open')));
        bind(warning, 'click', toggle);
        bind(warning, 'keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
        });
        return { root: row, label, installed, tier, warning, warningText, remove, note };
    }

    function renderPackages(input) {
        const level = resolveArcadeStoneVehicleLevel(input.profile);
        for (const [packageId, view] of packages) {
            if (!view.buy) continue;
            const slot = resolveArcadeStoneSlotStatus(input.profile, view.firstSlot);
            const cost = `${formatHangarNumber(slot.costXp)} XP`;
            view.lock.setLocked(!slot.unlocked, level >= slot.requiredLevel
                ? `${view.label}: Steinplätze für ${cost} freischalten`
                : `${view.label}: ab Level ${slot.requiredLevel} kaufbar (${cost})`);
            const offer = input.packageOffer(packageId);
            view.buy.disabled = !offer.ok;
            view.buy.setAttribute('aria-description', offer.ok ? 'Kaufbar'
                : (offer.reason === 'package_level_locked' ? `Erst ab Level ${slot.requiredLevel}` : describeReason(offer)));
        }
    }

    function noteOf(input, stoneId, stone, foreign, slot) {
        if (foreign) {
            return `steckt in ${input.vehicleLabel(foreign.vehicleId)} · ${formatArcadeStoneSlotLabel(foreign.slotId)} – wird beim Aktivieren umgesteckt`;
        }
        if (stoneId && !stone && input.hasPool) return `${formatArcadeStoneLabel(stoneId)} fehlt im Vorrat – der Platz bleibt beim Aktivieren leer`;
        if (stoneId && !slot.unlocked) return `Steinplatz gesperrt – erst „${formatArcadeStonePackageLabel(slot.packageId)}“ freischalten`;
        return '';
    }

    /** @param {ArcadeStoneSlotRenderInput} input @param {string} slotId */
    function renderRow(input, slotId) {
        const row = rows.get(slotId);
        const { state, profile } = input;
        const stoneId = input.wished[slotId];
        const stone = stoneId ? input.stoneOf(stoneId) : null;
        const slot = resolveArcadeStoneSlotStatus(profile, slotId);
        const effective = stone ? input.effectiveOf(stone, slotId, profile) : null;
        const foreign = stone?.placement && stone.placement.vehicleId !== state.draft.vehicleId ? stone.placement : null;
        const text = stoneId ? formatArcadeStoneLabel(stoneId, stone?.level) : 'Leer';
        row.root.classList.toggle('is-selected', state.selectedSlotId === slotId);
        row.root.classList.toggle('is-foreign', !!foreign);
        row.root.classList.toggle('is-missing', !!stoneId && !stone && input.hasPool);
        row.installed.textContent = text;
        row.installed.disabled = !stoneId;
        row.installed.setAttribute('aria-label', `${row.label}: ${effective ? `${text}, wirkt als T${effective.effective}` : text}`);
        if (stoneId) {
            row.installed.dataset.partId = stoneId;
            row.installed.dataset.partLabel = text;
        } else {
            delete row.installed.dataset.partId;
            delete row.installed.dataset.partLabel;
        }
        row.tier.textContent = effective ? `T${effective.effective}` : '—';
        const weakness = effective && slot.unlocked ? describeArcadeStoneWeakness(effective, slotId, effective.groupSize) : '';
        row.warning.classList.toggle('hidden', !weakness);
        row.warning.title = weakness;
        row.warningText.textContent = weakness;
        if (!weakness) {
            row.warningText.classList.remove('is-open');
            row.warning.setAttribute('aria-expanded', 'false');
        }
        row.remove.disabled = !stoneId;
        row.remove.title = stoneId ? `Stein aus ${row.label} entfernen` : 'Steinplatz ist leer';
        row.remove.setAttribute('aria-description', row.remove.title);
        const note = noteOf(input, stoneId, stone, foreign, slot);
        row.note.textContent = note;
        row.note.classList.toggle('hidden', !note);
        const drop = input.activePartId ? input.evaluateInstall(state.draft, input.activePartId, slotId) : null;
        return {
            slotKey: slotId,
            badge: effective ? `T${effective.effective}` : '+',
            disabled: drop ? !drop.ok : false,
            tooltip: drop ? (drop.ok ? `${row.label}: hier einsetzen` : drop.message) : `${row.label}: ${text}`,
            dropState: '',
        };
    }

    return Object.freeze({
        /** Updates packages and rows; returns the hardpoint states for the 3D preview. */
        render(/** @type {ArcadeStoneSlotRenderInput} */ input) {
            renderPackages(input);
            return ARCADE_STONE_SLOT_IDS.map((slotId) => renderRow(input, slotId));
        },
        packageLabel: (/** @type {string} */ packageId) => packages.get(packageId)?.label || formatArcadeStonePackageLabel(packageId),
    });
}

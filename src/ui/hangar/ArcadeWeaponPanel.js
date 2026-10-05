import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import {
    ARCADE_MACHINE_GUN_MODELS,
    arcadeWeaponLevelCostXp,
    describeArcadeMachineGunRelative,
    evaluateArcadeWeaponLevelPurchase,
    normalizeArcadeWeaponProfileFields,
    resolveArcadeMachineGunUnlockLevel,
    resolveArcadeOwnedMachineGuns,
    selectArcadeMachineGun,
} from '../../shared/contracts/ArcadeMachineGunContract.js';
import { resolveArcadeVehicleActiveStats } from '../../shared/contracts/ArcadeVehicleActiveStatsContract.js';
import { resolveArcadeStoneExtraSteps } from '../../shared/contracts/ArcadeStonePlacementContract.js';
import { createHangarPurchaseConfirm, formatHangarNumber, formatHangarPurchaseLines } from './HangarPurchaseConfirm.js';
import { isArcadeMachineGunMastered, resolveArcadeMilestoneCosmetics } from '../../shared/contracts/ArcadeMilestoneCosmeticContract.js';
import { arcadeMachineGunSelectionLabel } from './HangarWorkshopRenderText.js';

const PURCHASES = Object.freeze([
    { kind: 'mg', label: 'MG-Stufe', field: 'mgLevel' },
    { kind: 'rocket', label: 'Raketenschaden', field: 'rocketLevel' },
    { kind: 'shield', label: 'Schildstärke', field: 'shieldLevel' },
]);

function button(className, label) {
    const node = el('button', className, label);
    node.type = 'button';
    return node;
}

function pct(value) { return `${formatHangarNumber(value)} %`; }

/** The selected vehicle owns the choice, levels and XP. Only a saved profile enters a run. */
export function createArcadeWeaponPanel({ bind, toast, getProfile, saveProfile, getPool }) {
    const root = el('section', 'hangar-arcade-weapons');
    const heading = el('h4', 'arcade-vehicle-subtitle', 'Waffen und Schild');
    const hint = el('p', 'field-hint', 'Die MG-Stufe gilt für alle MGs dieses Fahrzeugs. Käufe wirken ab dem nächsten Run; '
        + 'MG und Rakete wirken in Kampf-Runs, Schild in allen normalen Arcade-Runs.');
    const grid = el('div', 'hangar-arcade-weapons-grid');
    const cards = ARCADE_MACHINE_GUN_MODELS.map((gun) => {
        const card = el('article', 'hangar-arcade-weapon-card');
        const select = button('secondary-btn hangar-arcade-weapon-select', gun.label);
        select.dataset.arcadeMachineGunId = gun.id;
        const role = el('span', 'hangar-arcade-weapon-role', gun.role);
        const text = el('p', 'field-hint hangar-arcade-weapon-values');
        const lock = el('p', 'field-hint hangar-arcade-weapon-lock');
        card.append(select, role, text, lock);
        grid.appendChild(card);
        return { gun, card, select, text, lock };
    });
    const levels = el('div', 'hangar-arcade-weapon-levels');
    const levelRows = PURCHASES.map((entry) => {
        const row = el('div', 'hangar-arcade-weapon-level');
        const value = el('span', 'hangar-arcade-weapon-level-value');
        const buy = button('primary-btn hangar-arcade-weapon-buy', 'Aufwerten');
        buy.dataset.arcadeWeaponUpgrade = entry.kind;
        row.append(value, buy);
        levels.appendChild(row);
        return { ...entry, value, buy };
    });
    const confirm = createHangarPurchaseConfirm({
        bind, toast, className: 'hangar-arcade-weapon-confirm',
        describeReason: (result) => result?.reason === 'insufficient_xp' ? 'Nicht genug XP für diese Stufe.'
            : 'Diese Waffenstufe ist nicht verfügbar.',
    });
    root.append(heading, hint, grid, levels, confirm.root);

    function effective(profile) {
        const steps = resolveArcadeStoneExtraSteps(getPool?.(), profile.vehicleId, profile);
        return resolveArcadeVehicleActiveStats(profile.vehicleId, profile, steps);
    }

    function purchaseLines(result, kind) {
        const profile = getProfile();
        const before = effective(profile);
        const after = effective(result.next);
        const field = PURCHASES.find((entry) => entry.kind === kind).field;
        const lines = [`Stufe: ${before[field]} → ${after[field]}`];
        if (kind === 'mg') {
            lines.push(`MG-Schaden: ${pct(before.mgDamagePct)} → ${pct(after.mgDamagePct)}`);
            const beforeRelative = describeArcadeMachineGunRelative(before.weaponLoadout.machineGunId, before.mgLevel);
            const afterRelative = describeArcadeMachineGunRelative(after.weaponLoadout.machineGunId, after.mgLevel);
            lines.push(`Feuerrate: ${pct(beforeRelative.ratePct)} → ${pct(afterRelative.ratePct)}`);
            lines.push(`Reichweite: ${pct(beforeRelative.rangePct)} → ${pct(afterRelative.rangePct)}`);
            lines.push(`Zielhilfe: ${pct(beforeRelative.aimPct)} → ${pct(afterRelative.aimPct)}`);
        } else if (kind === 'rocket') {
            lines.push(`Raketenschaden: ${pct(before.rocketDamagePct)} → ${pct(after.rocketDamagePct)}`);
        } else {
            lines.push(`Schildstärke: ${pct(before.shieldPct)} → ${pct(after.shieldPct)}`);
        }
        return formatHangarPurchaseLines(result, profile, lines);
    }

    bind(grid, 'click', (event) => {
        const id = event.target?.closest?.('[data-arcade-machine-gun-id]')?.dataset.arcadeMachineGunId;
        if (!id) return;
        const result = selectArcadeMachineGun(getProfile(), id);
        if (!result.ok) { toast('Dieses MG ist noch gesperrt.', 'warning'); return; }
        if (saveProfile(result.next)) toast(`${ARCADE_MACHINE_GUN_MODELS.find((gun) => gun.id === id).label} ausgewählt`, 'success');
    });
    bind(levels, 'click', (event) => {
        const kind = event.target?.closest?.('[data-arcade-weapon-upgrade]')?.dataset.arcadeWeaponUpgrade;
        if (!kind) return;
        const entry = PURCHASES.find((row) => row.kind === kind);
        confirm.ask({
            trigger: event.target,
            heading: `${entry.label} aufwerten`,
            evaluate: () => evaluateArcadeWeaponLevelPurchase(getProfile(), kind),
            lines: (result) => purchaseLines(result, kind),
            commit: (result) => saveProfile(result.next),
            successText: `${entry.label} verbessert`,
        });
    });

    return Object.freeze({
        root,
        render(_vehicleId, profile) {
            const fields = normalizeArcadeWeaponProfileFields(profile);
            const owned = resolveArcadeOwnedMachineGuns(profile.vehicleId, profile.level);
            const masterCount = resolveArcadeMilestoneCosmetics(profile).masterCount;
            for (const { gun, card, select, text, lock } of cards) {
                const unlocked = owned.includes(gun.id);
                const selected = fields.selectedMachineGunId === gun.id;
                const relative = describeArcadeMachineGunRelative(gun.id, fields.mgLevel);
                card.classList.toggle('is-locked', !unlocked);
                card.classList.toggle('is-selected', selected);
                select.disabled = !unlocked;
                select.textContent = arcadeMachineGunSelectionLabel(
                    gun.label, selected, isArcadeMachineGunMastered(gun.id, masterCount),
                );
                select.setAttribute('aria-pressed', String(selected));
                text.textContent = `${gun.role}: ${gun.strength}. ${gun.weakness}. `
                    + `Schaden ${pct(relative.damagePct)}, Feuerrate ${pct(relative.ratePct)}, `
                    + `Reichweite ${pct(relative.rangePct)}, Zielhilfe ${pct(relative.aimPct)} (zu Vektor Stufe 1).`
                    + (gun.id === 'pulse_p3' ? ' Salven-MG: drei Schüsse je Stoß.' : '');
                lock.textContent = unlocked ? '' : `Ab Level ${resolveArcadeMachineGunUnlockLevel(profile.vehicleId, gun.id)}`;
            }
            for (const row of levelRows) {
                const current = fields[row.field];
                const cost = arcadeWeaponLevelCostXp(current + 1);
                row.value.textContent = `${row.label} · Stufe ${formatHangarNumber(current)}`;
                row.buy.textContent = current >= Number.MAX_SAFE_INTEGER
                    ? 'Höchste darstellbare Stufe' : `Stufe ${formatHangarNumber(current + 1)} für ${formatHangarNumber(cost)} XP`;
                row.buy.disabled = current >= Number.MAX_SAFE_INTEGER;
            }
            confirm.refresh();
        },
    });
}

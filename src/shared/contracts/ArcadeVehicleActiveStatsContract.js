// ============================================
// ArcadeVehicleActiveStatsContract.js - die eine Rechenstelle für die wirksamen Werte (Paket 3)
// Hangar (Vorschau, Statistik, Bestätigung, Warnung), Run-Start und HUD rechnen nur hierüber.
// stoneSteps kommen immer aus resolveArcadeStoneExtraSteps (bzw. resolveArcadeStoneDraftSteps für
// einen Hangar-Entwurf). Paket 4 ergänzt hier die Waffenwerte. Rein: keine Importe aus core/ui/state.
// ============================================

import { resolveArcadeVehicleBuildStats } from './ArcadeVehicleBuildContract.js';
import { normalizeArcadeWeaponProfileFields } from './ArcadeMachineGunContract.js';
import { resolveArcadeMilestoneCosmetics } from './ArcadeMilestoneCosmeticContract.js';
import {
    ARCADE_MG_DAMAGE_PER_LEVEL,
    ARCADE_ROCKET_DAMAGE_PER_LEVEL,
    ARCADE_SHIELD_PER_LEVEL,
} from './ArcadeVehicleBalanceContract.js';

/**
 * Wirksame Werte eines Fahrzeugs: Grundwerte, Größen-Build und Steine (Obergrenzen eingerechnet).
 * @param {string} vehicleId
 * @param {unknown} profile Profil oder Build mit den Größenfeldern
 * @param {unknown} [stoneSteps] zusätzliche Schritte je Gruppe aus den Steinen
 * @returns {import('./ArcadeVehicleBuildContract.js').ArcadeVehicleBuildStats & {
 *   mgLevel: number, rocketLevel: number, shieldLevel: number, mgDamagePct: number,
 *   rocketDamagePct: number, shieldPct: number,
 *   weaponLoadout: Readonly<{machineGunId: string, mgLevel: number, mgDamagePct: number, masterCount: number}>
 * }}
 */
export function resolveArcadeVehicleActiveStats(vehicleId, profile, stoneSteps = null) {
    const base = resolveArcadeVehicleBuildStats(vehicleId, profile, stoneSteps);
    const weapons = normalizeArcadeWeaponProfileFields({
        ...(profile && typeof profile === 'object' ? profile : {}), vehicleId,
    });
    const mgDamagePct = base.damagePct + ARCADE_MG_DAMAGE_PER_LEVEL * (weapons.mgLevel - 1);
    return {
        ...base,
        mgLevel: weapons.mgLevel,
        rocketLevel: weapons.rocketLevel,
        shieldLevel: weapons.shieldLevel,
        mgDamagePct,
        rocketDamagePct: base.damagePct + ARCADE_ROCKET_DAMAGE_PER_LEVEL * (weapons.rocketLevel - 1),
        shieldPct: base.shieldPct + ARCADE_SHIELD_PER_LEVEL * (weapons.shieldLevel - 1),
        weaponLoadout: Object.freeze({
            machineGunId: weapons.selectedMachineGunId,
            mgLevel: weapons.mgLevel,
            mgDamagePct,
            masterCount: resolveArcadeMilestoneCosmetics(profile).masterCount,
        }),
    };
}

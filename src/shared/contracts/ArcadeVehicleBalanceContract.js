// ============================================
// ArcadeVehicleBalanceContract.js - central Arcade vehicle balance table (Paket 1)
// Grundwerte je Werksschiff: Leben, Lager, Tempo/Wendigkeit in Prozent des
// Basiswerts, Start-MG-Paar. Rein datenhaltig - keine Importe aus core/ui/state.
// ============================================

/** Höchstzahl an Item- bzw. Raketen-Plätzen je Lager (siehe arcade-spec.md Abschnitt 1). */
export const ARCADE_STORAGE_MAX_SLOTS = 10;

const FIGHTER_ROLE_STATS = Object.freeze({ role: 'fighter', maxHpPct: 75, itemCapacity: 3, rocketCapacity: 3, speedPct: 120, turnPct: 125, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) });
const ALLROUNDER_ROLE_STATS = Object.freeze({ role: 'allrounder', maxHpPct: 100, itemCapacity: 5, rocketCapacity: 5, speedPct: 100, turnPct: 100, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) });
const TANK_ROLE_STATS = Object.freeze({ role: 'tank', maxHpPct: 125, itemCapacity: 6, rocketCapacity: 5, speedPct: 90, turnPct: 90, startMachineGuns: Object.freeze(['vector_m7', 'bastion_h3']) });

/** Rollen-Vorlagen für eigene Arcade-Lab-Schiffe (Paket 6); hier schon als Datentabelle bereitgestellt. */
export const ARCADE_VEHICLE_ROLE_TEMPLATES = Object.freeze({
    fighter: FIGHTER_ROLE_STATS,
    allrounder: ALLROUNDER_ROLE_STATS,
    tank: TANK_ROLE_STATS,
});

// Plan-Tabelle Abschnitt 1 (arcade-spec.md). Werte sind vorläufig (siehe Folgeplan Balancing).
const ARCADE_VEHICLE_BALANCE_TABLE = Object.freeze({
    ship5: Object.freeze({ role: 'allrounder', maxHpPct: 100, itemCapacity: 5, rocketCapacity: 5, speedPct: 100, turnPct: 100, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) }),
    spaceship: Object.freeze({ role: 'tank', maxHpPct: 125, itemCapacity: 6, rocketCapacity: 5, speedPct: 90, turnPct: 90, startMachineGuns: Object.freeze(['vector_m7', 'bastion_h3']) }),
    arrow: Object.freeze({ role: 'fighter', maxHpPct: 75, itemCapacity: 3, rocketCapacity: 3, speedPct: 120, turnPct: 125, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) }),
    manta: Object.freeze({ role: 'tank', maxHpPct: 150, itemCapacity: 7, rocketCapacity: 8, speedPct: 80, turnPct: 75, startMachineGuns: Object.freeze(['vector_m7', 'bastion_h3']) }),
    drone: Object.freeze({ role: 'fighter', maxHpPct: 70, itemCapacity: 3, rocketCapacity: 2, speedPct: 115, turnPct: 130, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) }),
    ship1: Object.freeze({ role: 'fighter', maxHpPct: 90, itemCapacity: 4, rocketCapacity: 4, speedPct: 110, turnPct: 110, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) }),
    ship9: Object.freeze({ role: 'fighter', maxHpPct: 80, itemCapacity: 4, rocketCapacity: 3, speedPct: 120, turnPct: 115, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) }),
    lab_helix_interceptor: Object.freeze({ role: 'fighter', maxHpPct: 85, itemCapacity: 4, rocketCapacity: 4, speedPct: 108, turnPct: 125, startMachineGuns: Object.freeze(['vector_m7', 'raptor_r9']) }),
});

// Alle anderen Fahrzeuge (Bot-Schiffe wie aircraft, ship2 ...) fliegen mit den
// Star-Cruiser-Werten (heutiges Verhalten), Rolle allrounder.
const FALLBACK_VEHICLE_STATS = ARCADE_VEHICLE_BALANCE_TABLE.ship5;

/**
 * Grundwerte eines Arcade-Fahrzeugs aus der zentralen Tabelle. Unbekannte
 * vehicleId (z. B. reine Bot-Schiffe ohne eigenen Tabelleneintrag) fallen auf
 * die Star-Cruiser-Werte zurück, damit ihr heutiges Verhalten erhalten bleibt.
 * @param {string} vehicleId
 */
export function resolveArcadeVehicleBaseStats(vehicleId) {
    const key = String(vehicleId || '').trim();
    return ARCADE_VEHICLE_BALANCE_TABLE[key] || FALLBACK_VEHICLE_STATS;
}

/**
 * true nur für die Werksschiffe mit eigenem Tabelleneintrag (nicht für den Star-Cruiser-Rückfall).
 * @param {string} vehicleId
 */
export function hasArcadeVehicleBalanceEntry(vehicleId) {
    return Object.prototype.hasOwnProperty.call(ARCADE_VEHICLE_BALANCE_TABLE, String(vehicleId || '').trim());
}

/** Tempo-/Wendigkeitsobergrenze in Prozentpunkten: Grundwert + 100 (siehe arcade-spec.md 1). */
export function resolveArcadeStatCapPct(basePct) {
    return (Number(basePct) || 0) + 100;
}

/**
 * Klemmt einen Tempo-Gesamtfaktor (1 = Einstellungs-Grundtempo; Tabelle x Hangar x Lauf-Belohnung
 * x Arena-Aufwertung, ohne Boost/Items/Portale) auf die Fahrzeug-Obergrenze Grundwert + 100 Punkte.
 * @param {string} vehicleId
 * @param {number} multiplier
 */
export function clampArcadeVehicleSpeedMultiplier(vehicleId, multiplier) {
    const capMultiplier = resolveArcadeStatCapPct(resolveArcadeVehicleBaseStats(vehicleId).speedPct) / 100;
    return Math.max(0, Math.min(capMultiplier, Number(multiplier) || 0));
}

/**
 * Klemmt eine Lagergröße auf [1, ARCADE_STORAGE_MAX_SLOTS].
 * @param {number} capacity
 */
export function clampArcadeStorageCapacity(capacity) {
    const n = Math.floor(Number(capacity) || 0);
    return Math.max(1, Math.min(ARCADE_STORAGE_MAX_SLOTS, n));
}

export default {
    ARCADE_STORAGE_MAX_SLOTS,
    ARCADE_VEHICLE_ROLE_TEMPLATES,
    resolveArcadeVehicleBaseStats,
    hasArcadeVehicleBalanceEntry,
    resolveArcadeStatCapPct,
    clampArcadeVehicleSpeedMultiplier,
    clampArcadeStorageCapacity,
};

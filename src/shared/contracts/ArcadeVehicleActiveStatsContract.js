// ============================================
// ArcadeVehicleActiveStatsContract.js - die eine Rechenstelle für die wirksamen Werte (Paket 3)
// Hangar (Vorschau, Statistik, Bestätigung, Warnung), Run-Start und HUD rechnen nur hierüber.
// stoneSteps kommen immer aus resolveArcadeStoneExtraSteps (bzw. resolveArcadeStoneDraftSteps für
// einen Hangar-Entwurf). Paket 4 ergänzt hier die Waffenwerte. Rein: keine Importe aus core/ui/state.
// ============================================

import { resolveArcadeVehicleBuildStats } from './ArcadeVehicleBuildContract.js';

/**
 * Wirksame Werte eines Fahrzeugs: Grundwerte, Größen-Build und Steine (Obergrenzen eingerechnet).
 * @param {string} vehicleId
 * @param {unknown} profile Profil oder Build mit den Größenfeldern
 * @param {unknown} [stoneSteps] zusätzliche Schritte je Gruppe aus den Steinen
 * @returns {import('./ArcadeVehicleBuildContract.js').ArcadeVehicleBuildStats}
 */
export function resolveArcadeVehicleActiveStats(vehicleId, profile, stoneSteps = null) {
    return resolveArcadeVehicleBuildStats(vehicleId, profile, stoneSteps);
}

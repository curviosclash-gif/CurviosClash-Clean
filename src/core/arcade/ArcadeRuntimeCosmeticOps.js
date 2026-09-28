import { getArcadeRunVehicleBonuses, loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { applyArcadeCosmeticLoadoutToPlayer } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { applyVehiclePartStyle } from '../../shared/contracts/VehiclePartStyleContract.js';
import { resolveArcadeSizedPartStyle } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { isArenaWavesConfig } from '../../shared/contracts/ArenaWavesContract.js';
import { isFivePortalsConfig } from '../../shared/contracts/FivePortalsContract.js';
import { listPlayerShipPartDonors } from '../../shared/vehicle-lab/player-ships/index.js';

// Five portals and arena waves have no run runtime that hands the size build to the strategy
// (gauntlet: ArcadeRunRuntime.setStrategy, endless: setEndlessRunProfile). The profile that sizes
// the mesh below gives it to the strategy here, before the spawn, so the functional size always
// matches the drawn size. Only the size build: the hangar slot bonuses never applied in these runs.
function applyArcadeRunSizeBuild(strategy, profile, runtimeConfig) {
    if (!isFivePortalsConfig(runtimeConfig) && !isArenaWavesConfig(runtimeConfig)) return;
    const build = profile ? getArcadeRunVehicleBonuses(profile).build : null;
    strategy?.applyVehicleUpgrades?.(build ? { build } : null);
}

// Draws the hangar part style on a human's part-built vehicle in arcade runs. Always
// styles the factory config, so repeated runs never compound, and keeps the factory
// bounding box because the player hitbox is read from it. Paket 2a: the part scale comes
// from the functional part sizes (normal runs only), never from a stored style scale.
function applyArcadePartStyle(player, profile, vehicleId, useSizes) {
    const mesh = player?.vehicleMesh;
    if (!mesh?.isModularVehicle || typeof mesh.updateConfig !== 'function') return;
    const data = mesh.userData;
    const matches = !!profile && player.isBot !== true && String(mesh.config?.id || '') === vehicleId;
    const baseConfig = data.arcadePartStyleBase?.config || mesh.config;
    const style = matches
        ? resolveArcadeSizedPartStyle(baseConfig?.parts, profile.partStyle, useSizes ? profile.partSizes : null)
        : null;
    const active = !!style && Object.keys(style).length > 0;
    if (!active && !data.arcadePartStyleBase) return;
    data.arcadePartStyleBase ||= { config: JSON.parse(JSON.stringify(mesh.config)), localBox: mesh.localBox?.clone?.() || null };
    const base = data.arcadePartStyleBase;
    mesh.updateConfig(active ? applyVehiclePartStyle(base.config, style, listPlayerShipPartDonors()) : JSON.parse(JSON.stringify(base.config)));
    if (base.localBox) mesh.localBox = base.localBox.clone();
}

export function applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig) {
    const entityManager = runtimeState?.entityManager;
    const players = Array.isArray(entityManager?.players) ? entityManager.players : [];
    if (!players.length) return;
    const vehicleId = support?._resolveActiveVehicleId?.(runtimeConfig) || 'ship5';
    const recordStore = support?.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
    const profile = loadVehicleProfiles(recordStore)[vehicleId] || null;
    applyArcadeRunSizeBuild(entityManager?.gameModeStrategy, profile, runtimeConfig);
    const arcadeEnabled = runtimeConfig?.arcade?.enabled === true;
    // Visible size = functional size: Daily and weapon race fly at factory size.
    const useSizes = entityManager?.gameModeStrategy?.isNormalArcadeRun?.() === true;
    for (const player of players) {
        applyArcadeCosmeticLoadoutToPlayer(player, profile, arcadeEnabled);
        applyArcadePartStyle(player, arcadeEnabled ? profile : null, vehicleId, useSizes);
    }
}

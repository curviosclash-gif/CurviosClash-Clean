import { loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { applyArcadeCosmeticLoadoutToPlayer } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { applyVehiclePartStyle } from '../../shared/contracts/VehiclePartStyleContract.js';
import { resolveArcadeSizedPartStyle } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { isArenaWavesConfig } from '../../shared/contracts/ArenaWavesContract.js';
import { isFivePortalsConfig } from '../../shared/contracts/FivePortalsContract.js';
import { listPlayerShipPartDonors } from '../../shared/vehicle-lab/player-ships/index.js';
import { createArcadePlayerUpgradeBonusMap, createArcadeVehicleUpgradeBonusMap } from './ArcadeRunVehicleRewardOps.js';
import { isDemolitionConfig } from '../../shared/contracts/DemolitionContract.js';

// Five portals and arena waves have no run runtime that hands the size build to the strategy
// (gauntlet: ArcadeRunRuntime.setStrategy, endless: setEndlessRunProfile). The profile that sizes
// the mesh below gives it to the strategy here, before the spawn, so the functional size always
// matches the drawn size. Only the size build: the hangar slot bonuses never applied in these runs.
function applyArcadeRunSizeBuild(strategy, profiles, players, runtimeConfig) {
    if (!isFivePortalsConfig(runtimeConfig) && !isArenaWavesConfig(runtimeConfig)) return;
    strategy?.applyVehicleUpgrades?.(createArcadeVehicleUpgradeBonusMap(profiles, players, { buildOnly: true }));
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
    const fallbackVehicleId = support?._resolveActiveVehicleId?.(runtimeConfig) || 'ship5';
    const recordStore = support?.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
    const profiles = loadVehicleProfiles(recordStore);
    const demolitionProfiles = Object.create(null);
    if (isDemolitionConfig(runtimeConfig)) {
        const profileIds = runtimeConfig?.arcade?.demolitionProfileIds || [];
        for (const player of entityManager?.humanPlayers || []) {
            const index = Number(player?.index);
            const profileId = String(profileIds?.[index] || '').trim();
            const store = support?.game?.playerProfileManager?.getProfiles?.().some((entry) => entry.id === profileId)
                ? support.game.playerProfileManager.getRecordStorePort(profileId)
                : null;
            if (store) demolitionProfiles[index] = loadVehicleProfiles(store);
        }
    }
    if (isDemolitionConfig(runtimeConfig)) {
        entityManager?.gameModeStrategy?.applyVehicleUpgrades?.(
            createArcadePlayerUpgradeBonusMap(demolitionProfiles, entityManager?.humanPlayers, { buildOnly: true }),
        );
    } else {
        applyArcadeRunSizeBuild(entityManager?.gameModeStrategy, profiles, entityManager?.humanPlayers, runtimeConfig);
    }
    const arcadeEnabled = runtimeConfig?.arcade?.enabled === true;
    // Visible size = functional size: Daily and weapon race fly at factory size.
    const useSizes = entityManager?.gameModeStrategy?.isNormalArcadeRun?.() === true;
    for (const player of players) {
        const vehicleId = String(player?.vehicleId || fallbackVehicleId).trim() || fallbackVehicleId;
        const playerIndex = Number(player?.index);
        const sourceProfiles = isDemolitionConfig(runtimeConfig) ? demolitionProfiles[playerIndex] : profiles;
        const profile = sourceProfiles?.[vehicleId] || null;
        applyArcadeCosmeticLoadoutToPlayer(player, profile, arcadeEnabled);
        applyArcadePartStyle(player, arcadeEnabled ? profile : null, vehicleId, useSizes);
    }
}

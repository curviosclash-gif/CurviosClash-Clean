import { loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { loadArcadeColors, filterArcadePartColors } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { applyArcadeMilestonePattern } from '../../shared/vehicle-lab/ArcadeMilestoneAppearance.js';
import { resolveArcadeMilestoneCosmetics } from '../../shared/contracts/ArcadeMilestoneCosmeticContract.js';
import { applyArcadeCosmeticLoadoutToPlayer } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { applyVehiclePartStyle } from '../../shared/contracts/VehiclePartStyleContract.js';
import { resolveArcadeSizedPartStyle } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { isArenaWavesConfig } from '../../shared/contracts/ArenaWavesContract.js';
import { isFivePortalsConfig } from '../../shared/contracts/FivePortalsContract.js';
import { listPlayerShipPartDonors } from '../../shared/vehicle-lab/player-ships/index.js';
import { createArcadePlayerUpgradeBonusMap, createArcadeVehicleUpgradeBonusMap } from './ArcadeRunVehicleRewardOps.js';
import { isDemolitionConfig } from '../../shared/contracts/DemolitionContract.js';
import { ARCADE_RUN_KINDS, resolveArcadeRuntimeKind } from '../../shared/contracts/ArcadeRunTypeDispatchContract.js';

// Five portals and arena waves have no run runtime that hands the size build to the strategy
// (gauntlet: ArcadeRunRuntime.setStrategy, endless: setEndlessRunProfile). The profile that sizes
// the mesh below gives it to the strategy here, before the spawn, so the functional size always
// matches the drawn size. The build also captures the workshop pool once per run, so a session
// rebuild between maps cannot apply a purchase or level-up made after the run started.
const RUN_STONE_STEPS = new WeakMap();
const RUN_WEAPON_FIELDS = new WeakMap();
const DEMOLITION_STONE_STEPS = new WeakMap();

function applyArcadeRunSizeBuild(support, strategy, profiles, players, runtimeConfig, recordStore) {
    if (!isFivePortalsConfig(runtimeConfig) && !isArenaWavesConfig(runtimeConfig)) return;
    const run = (isFivePortalsConfig(runtimeConfig) ? support?.fivePortalsRuntime : support?.arenaWavesRuntime) || null;
    const kept = run && run.phase !== 'idle' && run.phase !== 'finished' ? RUN_STONE_STEPS.get(run) : null;
    const keptWeapons = run && run.phase !== 'idle' && run.phase !== 'finished' ? RUN_WEAPON_FIELDS.get(run) : null;
    const bonuses = createArcadeVehicleUpgradeBonusMap(profiles, players, {
        buildOnly: true,
        store: recordStore,
        stoneStepsByVehicleId: kept,
        weaponFieldsByVehicleId: keptWeapons,
    });
    if (run) {
        const snapshot = Object.create(null);
        const weaponSnapshot = Object.create(null);
        for (const [vehicleId, value] of Object.entries(bonuses.byVehicleId)) {
            if (value?.build) {
                snapshot[vehicleId] = value.build.stoneSteps;
                weaponSnapshot[vehicleId] = Object.freeze({
                    vehicleLevel: value.build.level,
                    mgLevel: value.build.mgLevel,
                    rocketLevel: value.build.rocketLevel,
                    shieldLevel: value.build.shieldLevel,
                    selectedMachineGunId: value.build.selectedMachineGunId,
                });
            }
        }
        RUN_STONE_STEPS.set(run, snapshot);
        RUN_WEAPON_FIELDS.set(run, weaponSnapshot);
    }
    strategy?.applyVehicleUpgrades?.(bonuses);
    return bonuses;
}

function getDemolitionRunStoneSteps(runtime, profileIds, humanPlayers, profilesByPlayerIndex, storesByPlayerIndex) {
    const current = runtime && runtime.phase !== 'idle' && runtime.phase !== 'finished'
        ? DEMOLITION_STONE_STEPS.get(runtime)
        : null;
    const previousSteps = Object.create(null);
    for (const player of humanPlayers) {
        const playerIndex = Number(player?.index);
        const profileId = String(profileIds?.[playerIndex] || '').trim();
        const vehicleId = String(player?.vehicleId || '').trim();
        const previous = current?.[playerIndex];
        if (previous?.profileId === profileId && previous.vehicleId === vehicleId) {
            previousSteps[playerIndex] = previous;
        }
    }
    const bonuses = createArcadePlayerUpgradeBonusMap(profilesByPlayerIndex, humanPlayers, {
        buildOnly: true,
        storesByPlayerIndex,
        stoneStepsByPlayerIndex: previousSteps,
    });
    const snapshot = Object.create(null);
    for (const player of humanPlayers) {
        const playerIndex = Number(player?.index);
        const build = bonuses.byPlayerIndex[playerIndex]?.build;
        if (!build) continue;
        snapshot[playerIndex] = {
            profileId: String(profileIds?.[playerIndex] || '').trim(),
            vehicleId: build.vehicleId,
            stoneSteps: build.stoneSteps,
        };
    }
    if (runtime) DEMOLITION_STONE_STEPS.set(runtime, snapshot);
    return bonuses;
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
    if (!players.length) return null;
    const fallbackVehicleId = support?._resolveActiveVehicleId?.(runtimeConfig) || 'ship5';
    const recordStore = support?.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
    const profiles = loadVehicleProfiles(recordStore);
    const demolitionProfiles = Object.create(null);
    const demolitionStores = Object.create(null);
    const localArcadeProfiles = support?.arcadeRunRuntime?._playerProfileBindingsActive === true;
    const localArcadeRuntime = localArcadeProfiles ? support.arcadeRunRuntime : null;
    const localRunKind = localArcadeProfiles ? resolveArcadeRuntimeKind(runtimeConfig) : null;
    const dailyChallenge = runtimeConfig?.arcade?.dailyChallenge === true;
    const demolitionRuntime = support?.demolitionSupport?.runtime || null;
    if (isDemolitionConfig(runtimeConfig)) {
        const profileIds = runtimeConfig?.arcade?.demolitionProfileIds || [];
        const runHasBindings = demolitionRuntime?.phase === 'active' || demolitionRuntime?.phase === 'transition';
        const bindings = runHasBindings ? demolitionRuntime?.playerBindings : null;
        const snapshotProfileIds = Array.isArray(profileIds) ? [...profileIds] : [];
        for (const player of entityManager?.humanPlayers || []) {
            const index = Number(player?.index);
            const boundProfileId = bindings?.get(index)?.profileId;
            if (boundProfileId) snapshotProfileIds[index] = boundProfileId;
            const profileId = String(boundProfileId || profileIds?.[index] || '').trim();
            const store = bindings?.get(index)?.store
                || demolitionRuntime?._getRecordStoreForPlayerIndex?.(index, profileId)
                || null;
            if (store) {
                demolitionStores[index] = store;
                demolitionProfiles[index] = loadVehicleProfiles(store);
            }
        }
        entityManager?.gameModeStrategy?.applyVehicleUpgrades?.(
            getDemolitionRunStoneSteps(
                demolitionRuntime,
                snapshotProfileIds,
                entityManager?.humanPlayers || [],
                demolitionProfiles,
                demolitionStores,
            ),
        );
    }
    let playerBuildBonuses = null;
    if (!isDemolitionConfig(runtimeConfig)) {
        if (localArcadeRuntime) {
            const supportsProfileBuild = !dailyChallenge && localRunKind !== ARCADE_RUN_KINDS.WEAPON_RACE;
            if (supportsProfileBuild) {
                playerBuildBonuses = createArcadePlayerUpgradeBonusMap(
                    localArcadeRuntime._playerProfilesByIndex,
                    entityManager?.humanPlayers,
                    {
                        buildOnly: true,
                        storesByPlayerIndex: localArcadeRuntime._playerStoresByIndex,
                        stoneStepsByPlayerIndex: localArcadeRuntime._runStoneStepsByPlayerIndex,
                    },
                );
                entityManager?.gameModeStrategy?.applyVehicleUpgrades?.(playerBuildBonuses);
            }
        } else {
            playerBuildBonuses = applyArcadeRunSizeBuild(support, entityManager?.gameModeStrategy, profiles, entityManager?.humanPlayers, runtimeConfig, recordStore);
        }
    }
    const arcadeEnabled = runtimeConfig?.arcade?.enabled === true;
    // Visible size = functional size: Daily and weapon race fly at factory size.
    const useSizes = entityManager?.gameModeStrategy?.isNormalArcadeRun?.() === true;
    for (const player of players) {
        const vehicleId = String(player?.vehicleId || fallbackVehicleId).trim() || fallbackVehicleId;
        const playerIndex = Number(player?.index);
        const sourceProfiles = isDemolitionConfig(runtimeConfig)
            ? demolitionProfiles[playerIndex]
            : (localArcadeRuntime ? localArcadeRuntime._playerProfilesByIndex[playerIndex] : profiles);
        const profile = sourceProfiles?.[vehicleId] || null;
        const colorStore = demolitionStores[playerIndex] || localArcadeRuntime?._playerStoresByIndex?.[playerIndex] || recordStore;
        const colors = loadArcadeColors(colorStore);
        applyArcadeCosmeticLoadoutToPlayer(player, profile, arcadeEnabled, colors);
        applyArcadePartStyle(player, arcadeEnabled && profile ? { ...profile, partStyle: filterArcadePartColors(profile.partStyle, colors) } : null, vehicleId, useSizes);
        player.arcadeMilestoneCosmetics = resolveArcadeMilestoneCosmetics(arcadeEnabled && !player.isBot ? profile : null);
        applyArcadeMilestonePattern(player.vehicleMesh, arcadeEnabled && !player.isBot ? profile : null);
    }
    return playerBuildBonuses;
}

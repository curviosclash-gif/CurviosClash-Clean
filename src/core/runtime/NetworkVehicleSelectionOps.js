import { getVehicleModularConfig, listBaseVehicleDescriptors } from '../../entities/vehicle-registry.js';
import { BUILT_IN_COMPLEX_VEHICLE_IDS } from '../../shared/vehicle-lab/VehiclePresetCatalogBridge.js';
import { DEFAULT_VEHICLE_ID } from '../../shared/contracts/GameplayConfigContract.js';
import { normalizeLobbyVehicleId } from '../../shared/contracts/LobbyVehicleContract.js';

// Ships every installed copy of the game knows. Hangar and Vehicle Lab builds live in one
// player's storage only; the other machines of a network match could neither draw nor
// simulate them, so they never travel as such.
const SHARED_VEHICLE_IDS = new Set([
    ...listBaseVehicleDescriptors().map((entry) => entry.id),
    ...BUILT_IN_COMPLEX_VEHICLE_IDS,
]);

/**
 * The ship this machine announces for its own pick. An own build flies as the factory ship it
 * was built on, otherwise as the default ship - the same answer on every machine.
 * @param {unknown} vehicleId
 * @returns {string}
 */
export function resolveAnnouncedNetworkVehicleId(vehicleId) {
    const id = normalizeLobbyVehicleId(vehicleId);
    if (SHARED_VEHICLE_IDS.has(id)) return id;
    const baseVehicleId = normalizeLobbyVehicleId(getVehicleModularConfig(String(vehicleId ?? ''))?.baseVehicleId);
    return SHARED_VEHICLE_IDS.has(baseVehicleId) ? baseVehicleId : DEFAULT_VEHICLE_ID;
}

/**
 * The ship a lobby member flies on every machine. Deliberately ignores local builds with the
 * same id: a receiver must not resolve another player's id against its own storage.
 * @param {unknown} vehicleId
 * @returns {string} '' when the member never announced a vehicle (older client)
 */
export function resolveMemberNetworkVehicleId(vehicleId) {
    const id = normalizeLobbyVehicleId(vehicleId);
    if (!id) return '';
    return SHARED_VEHICLE_IDS.has(id) ? id : DEFAULT_VEHICLE_ID;
}

// Pick each lobby service is announcing right now, so a burst of settings changes sends it once.
// A refused announcement (older server without the vehicle route, match start under way) is
// forgotten and tried again with the next settings change.
const announcedVehicleByBridge = new WeakMap();

/**
 * Announces the local pick when the lobby does not know it yet.
 * @param {{ settings?: any, menuMultiplayerBridge?: any }} options
 */
export function syncLocalLobbyVehicle({ settings = null, menuMultiplayerBridge = null } = {}) {
    if (!menuMultiplayerBridge || typeof menuMultiplayerBridge.setLobbyVehicle !== 'function') return null;
    const sessionState = menuMultiplayerBridge.getSessionState?.();
    const members = Array.isArray(sessionState?.members) ? sessionState.members : [];
    const localMember = members.find((member) => member?.isLocal === true);
    if (sessionState?.joined !== true || !localMember) return null;
    const vehicleId = resolveAnnouncedNetworkVehicleId(settings?.vehicles?.PLAYER_1);
    // A LAN host with two players at its screen announces the second seat's ship as well.
    const hasSecondSeat = localMember.isHost === true && Number(sessionState.localPlayerCount) >= 2;
    const secondVehicleId = hasSecondSeat ? resolveAnnouncedNetworkVehicleId(settings?.vehicles?.PLAYER_2) : '';
    if (normalizeLobbyVehicleId(localMember.vehicleId) === vehicleId
        && normalizeLobbyVehicleId(localMember.secondVehicleId) === secondVehicleId) return null;
    const announcement = `${vehicleId}|${secondVehicleId}`;
    if (announcedVehicleByBridge.get(menuMultiplayerBridge) === announcement) return null;
    announcedVehicleByBridge.set(menuMultiplayerBridge, announcement);
    return Promise.resolve(hasSecondSeat
        ? menuMultiplayerBridge.setLobbyVehicle(vehicleId, { secondVehicleId })
        : menuMultiplayerBridge.setLobbyVehicle(vehicleId))
        .then((result) => {
            if (result?.ok === false) announcedVehicleByBridge.delete(menuMultiplayerBridge);
            return result;
        })
        .catch(() => {
            announcedVehicleByBridge.delete(menuMultiplayerBridge);
            return null;
        });
}

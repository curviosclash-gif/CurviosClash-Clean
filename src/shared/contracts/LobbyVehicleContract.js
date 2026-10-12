// The vehicle a lobby member flies in a network match. Every member announces its own pick
// when it creates or joins a lobby and on every change; the LAN and online signaling servers
// keep it per member and hand it to everybody with the member list. Servers and lobby clients
// pass the value through this one normalizer, so a member entry carries a plain, bounded id
// and never a build plan. Which ids every machine actually knows is decided in the runtime
// (NetworkVehicleSelectionOps), because only the game build ships the vehicle catalog.

export const LOBBY_VEHICLE_ID_MAX_LENGTH = 48;

const LOBBY_VEHICLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * @param {unknown} value announced vehicle id in any shape, e.g. from an older client
 * @returns {string} the trimmed id, or '' when nothing usable was announced
 */
export function normalizeLobbyVehicleId(value) {
    if (typeof value !== 'string') return '';
    const vehicleId = value.trim();
    return vehicleId.length <= LOBBY_VEHICLE_ID_MAX_LENGTH && LOBBY_VEHICLE_ID_PATTERN.test(vehicleId)
        ? vehicleId
        : '';
}

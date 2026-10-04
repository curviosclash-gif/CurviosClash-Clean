export const ARCADE_TEST_FLIGHT_REQUEST_KEY = 'cuviosclash.arcade-test-flight-request';
export const ARCADE_TEST_FLIGHT_RUN_TYPE = 'hangar_test';

export function isArcadeTestFlightBuildActive(draft, active) {
    if (!draft || !active || draft.vehicleId !== active.vehicleId) return false;
    for (const field of ['slots', 'stoneSlots']) {
        const keys = new Set([...Object.keys(draft[field] || {}), ...Object.keys(active[field] || {})]);
        for (const key of keys) if ((draft[field]?.[key] ?? null) !== (active[field]?.[key] ?? null)) return false;
    }
    return true;
}

export function createArcadeTestFlightRequest({ vehicleId = '', profileId = '', dirty = false, nowMs = Date.now() } = {}) {
    if (dirty || !String(vehicleId || '').trim()) return { ok: false, reason: 'activate_draft_first' };
    return { ok: true, request: { vehicleId: String(vehicleId), profileId: String(profileId), requestedAtMs: nowMs } };
}

export function readArcadeTestFlightRequest(value, profileId = '', nowMs = Date.now()) {
    if (!value || !String(value.vehicleId || '').trim() || String(value.profileId || '') !== String(profileId)
        || !Number.isFinite(value.requestedAtMs) || nowMs - value.requestedAtMs > 30000 || nowMs < value.requestedAtMs) return null;
    return { ...value };
}

export function isArcadeTestFlight(config) {
    return config?.arcade?.enabled === true && config.arcade.runType === ARCADE_TEST_FLIGHT_RUN_TYPE;
}

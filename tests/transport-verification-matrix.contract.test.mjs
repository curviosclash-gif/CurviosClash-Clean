/**
 * Transport Verification Matrix Contract Tests (V64 64.8.1)
 *
 * Derives and asserts the canonical verification matrix for all six Desktop
 * session/role scenarios: single, splitscreen, lan-host, lan-client,
 * online-host, online-client.
 *
 * Each row in the matrix characterises:
 *   - network requirement (none / local-network / internet)
 *   - offline compatibility
 *   - transport-level host/join capability (canHost, canJoin)
 *   - which connectivity state(s) the scenario is valid in
 *   - whether it is a network session
 *
 * Source contracts consumed:
 *   - DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX (network req, offlineCompatible)
 *   - resolveRuntimeSessionCapabilities (canHost, canJoin, isNetworkSession)
 *   - resolveDesktopConnectivityProfile (connectivity state mapping)
 *   - resolveDesktopMultiplayerRoleSurface for DESKTOP_APP
 *   - DESKTOP_CONNECTIVITY_STATES (state enum)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    RUNTIME_SESSION_TYPES,
    MULTIPLAYER_TRANSPORTS,
    MULTIPLAYER_SESSION_ROLES,
    resolveRuntimeSessionCapabilities,
} from '../src/shared/contracts/RuntimeSessionContract.js';
import {
    DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX,
    DESKTOP_CONNECTIVITY_STATES,
    resolveDesktopConnectivityProfile,
    resolveDesktopMultiplayerRoleSurface,
} from '../src/shared/contracts/DesktopMultiplayerRoleContract.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityData.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function lanCaps(role) {
    return resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.LAN,
        multiplayerSessionRole: role,
    });
}

function onlineCaps(role) {
    return resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.ONLINE,
        multiplayerSessionRole: role,
    });
}

// ── 1. DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX — all six rows ────────────────

test('64.8.1 matrix: single — offline-compatible, no network, no transport', () => {
    const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.SINGLE];

    assert.equal(row.sessionType, RUNTIME_SESSION_TYPES.SINGLE);
    assert.equal(row.networkRequirement, 'none');
    assert.equal(row.offlineCompatible, true);
    assert.equal(row.multiplayerTransportRequired, null);
    assert.equal(row.splitscreenCompatible, false);
});

test('64.8.1 matrix: splitscreen — offline-compatible, no network, splitscreen allowed', () => {
    const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.SPLITSCREEN];

    assert.equal(row.sessionType, RUNTIME_SESSION_TYPES.SPLITSCREEN);
    assert.equal(row.networkRequirement, 'none');
    assert.equal(row.offlineCompatible, true);
    assert.equal(row.multiplayerTransportRequired, null);
    assert.equal(row.splitscreenCompatible, true);
});

test('64.8.1 matrix: lan-host — local-network required, not offline-compatible', () => {
    const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.LAN];

    assert.equal(row.sessionType, RUNTIME_SESSION_TYPES.LAN);
    assert.equal(row.networkRequirement, 'local-network');
    assert.equal(row.offlineCompatible, false);
    assert.equal(row.multiplayerTransportRequired, MULTIPLAYER_TRANSPORTS.LAN);
    assert.equal(row.splitscreenCompatible, false);
});

test('64.8.1 matrix: lan-client — same row as lan-host (transport-level, not role-level)', () => {
    // Host and client share the same transport row; role is resolved separately.
    const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.LAN];

    assert.equal(row.networkRequirement, 'local-network');
    assert.equal(row.offlineCompatible, false);
    assert.equal(row.multiplayerTransportRequired, MULTIPLAYER_TRANSPORTS.LAN);
});

test('64.8.1 matrix: online-host — internet required, not offline-compatible', () => {
    const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.ONLINE];

    assert.equal(row.sessionType, RUNTIME_SESSION_TYPES.ONLINE);
    assert.equal(row.networkRequirement, 'internet');
    assert.equal(row.offlineCompatible, false);
    assert.equal(row.multiplayerTransportRequired, MULTIPLAYER_TRANSPORTS.ONLINE);
    assert.equal(row.splitscreenCompatible, false);
});

test('64.8.1 matrix: online-client — same row as online-host (transport-level, not role-level)', () => {
    const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.ONLINE];

    assert.equal(row.networkRequirement, 'internet');
    assert.equal(row.offlineCompatible, false);
    assert.equal(row.multiplayerTransportRequired, MULTIPLAYER_TRANSPORTS.ONLINE);
});

// ── 2. resolveRuntimeSessionCapabilities — canHost / canJoin per scenario ────

test('64.8.1 caps: single — canHost=false, canJoin=false, isNetworkSession=false', () => {
    const caps = resolveRuntimeSessionCapabilities({ sessionType: RUNTIME_SESSION_TYPES.SINGLE });

    assert.equal(caps.canHost, false);
    assert.equal(caps.canJoin, false);
    assert.equal(caps.isNetworkSession, false);
    assert.equal(caps.isFallbackTransport, false);
    assert.equal(caps.isLegacyTransport, false);
});

test('64.8.1 caps: splitscreen — canHost=false, canJoin=false, isNetworkSession=false', () => {
    const caps = resolveRuntimeSessionCapabilities({ sessionType: RUNTIME_SESSION_TYPES.SPLITSCREEN });

    assert.equal(caps.canHost, false);
    assert.equal(caps.canJoin, false);
    assert.equal(caps.isNetworkSession, false);
    assert.equal(caps.isFallbackTransport, false);
    assert.equal(caps.isLegacyTransport, false);
});

test('64.8.1 caps: lan-host — canHost=true, canJoin=true, isNetworkSession=true', () => {
    const caps = lanCaps(MULTIPLAYER_SESSION_ROLES.HOST);

    assert.equal(caps.canHost, true);
    assert.equal(caps.canJoin, true);
    assert.equal(caps.isNetworkSession, true);
    assert.equal(caps.isFallbackTransport, false);
    assert.equal(caps.isLegacyTransport, false);
    assert.equal(caps.adapterSessionType, RUNTIME_SESSION_TYPES.LAN);
});

test('64.8.1 caps: lan-client — canHost=true, canJoin=true, isNetworkSession=true', () => {
    const caps = lanCaps(MULTIPLAYER_SESSION_ROLES.CLIENT);

    assert.equal(caps.canHost, true);
    assert.equal(caps.canJoin, true);
    assert.equal(caps.isNetworkSession, true);
    assert.equal(caps.adapterSessionType, RUNTIME_SESSION_TYPES.LAN);
});

test('64.8.1 caps: online-host — canHost=true, canJoin=true, isNetworkSession=true', () => {
    const caps = onlineCaps(MULTIPLAYER_SESSION_ROLES.HOST);

    assert.equal(caps.canHost, true);
    assert.equal(caps.canJoin, true);
    assert.equal(caps.isNetworkSession, true);
    assert.equal(caps.isFallbackTransport, false);
    assert.equal(caps.isLegacyTransport, false);
    assert.equal(caps.adapterSessionType, RUNTIME_SESSION_TYPES.ONLINE);
});

test('64.8.1 caps: online-client — canHost=true, canJoin=true, isNetworkSession=true', () => {
    const caps = onlineCaps(MULTIPLAYER_SESSION_ROLES.CLIENT);

    assert.equal(caps.canHost, true);
    assert.equal(caps.canJoin, true);
    assert.equal(caps.isNetworkSession, true);
    assert.equal(caps.adapterSessionType, RUNTIME_SESSION_TYPES.ONLINE);
});

// ── 3. resolveDesktopConnectivityProfile — connectivity state mapping ─────────

test('64.8.1 connectivity: single and splitscreen valid in NO_NETWORK state', () => {
    const profile = resolveDesktopConnectivityProfile();

    assert.ok(profile.noNetworkSessionTypes.includes(RUNTIME_SESSION_TYPES.SINGLE));
    assert.ok(profile.noNetworkSessionTypes.includes(RUNTIME_SESSION_TYPES.SPLITSCREEN));
    assert.equal(profile.noNetworkSessionTypes.length, 2);
});

test('64.8.1 connectivity: lan (host+client) valid in LOCAL_NETWORK_ONLY state', () => {
    const profile = resolveDesktopConnectivityProfile();

    assert.ok(profile.localNetworkOnlySessionTypes.includes(RUNTIME_SESSION_TYPES.MULTIPLAYER));
    assert.equal(profile.localNetworkOnlySessionTypes.length, 1);
});

test('64.8.1 connectivity: online (host+client) requires INTERNET state', () => {
    const profile = resolveDesktopConnectivityProfile();

    assert.ok(profile.internetRequiredSessionTypes.includes(RUNTIME_SESSION_TYPES.ONLINE));
    assert.equal(profile.internetRequiredSessionTypes.length, 1);
});

test('64.8.1 connectivity: profile provides user-facing hints for Online and LAN', () => {
    const profile = resolveDesktopConnectivityProfile();

    assert.ok(typeof profile.onlineUnavailableHint === 'string' && profile.onlineUnavailableHint.length > 0);
    assert.ok(typeof profile.lanOfflineHint === 'string' && profile.lanOfflineHint.length > 0);
});

test('64.8.1 connectivity: DESKTOP_CONNECTIVITY_STATES has the three expected states', () => {
    assert.equal(DESKTOP_CONNECTIVITY_STATES.NO_NETWORK, 'no-network');
    assert.equal(DESKTOP_CONNECTIVITY_STATES.LOCAL_NETWORK_ONLY, 'local-network-only');
    assert.equal(DESKTOP_CONNECTIVITY_STATES.INTERNET, 'internet');
    assert.equal(Object.keys(DESKTOP_CONNECTIVITY_STATES).length, 3);
});

// ── 4. Desktop surface role gate — host/join transports for DESKTOP_APP ───────

test('64.8.1 surface: desktop-app can host on lan and online transports', () => {
    const surface = resolveDesktopMultiplayerRoleSurface(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    assert.equal(surface.canHost, true);
    assert.ok(surface.hostTransports.includes(MULTIPLAYER_TRANSPORTS.LAN));
    assert.ok(surface.hostTransports.includes(MULTIPLAYER_TRANSPORTS.ONLINE));
});

test('64.8.1 surface: desktop-app can join on lan and online transports', () => {
    const surface = resolveDesktopMultiplayerRoleSurface(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    assert.equal(surface.canJoin, true);
    assert.ok(surface.joinTransports.includes(MULTIPLAYER_TRANSPORTS.LAN));
    assert.ok(surface.joinTransports.includes(MULTIPLAYER_TRANSPORTS.ONLINE));
});

test('64.8.1 surface: desktop-app offline session types exclude multiplayer', () => {
    const surface = resolveDesktopMultiplayerRoleSurface(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    assert.ok(!surface.offlineSessionTypes.includes('multiplayer'));
    assert.ok(surface.offlineSessionTypes.includes(RUNTIME_SESSION_TYPES.SINGLE)
        || surface.offlineSessionTypes.includes(RUNTIME_SESSION_TYPES.SPLITSCREEN)
        || surface.offlineSessionTypes.length === 0);
});

// ── 5. Cross-contract consistency ─────────────────────────────────────────────

test('64.8.1 consistency: offline-compatible matrix rows have canHost=false and canJoin=false', () => {
    const offlineTypes = [RUNTIME_SESSION_TYPES.SINGLE, RUNTIME_SESSION_TYPES.SPLITSCREEN];

    for (const sessionType of offlineTypes) {
        const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[sessionType];
        const caps = resolveRuntimeSessionCapabilities({ sessionType });

        assert.equal(row.offlineCompatible, true, `${sessionType}: matrix must be offlineCompatible`);
        assert.equal(caps.canHost, false, `${sessionType}: canHost must be false`);
        assert.equal(caps.canJoin, false, `${sessionType}: canJoin must be false`);
    }
});

test('64.8.1 consistency: network-required matrix rows have canHost=true and canJoin=true', () => {
    const networkTypes = [RUNTIME_SESSION_TYPES.LAN, RUNTIME_SESSION_TYPES.ONLINE];

    for (const sessionType of networkTypes) {
        const row = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[sessionType];
        const caps = resolveRuntimeSessionCapabilities({ sessionType });

        assert.equal(row.offlineCompatible, false, `${sessionType}: matrix must NOT be offlineCompatible`);
        assert.ok(row.multiplayerTransportRequired !== null, `${sessionType}: must require a transport`);
        assert.equal(caps.canHost, true, `${sessionType}: canHost must be true`);
        assert.equal(caps.canJoin, true, `${sessionType}: canJoin must be true`);
        assert.equal(caps.isNetworkSession, true, `${sessionType}: isNetworkSession must be true`);
    }
});

test('64.8.1 consistency: single and splitscreen not in localNetworkOnly or internetRequired profile sets', () => {
    const profile = resolveDesktopConnectivityProfile();
    const offlineTypes = [RUNTIME_SESSION_TYPES.SINGLE, RUNTIME_SESSION_TYPES.SPLITSCREEN];

    for (const sessionType of offlineTypes) {
        assert.ok(
            !profile.localNetworkOnlySessionTypes.includes(sessionType),
            `${sessionType} must not appear in localNetworkOnlySessionTypes`
        );
        assert.ok(
            !profile.internetRequiredSessionTypes.includes(sessionType),
            `${sessionType} must not appear in internetRequiredSessionTypes`
        );
    }
});

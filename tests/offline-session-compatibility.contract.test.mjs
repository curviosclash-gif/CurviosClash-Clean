/**
 * Offline-Session-Compatibility Contract Tests (V64 64.7.1)
 *
 * Regression guard: `single` and `splitscreen` must remain stable and
 * independent of the Multiplayer/LAN/Online refactors introduced in V64.
 *
 * Covers:
 * - RuntimeSessionContract resolves offline types correctly
 * - resolveRuntimeSessionCapabilities: canHost/canJoin=false for offline
 * - DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX: offline-compatible flags stable
 * - createRuntimeSessionAdapter: LocalSessionAdapter for single/splitscreen
 * - MatchStartValidationService: no multiplayer gate for offline sessions
 * - waitForRuntimePlayersLoaded: returns immediately for LocalSessionAdapter
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    RUNTIME_SESSION_TYPES,
    resolveRuntimeSessionContract,
    resolveRuntimeSessionCapabilities,
    normalizeRuntimeSessionType,
} from '../src/shared/contracts/RuntimeSessionContract.js';
import {
    DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX,
    resolveDesktopMultiplayerRoleSurface,
} from '../src/shared/contracts/DesktopMultiplayerRoleContract.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityData.js';
import { createRuntimeSessionAdapter } from '../src/core/runtime/RuntimeSessionLifecycleService.js';
import { LocalSessionAdapter } from '../src/core/session/LocalSessionAdapter.js';
import { resolveMatchStartValidationIssue } from '../src/core/runtime/MatchStartValidationService.js';
import { waitForRuntimePlayersLoaded } from '../src/core/runtime/RuntimeSessionLifecycleService.js';

// ── 1. RuntimeSessionContract — offline resolution ──────────────────────────

test('64.7.1: single resolves as offline, non-network session', () => {
    const contract = resolveRuntimeSessionContract({ sessionType: RUNTIME_SESSION_TYPES.SINGLE });

    assert.equal(contract.sessionType, 'single');
    assert.equal(contract.adapterSessionType, 'single');
    assert.equal(contract.isNetworkSession, false);
    assert.equal(contract.isLegacyTransport, false);
    assert.equal(contract.transportAudienceLabel, 'Offline');
    assert.match(contract.transportDiagnosticLabel, /offline:single/);
});

test('64.7.1: splitscreen resolves as offline, non-network session', () => {
    const contract = resolveRuntimeSessionContract({ sessionType: RUNTIME_SESSION_TYPES.SPLITSCREEN });

    assert.equal(contract.sessionType, 'splitscreen');
    assert.equal(contract.adapterSessionType, 'splitscreen');
    assert.equal(contract.isNetworkSession, false);
    assert.equal(contract.isLegacyTransport, false);
    assert.equal(contract.transportAudienceLabel, 'Offline');
    assert.match(contract.transportDiagnosticLabel, /offline:splitscreen/);
});

test('64.7.1: single/splitscreen are not legacy transports', () => {
    const single = resolveRuntimeSessionContract({ sessionType: RUNTIME_SESSION_TYPES.SINGLE });
    const splitscreen = resolveRuntimeSessionContract({ sessionType: RUNTIME_SESSION_TYPES.SPLITSCREEN });

    assert.equal(single.isFallbackTransport, false);
    assert.equal(splitscreen.isFallbackTransport, false);
    assert.equal(single.usesMenuStorageBridge, false);
    assert.equal(splitscreen.usesMenuStorageBridge, false);
});

test('64.7.1: normalizeRuntimeSessionType defaults to single for unknown values', () => {
    assert.equal(normalizeRuntimeSessionType('unknown-transport'), 'single');
    assert.equal(normalizeRuntimeSessionType(''), 'single');
    assert.equal(normalizeRuntimeSessionType(null), 'single');
    assert.equal(normalizeRuntimeSessionType(undefined), 'single');
    assert.equal(normalizeRuntimeSessionType('single'), 'single');
    assert.equal(normalizeRuntimeSessionType('splitscreen'), 'splitscreen');
});

// ── 2. resolveRuntimeSessionCapabilities — canHost/canJoin=false ─────────────

test('64.7.1: single has canHost=false, canJoin=false (not a network role)', () => {
    const caps = resolveRuntimeSessionCapabilities({ sessionType: RUNTIME_SESSION_TYPES.SINGLE });

    assert.equal(caps.canHost, false);
    assert.equal(caps.canJoin, false);
    assert.equal(caps.isNetworkSession, false);
});

test('64.7.1: splitscreen has canHost=false, canJoin=false (not a network role)', () => {
    const caps = resolveRuntimeSessionCapabilities({ sessionType: RUNTIME_SESSION_TYPES.SPLITSCREEN });

    assert.equal(caps.canHost, false);
    assert.equal(caps.canJoin, false);
    assert.equal(caps.isNetworkSession, false);
});

test('64.7.1: lan/online still have canHost=true, canJoin=true (regression guard)', () => {
    const lanCaps = resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.MULTIPLAYER,
        multiplayerTransport: 'lan',
    });
    const onlineCaps = resolveRuntimeSessionCapabilities({
        sessionType: RUNTIME_SESSION_TYPES.MULTIPLAYER,
        multiplayerTransport: 'online',
    });

    assert.equal(lanCaps.canHost, true);
    assert.equal(lanCaps.canJoin, true);
    assert.equal(onlineCaps.canHost, true);
    assert.equal(onlineCaps.canJoin, true);
});

// ── 3. DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX — offline flags ──────────────

test('64.7.1: compatibility matrix marks single as offline-compatible', () => {
    const entry = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.SINGLE];

    assert.ok(entry, 'single entry must exist in matrix');
    assert.equal(entry.offlineCompatible, true);
    assert.equal(entry.multiplayerTransportRequired, null);
    assert.equal(entry.networkRequirement, 'none');
    assert.equal(entry.splitscreenCompatible, false);
});

test('64.7.1: compatibility matrix marks splitscreen as offline-compatible', () => {
    const entry = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.SPLITSCREEN];

    assert.ok(entry, 'splitscreen entry must exist in matrix');
    assert.equal(entry.offlineCompatible, true);
    assert.equal(entry.multiplayerTransportRequired, null);
    assert.equal(entry.networkRequirement, 'none');
    assert.equal(entry.splitscreenCompatible, true);
});

test('64.7.1: compatibility matrix marks lan/online as NOT offline-compatible', () => {
    const lan = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.LAN];
    const online = DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX[RUNTIME_SESSION_TYPES.ONLINE];

    assert.equal(lan.offlineCompatible, false);
    assert.equal(online.offlineCompatible, false);
});

test('64.7.1: desktop surface includes single and splitscreen as offline session types', () => {
    const desktopRole = resolveDesktopMultiplayerRoleSurface(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    assert.ok(desktopRole.offlineSessionTypes.includes('single'), 'single must be in desktop offline types');
    assert.ok(desktopRole.offlineSessionTypes.includes('splitscreen'), 'splitscreen must be in desktop offline types');
});

// ── 4. createRuntimeSessionAdapter — LocalSessionAdapter for offline ──────────

test('64.7.1: createRuntimeSessionAdapter returns LocalSessionAdapter for single', async () => {
    const adapter = await createRuntimeSessionAdapter({ sessionType: RUNTIME_SESSION_TYPES.SINGLE });
    assert.ok(adapter instanceof LocalSessionAdapter, 'single must use LocalSessionAdapter');
    adapter.dispose();
});

test('64.7.1: createRuntimeSessionAdapter returns LocalSessionAdapter for splitscreen', async () => {
    const adapter = await createRuntimeSessionAdapter({ sessionType: RUNTIME_SESSION_TYPES.SPLITSCREEN });
    assert.ok(adapter instanceof LocalSessionAdapter, 'splitscreen must use LocalSessionAdapter');
    adapter.dispose();
});

test('64.7.1: LocalSessionAdapter connects locally without network for single (numHumans=1)', async () => {
    const adapter = new LocalSessionAdapter();
    await adapter.connect({ numHumans: 1 });
    const players = adapter.getPlayers();

    assert.equal(adapter.isConnected, true);
    assert.equal(adapter.isHost, true);
    assert.equal(players.length, 1);
    assert.equal(players[0].isLocal, true);
    adapter.dispose();
});

test('64.7.1: LocalSessionAdapter connects locally without network for splitscreen (numHumans=2)', async () => {
    const adapter = new LocalSessionAdapter();
    await adapter.connect({ numHumans: 2 });
    const players = adapter.getPlayers();

    assert.equal(adapter.isConnected, true);
    assert.equal(players.length, 2);
    assert.ok(players.every((p) => p.isLocal), 'all players must be local in splitscreen');
    adapter.dispose();
});

// ── 5. MatchStartValidationService — no multiplayer gate for offline ──────────

const VALID_MAPS = { standard: { key: 'standard', modePaths: ['normal'] } };

test('64.7.1: single session with valid map/vehicle passes validation without multiplayer check', () => {
    const issue = resolveMatchStartValidationIssue({
        settings: {
            mapKey: 'standard',
            vehicles: { PLAYER_1: 'jet-a' },
            localSettings: { sessionType: 'single', modePath: 'normal', themeMode: 'dunkel' },
            gameMode: 'CLASSIC',
        },
        maps: VALID_MAPS,
        productSurfaceId: 'desktop-app',
    });

    assert.equal(issue, null, 'single session with valid settings must have no validation issue');
});

test('64.7.1: splitscreen session with two vehicles passes validation without multiplayer check', () => {
    const issue = resolveMatchStartValidationIssue({
        settings: {
            mapKey: 'standard',
            vehicles: { PLAYER_1: 'jet-a', PLAYER_2: 'jet-b' },
            localSettings: { sessionType: 'splitscreen', modePath: 'normal', themeMode: 'dunkel' },
            gameMode: 'CLASSIC',
        },
        maps: VALID_MAPS,
        productSurfaceId: 'desktop-app',
    });

    assert.equal(issue, null, 'splitscreen with both vehicles must have no validation issue');
});

test('64.7.1: splitscreen session without P2 vehicle fails with vehicle-only error, not multiplayer error', () => {
    const issue = resolveMatchStartValidationIssue({
        settings: {
            mapKey: 'standard',
            vehicles: { PLAYER_1: 'jet-a' },
            localSettings: { sessionType: 'splitscreen', modePath: 'normal', themeMode: 'dunkel' },
            gameMode: 'CLASSIC',
        },
        maps: VALID_MAPS,
        productSurfaceId: 'desktop-app',
    });

    assert.ok(issue !== null, 'missing P2 vehicle must produce a validation issue');
    assert.equal(issue.fieldKey, 'vehicleP2', 'error must target vehicleP2, not multiplayer');
});

test('64.7.1: single session ignores lobby/session state — no multiplayer join requirement', () => {
    // Even with an empty multiplayer session state, single must pass if vehicles/maps are valid
    const issue = resolveMatchStartValidationIssue({
        settings: {
            mapKey: 'standard',
            vehicles: { PLAYER_1: 'jet-a' },
            localSettings: { sessionType: 'single', modePath: 'normal', themeMode: 'dunkel' },
            gameMode: 'CLASSIC',
        },
        multiplayerSessionState: { joined: false, lobbyCode: '', memberCount: 0 },
        maps: VALID_MAPS,
        productSurfaceId: 'desktop-app',
    });

    assert.equal(issue, null, 'single must not be blocked by empty multiplayer session state');
});

// ── 6. waitForRuntimePlayersLoaded — immediate return for LocalSessionAdapter ─

test('64.7.1: waitForRuntimePlayersLoaded returns immediately when session is LocalSessionAdapter', async () => {
    const adapter = new LocalSessionAdapter();
    await adapter.connect({ numHumans: 1 });

    const facade = { session: adapter };

    // Must resolve without timeout
    const start = Date.now();
    await waitForRuntimePlayersLoaded(facade);
    const elapsed = Date.now() - start;

    adapter.dispose();
    assert.ok(elapsed < 500, `waitForRuntimePlayersLoaded must resolve immediately for LocalSessionAdapter (elapsed: ${elapsed}ms)`);
});

test('64.7.1: waitForRuntimePlayersLoaded returns immediately when session is null (offline teardown guard)', async () => {
    const facade = { session: null };

    const start = Date.now();
    await waitForRuntimePlayersLoaded(facade);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 100, 'must resolve immediately when session is null');
});

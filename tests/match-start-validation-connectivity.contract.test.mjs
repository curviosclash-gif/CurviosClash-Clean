import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMatchStartValidationIssue } from '../src/core/runtime/MatchStartValidationService.js';
import { resolveDesktopConnectivityProfile } from '../src/shared/contracts/DesktopMultiplayerRoleContract.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityData.js';

function createBaseSettings(overrides = {}) {
    return {
        mapKey: 'standard',
        gameMode: 'CLASSIC',
        vehicles: {
            PLAYER_1: 'falcon',
        },
        localSettings: {
            sessionType: 'multiplayer',
            multiplayerTransport: 'lan',
            modePath: 'normal',
            themeMode: 'dunkel',
        },
        ...overrides,
    };
}

test('match-start validation uses online connectivity hint when online lobby is disconnected', () => {
    const profile = resolveDesktopConnectivityProfile();
    const issue = resolveMatchStartValidationIssue({
        settings: createBaseSettings({
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'online',
                modePath: 'normal',
                themeMode: 'dunkel',
            },
        }),
        multiplayerSessionState: {
            joined: true,
            connected: false,
            transport: 'online',
            lobbyCode: 'ABCD1234',
            isHost: true,
            memberCount: 2,
            allReady: true,
        },
        maps: {
            standard: {},
        },
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });

    assert.equal(issue?.fieldKey, 'multiplayer');
    assert.ok(String(issue?.message || '').includes(profile.onlineUnavailableHint));
    assert.ok(String(issue?.fieldMessage || '').includes(profile.onlineUnavailableHint));
});

test('match-start validation appends LAN connectivity hint for missing LAN lobby join', () => {
    const profile = resolveDesktopConnectivityProfile();
    const issue = resolveMatchStartValidationIssue({
        settings: createBaseSettings({
            localSettings: {
                sessionType: 'multiplayer',
                multiplayerTransport: 'lan',
                modePath: 'normal',
                themeMode: 'dunkel',
            },
        }),
        multiplayerSessionState: {
            joined: false,
            connected: false,
            transport: 'lan',
            lobbyCode: '',
            isHost: false,
        },
        maps: {
            standard: {},
        },
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });

    assert.equal(issue?.fieldKey, 'multiplayer');
    assert.ok(String(issue?.fieldMessage || '').includes(profile.lanOfflineHint));
});

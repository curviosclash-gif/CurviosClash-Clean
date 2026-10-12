import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';
import { requestArcadeReplayPlayback } from '../src/ui/MatchFlowTransitionHotspots.js';
import {
    WEAPON_RACE_GHOST_ROUTE_ID,
    WEAPON_RACE_MAP_KEY,
    WEAPON_RACE_RUN_TYPE,
} from '../src/shared/contracts/WeaponRaceContract.js';

// The round start and the menu replay fallback both start a ghost for "the current route". They
// must name the same route: the Weapon Race records its ghost under its own route ID, not under
// the parcours route of the map it runs on.

function createWeaponRaceGame() {
    return {
        arena: {
            currentMapDefinition: { parcours: { routeId: 'parcours_assault_route' } },
            currentMapKey: WEAPON_RACE_MAP_KEY,
        },
        runtimeConfig: {
            arcade: { enabled: true, runType: WEAPON_RACE_RUN_TYPE },
            session: { mapKey: WEAPON_RACE_MAP_KEY, sessionType: 'single' },
        },
    };
}

function recordGhostStarts() {
    const starts = [];
    return {
        starts,
        port: {
            requestArcadeReplayPlayback: () => ({ ok: false, code: 'replay_player_unavailable' }),
            applyArcadeParcoursEvent(payload) {
                starts.push({ routeId: payload.routeId, routeAliases: payload.routeAliases });
                return { started: true, routeId: payload.routeId };
            },
        },
    };
}

test('the menu replay fallback starts the Weapon Race ghost under its own route', () => {
    const { starts, port } = recordGhostStarts();

    requestArcadeReplayPlayback(port, createWeaponRaceGame());

    assert.deepEqual(starts, [{ routeId: WEAPON_RACE_GHOST_ROUTE_ID, routeAliases: [WEAPON_RACE_GHOST_ROUTE_ID] }]);
});

test('round start and menu replay fallback name the same ghost route', () => {
    for (const game of [createWeaponRaceGame(), {
        arena: { currentMapDefinition: { parcours: { routeId: 'route_sigma' } }, currentMapKey: 'trench' },
        runtimeConfig: { session: { mapKey: 'trench' } },
    }]) {
        const menu = recordGhostStarts();
        requestArcadeReplayPlayback(menu.port, game);
        const round = recordGhostStarts();
        new MatchFlowLifecycleController({ game, runtimePort: round.port })._requestGhostPlaybackForActiveRoute();

        assert.deepEqual(menu.starts, round.starts);
    }
});

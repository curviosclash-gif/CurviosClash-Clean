import assert from 'node:assert/strict';
import test from 'node:test';

import { applyParcoursLeaderboardEvent } from '../src/core/arcade/ArcadeParcoursLeaderboardOps.js';
import { upsertLongestGhostByRoute } from '../src/state/arcade/ArcadeGhostLibrary.js';

const CLIP = Object.freeze({
    frames: [
        { time: 0, players: [{ idx: 0, alive: true, x: 0, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, bot: false }] },
        { time: 0.5, players: [{ idx: 0, alive: true, x: 4, y: 2, z: 0, qx: 0, qy: 0.3, qz: 0, qw: 0.95, bot: false }] },
    ],
    players: [{ idx: 0, color: 0xffffff, isBot: false, modelScale: 1 }],
    sourceDuration: 0.5,
    displayDuration: 0.5,
});

// A ranked Arcade parcours run scales with the build, so its records live under a level key
// (route:level:min-max). Ghosts saved before that rule only know the plain route.
function createRuntime(ghostLibrary) {
    const played = [];
    return {
        played,
        _config: { ghostDuelMode: 'self_longest_ghost' },
        rankContext: { strengthScaled: true, vehicleLevel: 3 },
        _ghostLibrary: ghostLibrary,
        _resolveGhostLibraryBudgetOptions: () => null,
        _enqueueHudEvent: () => null,
        _onGhostPlayback: (clip) => played.push(clip),
    };
}

test('a ranked run plays the longest ghost saved under the plain route before level boards existed', () => {
    const library = upsertLongestGhostByRoute({}, 'parcours_rift', CLIP, 500).ghostLibrary;
    const runtime = createRuntime(library);
    const result = applyParcoursLeaderboardEvent(runtime, { type: 'ghost_start', routeId: 'parcours_rift', source: 'match_round_start' });
    assert.equal(result.started, true, result.reason);
    assert.equal(runtime.played.length, 1);
});

test('a ghost of the run\'s own level board wins over the plain route ghost', () => {
    let library = upsertLongestGhostByRoute({}, 'parcours_rift', CLIP, 500).ghostLibrary;
    const levelKey = applyParcoursLeaderboardEvent(createRuntime({}), { type: 'ghost_start', routeId: 'parcours_rift' }).routeCandidates[0];
    assert.match(levelKey, /^parcours_rift:level:/);
    const levelClip = { ...CLIP, sourceDuration: 0.4, displayDuration: 0.4 };
    library = upsertLongestGhostByRoute(library, levelKey, levelClip, 400).ghostLibrary;
    const runtime = createRuntime(library);
    const result = applyParcoursLeaderboardEvent(runtime, { type: 'ghost_start', routeId: 'parcours_rift' });
    assert.equal(result.started, true);
    assert.equal(result.routeId, levelKey);
    assert.equal(runtime.played[0].sourceDuration, 0.4);
});

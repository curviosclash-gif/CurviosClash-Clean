import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_JOURNEY_SCHEMA, ARCADE_JOURNEY_STAGES, ARCADE_JOURNEY_WORLDS,
    evaluateArcadeJourneyMedal, getArcadeJourneyStars, getArcadeJourneyMaxStars, resolveArcadeJourneyAccess } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { resolvePortalChain } from '../src/shared/contracts/PortalChainContract.js';
import { ARENA_WAVES_BOT_CAPACITY } from '../src/shared/contracts/ArenaWavesContract.js';

const progress = (stages = {}) => ({ schema: ARCADE_JOURNEY_SCHEMA, stages });
const bronze = () => ({ medals: { normal: { medal: 1, runId: 'completed' } } });

test('every journey entry resolves an existing world, map and acyclic predecessor', () => {
    const catalogue = MAP_PRESET_CATALOG;
    assert.equal(new Set(ARCADE_JOURNEY_STAGES.map(stage => stage.id)).size, ARCADE_JOURNEY_STAGES.length);
    for (const stage of ARCADE_JOURNEY_STAGES) {
        assert.ok(ARCADE_JOURNEY_WORLDS.some(world => world.id === stage.worldId));
        assert.ok(catalogue[stage.mapKey], stage.mapKey);
        if (stage.portalChainId) assert.equal(resolvePortalChain(stage.portalChainId).maps[0], stage.mapKey);
        const visited = new Set([stage.id]);
        let next = stage.predecessorId;
        while (next) {
            assert.ok(!visited.has(next), `Cycle through ${next}`);
            visited.add(next);
            const predecessor = ARCADE_JOURNEY_STAGES.find(entry => entry.id === next);
            assert.ok(predecessor);
            next = predecessor.predecessorId;
        }
    }
    assert.equal(ARCADE_JOURNEY_STAGES.find(stage => stage.id === 'five_fronts').botCount, ARENA_WAVES_BOT_CAPACITY);
});

test('a two- or three-player squad can unlock every shared stage without completing solo entries', () => {
    for (const playerCount of [2, 3]) {
        const completed = {};
        let changed = true;
        while (changed) {
            changed = false;
            for (const stage of ARCADE_JOURNEY_STAGES.filter(entry => entry.maxPlayers >= playerCount)) {
                if (!completed[stage.id] && resolveArcadeJourneyAccess(stage.id, progress(completed), { playerCount }).unlocked) {
                    completed[stage.id] = bronze();
                    changed = true;
                }
            }
        }
        for (const stage of ARCADE_JOURNEY_STAGES.filter(entry => entry.maxPlayers >= playerCount)) assert.ok(completed[stage.id], stage.id);
        assert.ok(!completed.weapon_race);
    }
});

test('stars use the best tier per known stage and ignore unknown or invalid medals', () => {
    const record = progress({ first_run: { medals: { normal: { medal: 1 }, hard: { medal: 3 }, nightmare: { medal: 2 } } },
        weapon_race: { medals: { normal: { medal: 99 } } }, unknown_stage: bronze() });
    assert.equal(getArcadeJourneyStars(record), 3);
    assert.equal(getArcadeJourneyStars({ ...record, schema: 'future' }), 0);
});

test('grandfathered access bypasses progression gates but preserves the real player limit', () => {
    assert.equal(resolveArcadeJourneyAccess('demolition', progress()).reason, 'stars');
    assert.equal(resolveArcadeJourneyAccess('demolition', progress(), { legacyAccess: true }).unlocked, true);
    assert.equal(resolveArcadeJourneyAccess('weapon_race', progress(), { legacyAccess: true, playerCount: 2 }).reason, 'player_count');
    assert.equal(resolveArcadeJourneyAccess('first_run', progress(), { playerCount: 4 }).reason, 'player_count');
});

test('medals require a real completed objective or the endless points goal, never an abort', () => {
    assert.equal(evaluateArcadeJourneyMedal('five_portals', { succeeded: true, value: 200000 }), 3);
    assert.equal(evaluateArcadeJourneyMedal('five_portals', { succeeded: false, value: 200000 }), 0);
    assert.equal(evaluateArcadeJourneyMedal('five_portals', { succeeded: true, value: 0 }), 0);
    assert.equal(evaluateArcadeJourneyMedal('first_run', { succeeded: true, value: 100 }), 1);
    assert.equal(evaluateArcadeJourneyMedal('first_run', { succeeded: true, value: 40000 }), 3);
    assert.equal(evaluateArcadeJourneyMedal('first_run', { succeeded: true, value: null }), 0);
    assert.equal(evaluateArcadeJourneyMedal('endless_hunt', { value: 4999 }), 0);
    assert.equal(evaluateArcadeJourneyMedal('endless_hunt', { value: 5000 }), 1);
    assert.equal(evaluateArcadeJourneyMedal('endless_hunt', { aborted: true, value: 40000 }), 0);
});


test('flight school counts only an actual completion and remains optional for the shared path', () => {
    assert.equal(evaluateArcadeJourneyMedal('flight_school', { succeeded: true, value: 1 }), 1);
    assert.equal(evaluateArcadeJourneyMedal('flight_school', { succeeded: false, value: 1 }), 0);
    assert.equal(evaluateArcadeJourneyMedal('flight_school', { succeeded: true, value: 100 }), 0);
    assert.equal(evaluateArcadeJourneyMedal('flight_school', { succeeded: true, value: 1, aborted: true }), 0);
    const completed = progress({ flight_school: bronze() });
    assert.equal(resolveArcadeJourneyAccess('five_portals', completed).unlocked, true);
    assert.equal(resolveArcadeJourneyAccess('flight_school', progress(), { playerCount: 2 }).unlocked, false);
});

test('reachable star maxima agree with the authored medal evaluator and exclude unbound stages', () => {
    assert.equal(getArcadeJourneyMaxStars(''), 0);
    assert.equal(getArcadeJourneyMaxStars('gaps_lesson'), 0);
    for (const stage of ARCADE_JOURNEY_STAGES) {
        const value = stage.metric === 'completion' || stage.metric === 'place' ? 1 : stage.gold;
        assert.equal(getArcadeJourneyMaxStars(stage.id), evaluateArcadeJourneyMedal(stage.id, { succeeded: true, value }), stage.id);
    }
    assert.equal(getArcadeJourneyMaxStars('flight_school'), 1);
});

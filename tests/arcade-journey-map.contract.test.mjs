import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ARCADE_JOURNEY_MAP_HEIGHT,
    ARCADE_JOURNEY_MAP_LINKS,
    ARCADE_JOURNEY_MAP_NODES,
    ARCADE_JOURNEY_MAP_WIDTH,
    ARCADE_JOURNEY_MAP_WORLDS,
    ARCADE_JOURNEY_MAP_PLANNED_LINKS,
} from '../src/shared/contracts/ArcadeJourneyMapContract.js';
import {
    ARCADE_JOURNEY_SCHEMA,
    ARCADE_JOURNEY_STAGES,
    getArcadeJourneyStage,
} from '../src/shared/contracts/ArcadeJourneyContract.js';

const EXPECTED_NODE_IDS = [
    'first_flight', 'first_route', 'endless_hunt',
    'notre_dame', 'five_fronts', 'bridge_convoy', 'worm_hunt',
    'orbital_shipyard', 'sky_ladder',
    'weapon_race', 'five_portals', 'demolition', 'portal_chain_k19',
];

const EXPECTED_LEGACY_STAGE_IDS = [
    'flight_school', 'first_run', 'weapon_race', 'five_portals',
    'sky_ladder', 'five_fronts', 'demolition', 'endless_hunt',
];

test('journey map contains only positioned playable nodes', () => {
    assert.deepEqual(ARCADE_JOURNEY_MAP_WORLDS.map(({ id }) => id), [
        'flight_school', 'tower_city', 'storm_coast', 'exclusion_zone', 'orbit',
    ]);
    assert.deepEqual(ARCADE_JOURNEY_MAP_NODES.map(({ id }) => id), EXPECTED_NODE_IDS);
    assert.equal(new Set(ARCADE_JOURNEY_MAP_WORLDS.map(({ id }) => id)).size, 5);
    assert.equal(new Set(ARCADE_JOURNEY_MAP_NODES.map(({ id }) => id)).size, EXPECTED_NODE_IDS.length);

    const worldIds = new Set(ARCADE_JOURNEY_MAP_WORLDS.map(({ id }) => id));
    for (const world of ARCADE_JOURNEY_MAP_WORLDS) {
        assert.ok(world.label.trim());
        assert.ok(world.copy.trim());
        assert.ok(Number.isFinite(world.x) && Number.isFinite(world.y));
    }
    for (const node of ARCADE_JOURNEY_MAP_NODES) {
        assert.ok(worldIds.has(node.worldId), node.id + ' must belong to a listed world');
        assert.ok(node.label.trim());
        assert.ok(node.goal.trim());
        assert.ok(Number.isFinite(node.x) && node.x >= 0 && node.x <= ARCADE_JOURNEY_MAP_WIDTH);
        assert.ok(Number.isFinite(node.y) && node.y >= 0 && node.y <= ARCADE_JOURNEY_MAP_HEIGHT);
        assert.ok(Number.isInteger(node.maxPlayers) && node.maxPlayers >= 1 && node.maxPlayers <= 3);
    }
});

test('journey map links reference known nodes and form an acyclic graph', () => {
    const nodeIds = new Set(ARCADE_JOURNEY_MAP_NODES.map(({ id }) => id));
    const adjacency = new Map([...nodeIds].map((id) => [id, []]));
    const indegree = new Map([...nodeIds].map((id) => [id, 0]));
    const edgeIds = new Set();

    for (const link of ARCADE_JOURNEY_MAP_LINKS) {
        assert.equal(link.length, 2);
        const [from, to] = link;
        assert.ok(nodeIds.has(from) && nodeIds.has(to), from + ' -> ' + to + ' must reference known nodes');
        assert.notEqual(from, to, 'a node cannot link to itself');
        const edgeId = from + '->' + to;
        assert.ok(!edgeIds.has(edgeId), edgeId + ' must be unique');
        edgeIds.add(edgeId);
        adjacency.get(from).push(to);
        indegree.set(to, indegree.get(to) + 1);
    }
    assert.equal(ARCADE_JOURNEY_MAP_LINKS.length, ARCADE_JOURNEY_STAGES.filter(stage => stage.predecessorId).length);

    const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
    let visited = 0;
    while (ready.length) {
        const from = ready.pop();
        visited += 1;
        for (const to of adjacency.get(from)) {
            indegree.set(to, indegree.get(to) - 1);
            if (indegree.get(to) === 0) ready.push(to);
        }
    }
    assert.equal(visited, ARCADE_JOURNEY_MAP_NODES.length, 'reference route graph must be acyclic');
});

test('only existing playable stage IDs are referenced and legacy IDs remain intact', () => {
    const stageIds = ARCADE_JOURNEY_STAGES.map(({ id }) => id);
    assert.deepEqual(stageIds.filter(id => EXPECTED_LEGACY_STAGE_IDS.includes(id)), EXPECTED_LEGACY_STAGE_IDS);
    assert.deepEqual(stageIds.filter(id => !EXPECTED_LEGACY_STAGE_IDS.includes(id)), ['notre_dame', 'bridge_convoy', 'orbital_shipyard', 'worm_hunt']);
    assert.equal(ARCADE_JOURNEY_SCHEMA, 'arcade-journey.v1');

    const expectedBindings = new Map([
        ['first_flight', 'flight_school'],
        ['first_route', 'first_run'],
        ['notre_dame', 'notre_dame'],
        ['bridge_convoy', 'bridge_convoy'],
        ['orbital_shipyard', 'orbital_shipyard'],
        ['endless_hunt', 'endless_hunt'],
        ['five_fronts', 'five_fronts'],
        ['sky_ladder', 'sky_ladder'],
        ['worm_hunt', 'worm_hunt'],
        ['weapon_race', 'weapon_race'], ['five_portals', 'five_portals'], ['demolition', 'demolition'],
    ]);
    for (const node of ARCADE_JOURNEY_MAP_NODES) {
        assert.equal(node.stageId, expectedBindings.get(node.id) || '', node.id + ' binding must stay explicit');
        if (node.stageId) {
            const stage = getArcadeJourneyStage(node.stageId);
            assert.ok(stage, node.id + ' must point to a current runtime stage');
            assert.equal(node.goal, stage.goal, node.id + ' must show the current playable objective');
            assert.ok(node.maxPlayers <= stage.maxPlayers, node.id + ' cannot exceed its stage player limit');
        } else {
            assert.equal(node.id, 'portal_chain_k19'); assert.ok(node.freeAction);
        }
    }
});

test('effective map arrows are exactly the access-contract predecessors', () => {
    const nodeForStage = id => ARCADE_JOURNEY_MAP_NODES.find(node => node.stageId === id);
    const planned = new Set(ARCADE_JOURNEY_MAP_PLANNED_LINKS.map(edge => edge.join('>')));
    assert.deepEqual(ARCADE_JOURNEY_MAP_LINKS.filter(edge => !planned.has(edge.join('>'))).map(edge => edge.join('>')).sort(),
        ARCADE_JOURNEY_STAGES.filter(stage => stage.predecessorId).map(stage => nodeForStage(stage.predecessorId).id + '>' + nodeForStage(stage.id).id).sort());
    assert.deepEqual(ARCADE_JOURNEY_MAP_PLANNED_LINKS, []);
    assert.equal(ARCADE_JOURNEY_MAP_NODES.filter(node => node.portalChainId).length, 3);
});

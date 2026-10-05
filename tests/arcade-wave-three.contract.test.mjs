import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { ARCADE_SCENARIOS } from '../src/entities/directors/ArcadeScenarioCatalog.js';
import { buildArcadeSectorPlan, resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { BLOOM_CORE_FINAL_OPEN_SECONDS } from '../src/core/config/maps/presets/bloom_core.js';
import { createArcadeObjectiveState, updateArcadeObjectiveState } from '../src/state/arcade/ArcadeObjectiveState.js';
import { updateArcadeObjectiveRuntimeState } from '../src/core/arcade/ArcadeObjectiveRuntimeOps.js';
import { requestObjectiveRoundEnd, syncArcadeObjectiveIntoEntities } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';
import { ArenaExpansionController } from '../src/entities/arena/ArenaExpansionController.js';
import { normalizeMapUnit } from '../src/shared/contracts/MapUnitContract.js';
import { placeMapGlbModel, worldMeshBounds } from './helpers/placed-glb-model.mjs';
import { resolveHuntObjectiveText } from '../src/ui/HuntMatchStatusHelpers.js';

const scenario = (id) => ARCADE_SCENARIOS.find((entry) => entry.id === id);
const SEEDS = { bridge_convoy: 16, vault_breaker: 9, bloom_escape: 5 };

function createHarness(id, { mode = 'ARCADE', pickupMode = 'HUNT' } = {}) {
    const entry = scenario(id);
    const human = { index: 0, alive: true, hp: 100, isBot: false };
    const arena = {
        renderer: { addToScene() {}, removeFromScene() {} },
        currentMapDefinition: MAP_PRESET_CATALOG[entry.mapKey], currentMapKey: entry.mapKey,
        bounds: { minX: -300, maxX: 300, minY: 0, maxY: 240, minZ: -300, maxZ: 300 },
        glbAnimationElapsedSeconds: 0, portals: [], exitPortals: [], specialGates: [],
        checkpointRings: [], portalsEnabled: true, portalLayoutWarnings: [],
        checkCollision: () => false, checkCollisionFast: () => false,
    };
    const events = [];
    const round = new RoundOutcomeSystem({ getPlayers: () => [human] });
    const manager = {
        arena, players: [], humanPlayers: [human], _roundOutcomeSystem: round,
        gameModeStrategy: { modeType: mode, getPickupModeType: () => pickupMode },
        runtimeConfig: { session: { mapKey: entry.mapKey }, arcade: {
            scenarioId: id, scenarioMapUnits: entry.mapUnits, scenarioMapUnitsMode: entry.mapUnitsMode,
        } },
        requestRoundEnd: (request) => round.requestRoundEnd(request),
    };
    const runtime = {
        _state: { objectiveState: createArcadeObjectiveState(entry.objective) },
        _requestRoundEnd: (request) => requestObjectiveRoundEnd(manager, request),
    };
    manager.onArcadeGameplayEvent = (event) => {
        events.push(event);
        updateArcadeObjectiveRuntimeState(runtime, event);
        syncArcadeObjectiveIntoEntities(manager, runtime._state.objectiveState);
    };
    syncArcadeObjectiveIntoEntities(manager, runtime._state.objectiveState);
    const units = new MapUnitSystem(manager);
    const structures = new MapDestructibleSystem(manager);
    manager._mapUnitSystem = units;
    manager._mapDestructibleSystem = structures;
    const rooms = new SecretRoomSystem(manager);
    manager._secretRoomSystem = rooms;
    return { entry, human, arena, events, manager, runtime, round, units, structures, rooms };
}

test('wave three scenarios reach sector three through their deterministic normal run plans', () => {
    for (const [id, seed] of Object.entries(SEEDS)) {
        const plan = buildArcadeSectorPlan({ seed, sectorCount: 5 });
        const third = plan.sequence[2];
        const expected = scenario(id);
        assert.equal(third.scenarioId, id);
        assert.equal(third.mapKey, expected.mapKey);
        assert.equal(third.objectiveId, expected.objective.id);
        const profile = resolveArcadeSectorRuntimeProfile(third, { mapKey: third.mapKey });
        assert.equal(profile.combatProfile, id === 'bloom_escape' ? '' : 'hunt');
        assert.equal(profile.botCount, id === 'bloom_escape' ? 4 : 0);
    }
});

test('new Hunt-weapon scenarios show their mission rule while normal Hunt keeps elimination', () => {
    const details = { killLimit: 10, timeText: '', matchPointText: '' };
    for (const [id, label] of [['bridge_convoy', 'Konvoi'], ['vault_breaker', 'Tresorknacker']]) {
        const config = { session: { activeGameMode: 'ARCADE' }, arcade: { scenarioId: id } };
        assert.match(resolveHuntObjectiveText({}, config, details), new RegExp(label));
        config.session.activeGameMode = 'HUNT';
        assert.equal(resolveHuntObjectiveText({}, config, details), 'Elimination · letzter Überlebender gewinnt');
    }
});

test('convoy hulls and their complete paths fit the actual authored bridge deck', async () => {
    const h = createHarness('bridge_convoy');
    const bridge = await placeMapGlbModel(h.arena.currentMapDefinition, 'storm-bridge-intact');
    const deck = worldMeshBounds(bridge.scene, (mesh) => mesh.name === 'bridge_span_deck');
    h.manager.renderer = h.arena.renderer;
    try {
        h.units.startRound();
        for (const elapsed of [0, 600]) {
            h.units.update(elapsed);
            for (const unit of h.units.units) {
                unit.root.updateMatrixWorld(true);
                const hull = worldMeshBounds(unit.root, (mesh) => ['tank_hull', 'tank_track_left', 'tank_track_right'].includes(mesh.userData.mapUnitPart));
                assert.ok(hull.min.x >= deck.min.x && hull.max.x <= deck.max.x, 'hull length stays on the span');
                assert.ok(hull.min.z >= deck.min.z && hull.max.z <= deck.max.z, 'hull width fits the deck');
                assert.ok(Math.abs(hull.min.y - deck.max.y) < 0.01, 'tracks stand on the deck');
                for (const point of unit.path) assert.ok(point[0] >= deck.min.x && point[0] <= deck.max.x && Math.abs(point[1] - deck.max.y) < 0.01);
                assert.ok(Math.abs(unit.position.y - unit.groundPosition.y - 2.1 * unit.scale * unit.definition.modelScale) < 1e-9);
                assert.equal(unit.mounts[0].authoredScale, unit.scale * unit.definition.modelScale);
            }
        }
    } finally { h.units.dispose(); }
});

test('daily legacy pools and fixed historical map sequences remain unchanged', () => {
    for (let seed = 1; seed <= 48; seed += 1) {
        const plan = buildArcadeSectorPlan({ seed, sectorCount: 12, dailyChallenge: true });
        assert.equal(plan.sequence.some((entry) => Object.hasOwn(SEEDS, entry.scenarioId)), false);
        assert.equal(plan.sequence.some((entry) => entry.mapKey === 'bloom_core'), false);
    }
    for (const [seed, ids, maps] of [
        [4, [null, null, 'worm_hunt', null, 'hydra_finale'], ['crossfire', 'standard', 'standard', 'chrono_spillway', 'hydra_temple']],
        [6, [null, null, 'storm_flood', null, null], ['crossfire', 'foam_forest', 'storm_dam_siege', 'parcours_rift_sprint', 'neon_abyss']],
    ]) {
        const actual = buildArcadeSectorPlan({ seed, sectorCount: 5, dailyChallenge: true }).sequence;
        assert.deepEqual(actual.map((entry) => entry.scenarioId || null), ids);
        assert.deepEqual(actual.map((entry) => entry.mapKey), maps);
    }
});

test('three nonrespawning convoy tanks hold the round until their actual destruction', () => {
    const h = createHarness('bridge_convoy');
    try {
        assert.equal(h.units.startRound(), 3);
        assert.equal(h.round.resolve().shouldEnd, false);
        for (const [index, unit] of h.units.units.entries()) {
            assert.equal(unit.definition.stopAtEnd, true);
            assert.equal(unit.definition.respawnSeconds, 0);
            unit.takeDamage(unit.hp + 1, { sourcePlayer: h.human });
            assert.equal(h.runtime._state.objectiveState.unitsDestroyed, index + 1);
            assert.equal(h.round.resolve().shouldEnd, index === 2);
        }
        assert.equal(h.round.resolve().winner, h.human);
        assert.equal(h.round.resolve().reason, 'ARCADE_OBJECTIVE');
        h.units.update(600);
        assert.equal(h.units.units.some((unit) => unit.alive), false);
        assert.equal(h.events.filter((event) => event.type === 'unit_destroyed').length, 3);
        assert.equal(h.units.startRound(), 3);
        assert.equal(h.units.units.every((unit) => unit.alive && !unit.goalReached && unit.hp === unit.maxHp), true);
    } finally { h.units.dispose(); }
});

test('environmental convoy destruction counts once while uncredited kills do not receive player rewards', () => {
    const h = createHarness('bridge_convoy');
    const credits = [];
    h.manager._huntScoring = { registerUnitDestroyed: (...args) => credits.push(args) };
    try {
        h.units.startRound();
        for (const unit of h.units.units) {
            unit.takeDamage(unit.hp + 1, { cause: 'TANK_EXPLOSION' });
            unit.takeDamage(100000, { cause: 'TANK_EXPLOSION' });
        }
        assert.equal(h.runtime._state.objectiveState.unitsDestroyed, 3);
        assert.equal(h.runtime._state.objectiveState.completed, true);
        assert.equal(h.events.filter((event) => event.type === 'unit_destroyed').length, 3);
        assert.deepEqual(credits, []);
    } finally { h.units.dispose(); }
});

test('first convoy arrival fails once without awarding the living pilot a win', () => {
    const h = createHarness('bridge_convoy');
    try {
        h.units.startRound();
        h.units.units[0].speed = 100000;
        h.units.update(1);
        const arrived = h.units.units[0];
        assert.equal(arrived.goalReached, true);
        assert.deepEqual(arrived.groundPosition.toArray(), arrived.path.at(-1));
        const position = arrived.groundPosition.clone();
        h.units.update(2);
        assert.ok(arrived.groundPosition.equals(position));
        assert.equal(h.events.filter((event) => event.type === 'unit_goal_reached').length, 1);
        assert.equal(h.runtime._state.objectiveState.failed, true);
        assert.equal(h.round.resolve().winner, null);
        assert.equal(h.round.resolve().reason, 'ARCADE_OBJECTIVE_FAILED');

        const strategy = new ArcadeModeStrategy();
        const run = new ArcadeRunRuntime({ strategy, now: () => 100000 });
        run.configure({ arcade: { enabled: true, seed: SEEDS.bridge_convoy, sectorCount: 5 } });
        const plan = buildArcadeSectorPlan({ seed: SEEDS.bridge_convoy, sectorCount: 5 });
        plan.sequence[0] = { ...plan.sequence[0], objectiveId: 'intercept', objective: h.entry.objective };
        run.startRun({ strategy, encounterPlan: plan });
        run.applyGameplayEvent({ type: 'unit_goal_reached', unitKind: 'tank' });
        const result = run.deriveRoundEndPlan({ players: [h.human], inputs: { reason: h.round.resolve().reason }, baseController: {} });
        assert.equal(result.outcome.state, 'MATCH_END');
        assert.equal(run.getPhase(), 'finished');
        assert.equal(run.getStateSnapshot().completedSectors, 0);
        assert.equal(run.getIntermissionState(), null);
        assert.match(result.outcome.messageText, /Konvoi durchgebrochen/);
        run.startRun({ strategy, encounterPlan: plan });
        assert.equal(run.getStateSnapshot().objectiveState.failed, false);
        assert.equal(run.getStateSnapshot().objectiveState.unitsDestroyed, 0);
        assert.equal(run.getStateSnapshot().completedSectors, 0);
    } finally { h.units.dispose(); }
});

test('convoy replica follows arrival snapshots without emitting an objective or taking host damage', () => {
    const host = createHarness('bridge_convoy');
    const replica = createHarness('bridge_convoy');
    try {
        host.units.startRound(); replica.units.startRound();
        replica.units.setNetworkReplica(true);
        replica.units.units[0].speed = 100000;
        replica.units.update(1);
        assert.equal(replica.events.length, 0);
        replica.units.units[1].takeDamage(10000, { sourcePlayer: replica.human });
        assert.equal(replica.units.units[1].alive, true);
        host.units.units[0].speed = 100000;
        host.units.update(1);
        replica.units.applyNetworkState(host.units.serializeNetworkState());
        assert.equal(replica.units.units[0].goalReached, true);
        assert.deepEqual(replica.units.units[0].position.toArray(), host.units.units[0].position.toArray());
        replica.units.update(1);
        assert.equal(replica.events.length, 0);
        assert.equal(replica.round.resolve().shouldEnd, false);
    } finally { host.units.dispose(); replica.units.dispose(); }
});

test('stopAtEnd preserves ordinary nonlooping patrol reversal and rejects a looping endpoint', () => {
    const patrol = normalizeMapUnit({ id: 'patrol', kind: 'tank', path: [[0, 8, 0], [0, 8, 10]], speed: 2, loop: false,
        drive: { steering: false, obstacleStop: false, chase: false } });
    assert.equal(patrol.stopAtEnd, false);
    assert.equal(patrol.modelScale, undefined, 'ordinary tanks retain their existing shape');
    assert.equal(normalizeMapUnit({ ...patrol, modelScale: 0.45 }).modelScale, 0.45);
    assert.equal(normalizeMapUnit({ ...patrol, loop: true, stopAtEnd: true }).stopAtEnd, false);
    const h = createHarness('bridge_convoy');
    h.manager.runtimeConfig.arcade.scenarioMapUnits = [patrol];
    try {
        h.units.startRound();
        h.units.update(6);
        assert.equal(h.units.units[0].goalReached, false);
        assert.equal(h.units.units[0].fromIndex, 1);
        assert.equal(h.units.units[0].toIndex, 0);
        assert.equal(h.events.length, 0);
    } finally { h.units.dispose(); }
});

test('vault destruction is restricted to its Arcade scenario while ordinary Hunt retains the map', () => {
    const h = createHarness('vault_breaker');
    assert.ok(h.structures.startRound() > 0);
    const other = h.structures.definition.segments.find((entry) => entry.kind !== 'leg_lower');
    assert.ok(other);
    h.structures.applySegmentHit(other.id, 100000, { sourcePlayer: h.human });
    assert.equal(h.structures.getState().sealed, false, 'an upper segment cannot lock the run before the required leg breaks');
    assert.equal(h.structures.getState().events.length, 0);
    h.manager.runtimeConfig.arcade.scenarioId = '';
    assert.equal(h.structures.startRound(), 0);
    h.manager.runtimeConfig.arcade.scenarioId = 'vault_breaker';
    h.manager.runtimeConfig.session.mapKey = 'standard';
    assert.equal(h.structures.startRound(), 0);
    h.manager.runtimeConfig.session.mapKey = 'eiffel_tower_siege';
    h.manager.gameModeStrategy.modeType = 'HUNT';
    assert.ok(h.structures.startRound() > 0);
    h.structures.applySegmentHit(other.id, 100000, { sourcePlayer: h.human });
    assert.equal(h.structures.getState().segments.find((entry) => entry.id === other.id).destroyed, true,
        'normal Hunt still permits the original upper-segment collapse');
    assert.equal(h.structures.getState().events.length, 1);
    new PortalLayoutBuilder(h.arena).build(h.arena.currentMapDefinition, 3);
    h.rooms.startRound();
    h.arena.glbAnimationElapsedSeconds = 4;
    h.rooms.update();
    assert.equal(h.rooms.isRoomOpen('vault'), true,
        'Hunt retains any-break unlocking even when an old Arcade scenario id is still present');
    try {
        h.units.startRound();
        const boss = h.units.units.find((unit) => unit.kind === 'boss');
        boss.takeDamage(boss.hp + 1, { sourcePlayer: h.human });
        assert.equal(boss.alive, false, 'the new Arcade-only boss guard does not change Hunt');
    } finally { h.units.dispose(); }
    h.manager.gameModeStrategy.modeType = 'CLASSIC';
    assert.equal(h.structures.startRound(), 0);
});

test('vault objective requires a lower leg before the boss and resets its breach on a new state', () => {
    const initial = createArcadeObjectiveState(scenario('vault_breaker').objective);
    const prematureBoss = updateArcadeObjectiveState(initial, { type: 'unit_destroyed', unitKind: 'boss' });
    assert.equal(prematureBoss.completed, false);
    const wrongStructure = updateArcadeObjectiveState(prematureBoss, { type: 'structure_destroyed', segmentKind: 'spire' });
    assert.equal(wrongStructure.breachComplete, false);
    const breach = updateArcadeObjectiveState(wrongStructure, { type: 'structure_destroyed', segmentKind: 'leg_lower' });
    assert.equal(breach.breachComplete, true);
    assert.equal(breach.progressFraction, 0.5);
    assert.equal(updateArcadeObjectiveState(breach, { type: 'unit_destroyed', unitKind: 'tank' }).completed, false);
    assert.equal(updateArcadeObjectiveState(breach, { type: 'unit_destroyed', unitKind: 'boss' }).completed, true);
    assert.equal(createArcadeObjectiveState(scenario('vault_breaker').objective).breachComplete, false);
});

test('vault portal waits for a real lower-leg break plus delay, opens on host and replica, and resets', () => {
    const h = createHarness('vault_breaker');
    h.structures.startRound();
    const builder = new PortalLayoutBuilder(h.arena);
    builder.build(h.arena.currentMapDefinition, 3);
    const portals = new PortalRuntimeSystem(h.arena);
    h.rooms.startRound();
    h.units.startRound();
    const boss = h.units.units.find((unit) => unit.kind === 'boss');
    assert.ok(boss);
    boss.takeDamage(boss.hp + 1, { sourcePlayer: h.human });
    assert.equal(boss.alive, true, 'the closed vault protects its boss from premature destruction');
    assert.equal(boss.hp, boss.maxHp);
    const portal = h.arena.portals.find((entry) => entry.roomId === 'vault');
    assert.ok(portal);
    assert.equal(portal.active, false);
    assert.equal(portals.checkPortal(portal.posA.clone(), 0.8, 0), null);
    h.arena.glbAnimationElapsedSeconds = 10;
    const leg = h.structures.definition.segments.find((entry) => entry.kind === 'leg_lower');
    h.structures.applySegmentHit(leg.id, 100000, { sourcePlayer: h.human });
    assert.equal(h.runtime._state.objectiveState.breachComplete, true);
    const delay = h.rooms.getRooms().find((entry) => entry.room.id === 'vault').room.unlock.delaySeconds;
    h.arena.glbAnimationElapsedSeconds = 10 + delay - 0.01;
    h.rooms.update();
    assert.equal(portal.active, false);
    h.arena.glbAnimationElapsedSeconds = 10 + delay;
    h.rooms.update();
    assert.equal(portal.active, true);
    assert.equal(portals.checkPortal(portal.posA.clone(), 0.8, 0)?.ok, true);

    const replica = createHarness('vault_breaker');
    replica.structures.startRound();
    replica.structures.setNetworkReplica(true);
    new PortalLayoutBuilder(replica.arena).build(replica.arena.currentMapDefinition, 3);
    replica.rooms.setNetworkReplica(true);
    replica.rooms.startRound();
    replica.structures.applyNetworkState(h.structures.serializeNetworkState());
    replica.arena.glbAnimationElapsedSeconds = 10 + delay;
    replica.rooms.update();
    assert.equal(replica.rooms.isRoomOpen('vault'), true);
    assert.equal(replica.events.length, 0, 'snapshot feedback does not replay a breach objective');

    try {
        boss.takeDamage(boss.hp + 1, { sourcePlayer: h.human });
        assert.equal(h.runtime._state.objectiveState.completed, true);
        assert.equal(h.round.resolve().reason, 'ARCADE_OBJECTIVE');
    } finally { h.units.dispose(); }
    h.structures.startRound();
    h.arena.glbAnimationElapsedSeconds = 0;
    h.rooms.startRound();
    assert.equal(h.rooms.isRoomOpen('vault'), false);
    assert.equal(portal.active, false);
});

test('bloom collision bounds and survival finish together at the final opening, then reset', () => {
    const h = createHarness('bloom_escape', { pickupMode: 'ARCADE' });
    const map = h.arena.currentMapDefinition;
    h.arena.bounds = { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -100, maxZ: 100 };
    h.arena.openFaces = [];
    const controller = new ArenaExpansionController(h.arena);
    assert.equal(controller.build(map, 1), true);
    assert.equal(h.arena.bounds.maxX, 34);
    for (const [seconds, halfWidth] of [[35, 58], [70, 82], [BLOOM_CORE_FINAL_OPEN_SECONDS - 0.01, 82]]) {
        controller.update(seconds);
        updateArcadeObjectiveRuntimeState(h.runtime, { type: 'tick', elapsed: seconds });
        syncArcadeObjectiveIntoEntities(h.manager, h.runtime._state.objectiveState);
        assert.equal(h.arena.bounds.maxX, halfWidth);
        assert.equal(h.round.resolve().shouldEnd, false);
    }
    controller.update(BLOOM_CORE_FINAL_OPEN_SECONDS);
    updateArcadeObjectiveRuntimeState(h.runtime, { type: 'tick', elapsed: BLOOM_CORE_FINAL_OPEN_SECONDS });
    assert.equal(controller.state.phase, 'COMPLETE');
    assert.equal(h.arena.bounds.maxX, 100);
    assert.equal(h.runtime._state.objectiveState.completed, true);
    assert.equal(h.round.resolve().winner, h.human);
    controller.update(0);
    assert.equal(controller.state.stageIndex, 0);
    assert.equal(h.arena.bounds.maxX, 34);
    controller.clear();
});

test('human elimination still ends bloom before the final opening', () => {
    const h = createHarness('bloom_escape', { pickupMode: 'ARCADE' });
    h.human.alive = false;
    assert.equal(h.round.resolve().shouldEnd, true);
    assert.equal(h.round.resolve().reason, 'ELIMINATION');
    assert.equal(h.runtime._state.objectiveState.completed, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FLAG_OBJECTIVE_DEFAULTS,
    createFlagObjectiveState,
    damageFlagObjective,
    FLAG_OBJECTIVE_REASONS,
    resolveFlagObjectiveOutcome,
    tickFlagObjectiveProtection,
} from '../src/shared/contracts/FlagObjectiveContract.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';
import { resolveAuthoredFlagObjectives } from '../src/shared/contracts/FlagObjectivePlacementContract.js';
import { FlagObjectiveSystem } from '../src/entities/systems/FlagObjectiveSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import {
    FLAG_BOT_ROLES,
    resolveFlagBotRole,
    resolveFlagObjectiveTarget,
} from '../src/hunt/HuntBotFlagObjectiveOps.js';
import {
    addObjectiveGuard,
    setTurretTeam,
} from '../src/entities/systems/static-turret/StaticTurretObjectiveOps.js';
import * as THREE from 'three';

test('flag defaults keep the approved six flags, health, guards, protection and round time', () => {
    assert.deepEqual(FLAG_OBJECTIVE_DEFAULTS, {
        flagsPerTeam: 3,
        maxHp: 300,
        protectionSeconds: 10,
        guardsPerFlag: 2,
        roundSeconds: 480,
    });
});

test('enemy damage captures a flag at zero and restores full protected health', () => {
    const flag = createFlagObjectiveState({ id: 'alpha-1', teamId: TEAM_IDS.ALPHA });
    const partial = damageFlagObjective(flag, 120, TEAM_IDS.BRAVO);
    assert.equal(partial.captured, false);
    assert.equal(flag.hp, 180);

    const captured = damageFlagObjective(flag, 500, TEAM_IDS.BRAVO);
    assert.equal(captured.captured, true);
    assert.equal(flag.teamId, TEAM_IDS.BRAVO);
    assert.equal(flag.hp, 300);
    assert.equal(flag.protectionRemaining, 10);
    assert.equal(damageFlagObjective(flag, 50, TEAM_IDS.ALPHA).applied, 0);

    tickFlagObjectiveProtection(flag, 10);
    assert.equal(damageFlagObjective(flag, 50, TEAM_IDS.ALPHA).applied, 50);
});

test('own team cannot damage its flag and the team with more flags wins at time', () => {
    const flags = [
        createFlagObjectiveState({ id: 'a1', teamId: TEAM_IDS.ALPHA }),
        createFlagObjectiveState({ id: 'a2', teamId: TEAM_IDS.ALPHA }),
        createFlagObjectiveState({ id: 'b1', teamId: TEAM_IDS.BRAVO }),
    ];
    assert.equal(damageFlagObjective(flags[0], 100, TEAM_IDS.ALPHA).applied, 0);
    assert.deepEqual(resolveFlagObjectiveOutcome(flags, 480), {
        shouldEnd: true,
        winnerTeamId: TEAM_IDS.ALPHA,
        flagCounts: { ALPHA: 2, BRAVO: 1 },
        overtime: false,
        reason: FLAG_OBJECTIVE_REASONS.TIME_LIMIT,
    });
});

test('full control wins immediately and an even time limit enters golden flag overtime', () => {
    const dominated = Array.from({ length: 6 }, (_, index) =>
        createFlagObjectiveState({ id: `flag-${index}`, teamId: TEAM_IDS.BRAVO }));
    assert.deepEqual(resolveFlagObjectiveOutcome(dominated, 30), {
        shouldEnd: true,
        winnerTeamId: TEAM_IDS.BRAVO,
        flagCounts: { ALPHA: 0, BRAVO: 6 },
        overtime: false,
        reason: FLAG_OBJECTIVE_REASONS.DOMINATION,
    });

    const tied = dominated.map((flag, index) => ({
        ...flag,
        teamId: index < 3 ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO,
    }));
    assert.deepEqual(resolveFlagObjectiveOutcome(tied, 480), {
        shouldEnd: false,
        winnerTeamId: null,
        flagCounts: { ALPHA: 3, BRAVO: 3 },
        overtime: true,
        reason: FLAG_OBJECTIVE_REASONS.OVERTIME,
    });
    tied[0].teamId = TEAM_IDS.BRAVO;
    assert.equal(resolveFlagObjectiveOutcome(tied, 481).winnerTeamId, TEAM_IDS.BRAVO);
});

test('runtime creates three fixed flags and two mutable guards per team flag', () => {
    const guards = [];
    const captures = [];
    const sceneRoots = [];
    const owner = {
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        arena: { bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -90, maxZ: 90 } },
        renderer: {
            addToScene(root) { sceneRoots.push(root); },
            removeFromScene(root) { sceneRoots.splice(sceneRoots.indexOf(root), 1); },
        },
        players: [
            { index: 0, teamId: TEAM_IDS.ALPHA },
            { index: 7, teamId: TEAM_IDS.BRAVO, entitySlotActive: false },
            { index: 1, teamId: TEAM_IDS.BRAVO, entitySlotActive: true },
        ],
        _simulationClockMs: 480000,
        _staticTurretSystem: {
            addObjectiveGuard(definition) {
                const guard = { ...definition, source: {} };
                guards.push(guard);
                return guard;
            },
            setTurretTeam(guard, teamId) { guard.teamId = teamId; guard.source.teamId = teamId; },
        },
        _huntScoring: { registerFlagCapture(playerIndex) { captures.push(playerIndex); } },
    };
    const system = new FlagObjectiveSystem(owner);
    assert.equal(system.startRound(), 6);
    assert.equal(guards.length, 12);
    assert.equal(system.flags[0].root.userData.banner.material.color.getHex(THREE.SRGBColorSpace), 0x00aaff);
    assert.equal(system.flags[3].root.userData.banner.material.color.getHex(THREE.SRGBColorSpace), 0xff8800);
    const flag = system.flags[0];
    flag.takeDamage(300, { sourcePlayer: owner.players[2] });
    assert.equal(flag.teamId, TEAM_IDS.BRAVO);
    assert.ok(flag.guards.every((guard) => guard.teamId === TEAM_IDS.BRAVO));
    assert.equal(flag.root.userData.banner.material.color.getHex(THREE.SRGBColorSpace), 0xff8800);
    assert.deepEqual(captures, [1], 'the authoritative captor receives the comparison counter');
    assert.equal(system.getRoundOutcome().winnerTeamId, TEAM_IDS.BRAVO);
    assert.equal(system.getRoundOutcome().winner.index, 1, 'departed slots cannot represent a winning team');
    system.dispose();
    assert.equal(sceneRoots.length, 0);
});

test('runtime reports the deciding post-limit capture as Golden Flag', () => {
    const owner = {
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        arena: { bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -90, maxZ: 90 } },
        renderer: null,
        players: [{ index: 0, teamId: TEAM_IDS.ALPHA }, { index: 1, teamId: TEAM_IDS.BRAVO }],
        _simulationClockMs: 480000,
    };
    const system = new FlagObjectiveSystem(owner);
    system.startRound();
    assert.equal(system.getRoundOutcome().reason, FLAG_OBJECTIVE_REASONS.OVERTIME);
    system.flags[0].takeDamage(999, { sourcePlayer: owner.players[1] });
    const outcome = system.getRoundOutcome();
    assert.equal(outcome.shouldEnd, true);
    assert.equal(outcome.reason, FLAG_OBJECTIVE_REASONS.OVERTIME);
    system.dispose();
});

test('authored flag anchors require a complete unique 3v3 layout and scale with the map', () => {
    const flagObjectives = Array.from({ length: 6 }, (_, index) => ({
        id: `objective-${index + 1}`,
        teamId: index < 3 ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO,
        position: [index + 1, 2, 3],
    }));
    const placements = resolveAuthoredFlagObjectives({ flagObjectives }, { spatialScale: 2 });
    assert.equal(placements.length, 6);
    assert.deepEqual(placements[0].position, [2, 4, 6]);
    assert.equal(resolveAuthoredFlagObjectives({ flagObjectives: flagObjectives.slice(0, 5) }).length, 0);
    flagObjectives[5] = { ...flagObjectives[5], id: flagObjectives[0].id };
    assert.equal(resolveAuthoredFlagObjectives({ flagObjectives }).length, 0);
});

test('runtime probes deterministic open positions for blocked authored anchors', () => {
    const flagObjectives = Array.from({ length: 6 }, (_, index) => ({
        id: `anchor-${index + 1}`,
        teamId: index < 3 ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO,
        position: [index * 20, 5, 0],
    }));
    const owner = {
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        entityRuntimeConfig: { ARENA: { MAP_SCALE: 1 } },
        arena: {
            bounds: { minX: -100, maxX: 100, minY: 0, maxY: 40, minZ: -100, maxZ: 100 },
            currentMapDefinition: { flagObjectives },
            checkCollision(position) { return position.z === 0; },
        },
        renderer: null,
    };
    const system = new FlagObjectiveSystem(owner);
    assert.equal(system.startRound(), 6);
    assert.deepEqual(system.flags.map((flag) => flag.position.z), [8, 8, 8, 8, 8, 8]);
    system.dispose();
});

test('flag snapshots validate values, reject stale revisions and play captures once', () => {
    const makeOwner = () => {
        const audioEvents = [];
        const feedEvents = [];
        return {
            audioEvents,
            feedEvents,
            runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
            arena: { bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -90, maxZ: 90 } },
            renderer: null,
            players: [{ index: 0, teamId: TEAM_IDS.ALPHA }, { index: 1, teamId: TEAM_IDS.BRAVO }],
            audio: { play(type) { audioEvents.push(type); } },
            _eventBus: { emitHuntFeed(message) { feedEvents.push(message); } },
            particles: { spawnExplosion() {}, spawnHit() {} },
        };
    };
    const hostOwner = makeOwner();
    const host = new FlagObjectiveSystem(hostOwner);
    host.startRound();
    host.flags[0].takeDamage(999, { sourcePlayer: hostOwner.players[1] });
    const snapshot = host.serializeNetworkState();
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.captureEvent.teamId, TEAM_IDS.BRAVO);

    const replicaOwner = makeOwner();
    const replica = new FlagObjectiveSystem(replicaOwner);
    replica.startRound();
    replica.applyNetworkState(snapshot);
    replica.applyNetworkState(snapshot);
    assert.equal(replica.flags[0].teamId, TEAM_IDS.BRAVO);
    assert.deepEqual(replicaOwner.audioEvents, ['FLAG_CAPTURE']);
    assert.deepEqual(replicaOwner.feedEvents, ['Team Orange erobert alpha_1']);
    replica.applyNetworkState({ revision: 0, entries: [{ ...snapshot.entries[0], teamId: TEAM_IDS.ALPHA }] });
    assert.equal(replica.flags[0].teamId, TEAM_IDS.BRAVO);
    host.dispose();
    replica.dispose();
});

test('flag projection exposes per-objective health, captures and Golden Flag overtime', () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
        id: `flag-${index + 1}`,
        teamId: index < 3 ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO,
        hp: index === 0 ? 120 : 300,
        maxHp: 300,
        protectionRemaining: index === 3 ? 6 : 0,
    }));
    const entityManager = {
        players: [],
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        entityRuntimeConfig: { HUNT: { WIN_CONDITION: 'kills_time' } },
        gameModeStrategy: { hasCombatHud: () => true, isRespawnEnabled: () => true, getPickupModeType: () => 'HUNT' },
        _roundOutcomeSystem: { getDeathmatchState: () => ({ elapsedSeconds: 480 }) },
        _authoritativeHuntState: {
            elapsedSeconds: 480,
            flags: {
                revision: 4,
                entries,
                captureEvent: { id: 2, flagId: 'flag-4', teamId: TEAM_IDS.BRAVO, playerIndex: 3 },
            },
        },
    };
    const projection = buildMatchRuntimeProjection({
        game: { entityManager, state: 'PLAYING' },
        runtimeState: { activeGameMode: 'HUNT' },
    });
    assert.equal(projection.hunt.flags.length, 6);
    assert.equal(projection.hunt.flags[0].hp, 120);
    assert.equal(projection.hunt.flagCaptureEvent.id, 2);
    assert.equal(projection.hunt.overtime, true);
    assert.equal(projection.hunt.timeRemainingSeconds, 0);
});

test('flag guards follow their owning team from blue to orange', () => {
    const accent = { material: { color: new THREE.Color() } };
    const healthFill = { material: { color: new THREE.Color() } };
    let definition = null;
    const system = {
        turrets: [],
        _createTurret(value) {
            definition = value;
            return { source: {}, root: { userData: { accent, healthFill, accentColor: 0 } } };
        },
    };
    const guard = addObjectiveGuard(system, { id: 'guard', teamId: TEAM_IDS.ALPHA, position: [0, 0, 0] });
    assert.equal(definition.ownerColor, 0x00aaff);
    setTurretTeam(guard, TEAM_IDS.BRAVO);
    assert.equal(accent.material.color.getHex(THREE.SRGBColorSpace), 0xff8800);
    assert.equal(healthFill.material.color.getHex(THREE.SRGBColorSpace), 0xff8800);
    assert.equal(guard.root.userData.accentColor, 0xff8800);
});

test('destroyed flag guards return for the new owner after capture protection', () => {
    const turrets = [];
    const owner = {
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        arena: { bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -90, maxZ: 90 } },
        renderer: null,
        players: [{ index: 1, teamId: TEAM_IDS.BRAVO }],
        _staticTurretSystem: {
            turrets,
            addObjectiveGuard(definition) {
                const guard = { ...definition, hp: 45, source: {} };
                turrets.push(guard);
                return guard;
            },
            setTurretTeam(guard, teamId) { guard.teamId = teamId; },
        },
    };
    const system = new FlagObjectiveSystem(owner);
    system.startRound();
    const flag = system.flags[0];
    const destroyed = flag.guards[0];
    destroyed.hp = 0;
    turrets.splice(turrets.indexOf(destroyed), 1);
    flag.takeDamage(999, { sourcePlayer: owner.players[0] });
    system.update(10);
    assert.equal(flag.guards.length, 2);
    assert.notEqual(flag.guards[0], destroyed);
    assert.equal(flag.guards[0].teamId, TEAM_IDS.BRAVO);
    system.dispose();
});

test('objective guards ignore every allied damage source', () => {
    const system = new StaticTurretSystem({ gameModeStrategy: { modeType: 'HUNT' }, renderer: null });
    const guard = system.addObjectiveGuard({ id: 'guard', teamId: TEAM_IDS.ALPHA, position: [0, 0, 0] });
    const result = system.damageTurret(guard, 25, { sourcePlayer: { index: 0, teamId: TEAM_IDS.ALPHA } });
    assert.equal(result.hpApplied, 0);
    assert.equal(guard.hp, guard.maxHp);
    assert.equal(system.damageTurret(guard, 25, { sourcePlayer: { index: 1, teamId: TEAM_IDS.BRAVO } }).hpApplied, 25);
    system.dispose();
});

test('flag bots split into stable defender, attacker and flex assignments', () => {
    const flags = [
        { id: 'a1', teamId: TEAM_IDS.ALPHA, hp: 300, maxHp: 300, position: new THREE.Vector3(5, 0, 0) },
        { id: 'a2', teamId: TEAM_IDS.ALPHA, hp: 80, maxHp: 300, position: new THREE.Vector3(15, 0, 0) },
        { id: 'b1', teamId: TEAM_IDS.BRAVO, hp: 60, maxHp: 300, position: new THREE.Vector3(20, 0, 0) },
        { id: 'b2', teamId: TEAM_IDS.BRAVO, hp: 300, maxHp: 300, position: new THREE.Vector3(60, 0, 0) },
    ];
    const context = {
        runtimeConfig: { hunt: { teamObjective: 'FLAGS' } },
        entityManager: { _flagObjectiveSystem: { flags } },
    };
    const defender = { index: 0, teamId: TEAM_IDS.ALPHA, position: new THREE.Vector3() };
    const attacker = { index: 1, teamId: TEAM_IDS.ALPHA, position: new THREE.Vector3() };
    const flex = { index: 2, teamId: TEAM_IDS.ALPHA, position: new THREE.Vector3() };
    assert.equal(resolveFlagBotRole(defender), FLAG_BOT_ROLES.DEFENDER);
    assert.equal(resolveFlagBotRole(attacker), FLAG_BOT_ROLES.ATTACKER);
    assert.equal(resolveFlagBotRole(flex), FLAG_BOT_ROLES.FLEX);
    assert.equal(resolveFlagObjectiveTarget(defender, context).id, 'a1');
    assert.equal(resolveFlagObjectiveTarget(attacker, context).id, 'b1');
    assert.equal(resolveFlagObjectiveTarget(flex, context).id, 'b1', 'flex attacks while its team is not ahead');
});

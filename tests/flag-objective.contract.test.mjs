import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FLAG_OBJECTIVE_DEFAULTS,
    createFlagObjectiveState,
    damageFlagObjective,
    resolveFlagObjectiveOutcome,
    tickFlagObjectiveProtection,
} from '../src/shared/contracts/FlagObjectiveContract.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';
import { FlagObjectiveSystem } from '../src/entities/systems/FlagObjectiveSystem.js';

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
    });
});

test('runtime creates three fixed flags and two mutable guards per team flag', () => {
    const guards = [];
    const owner = {
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'FLAGS' } },
        arena: { bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -90, maxZ: 90 } },
        renderer: null,
        players: [{ index: 0, teamId: TEAM_IDS.ALPHA }, { index: 1, teamId: TEAM_IDS.BRAVO }],
        _simulationClockMs: 480000,
        _staticTurretSystem: {
            addObjectiveGuard(definition) {
                const guard = { ...definition, source: {} };
                guards.push(guard);
                return guard;
            },
            setTurretTeam(guard, teamId) { guard.teamId = teamId; guard.source.teamId = teamId; },
        },
    };
    const system = new FlagObjectiveSystem(owner);
    assert.equal(system.startRound(), 6);
    assert.equal(guards.length, 12);
    const flag = system.flags[0];
    flag.takeDamage(300, { sourcePlayer: owner.players[1] });
    assert.equal(flag.teamId, TEAM_IDS.BRAVO);
    assert.ok(flag.guards.every((guard) => guard.teamId === TEAM_IDS.BRAVO));
    assert.equal(system.getRoundOutcome().winnerTeamId, TEAM_IDS.BRAVO);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    ESCORT_PHASES,
    createEscortPathMetrics,
    resolveEscortCheckpointPathIndices,
    resolveEscortPathProgress,
} from '../src/shared/contracts/EscortObjectiveContract.js';
import { normalizeMapUnit } from '../src/shared/contracts/MapUnitContract.js';
import {
    bindEscortTank,
    updateEscortCheckpoints,
    updateEscortRecovery,
} from '../src/entities/systems/map-units/EscortMapUnitOps.js';
import { applyEscortBotMovement, resolveEscortBotRole } from '../src/hunt/HuntBotEscortOps.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { buildEscortBlock } from '../src/ui/postmatch/PostMatchEscortBlock.js';
import { HuntHUD } from '../src/ui/HuntHUD.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';

test('escort path progress and authored checkpoints use distance instead of waypoint count', () => {
    const path = [[0, 0, 0], [10, 0, 0], [10, 0, 30], [20, 0, 30]];
    const metrics = createEscortPathMetrics(path);
    assert.equal(metrics.totalDistance, 50);
    assert.deepEqual(resolveEscortCheckpointPathIndices(path, [2, 0, 99, 2]), [2]);
    assert.deepEqual(resolveEscortPathProgress({ path, fromIndex: 1, progress: 15 }, metrics), {
        distance: 25,
        totalDistance: 50,
        ratio: 0.5,
    });
});

test('escort map unit contract keeps sorted internal checkpoint indices', () => {
    const unit = normalizeMapUnit({
        id: 'escort_tank',
        kind: 'tank',
        path: [[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0]],
        allowedModes: ['ESCORT'],
        escortObjective: { checkpointPathIndices: [2, 1, 3, 1, -1] },
    });
    assert.deepEqual(unit.escortObjective.checkpointPathIndices, [1, 2]);
});

test('checkpoint repairs the tank and refills one downed recovery', () => {
    const definition = normalizeMapUnit({
        id: 'escort_tank', kind: 'tank', path: [[0, 0, 0], [10, 0, 0], [20, 0, 0]],
        maxHp: 600, allowedModes: ['ESCORT'], escortObjective: { checkpointPathIndices: [1] },
    }, 0, undefined, { preserveSpatial: true });
    const unit = bindEscortTank({
        definition,
        id: definition.id,
        path: definition.path,
        position: new THREE.Vector3(10, 0, 0),
        fromIndex: 1,
        toIndex: 2,
        progress: 0,
        hp: 120,
        maxHp: 600,
        alive: true,
        speed: 6,
        scale: 1,
        source: {},
    });
    unit.escortRecoveryCharges = 0;
    assert.equal(updateEscortCheckpoints(unit), 0);
    assert.equal(unit.hp, 240);
    assert.equal(unit.escortRecoveryCharges, 1);

    unit.hp = 0;
    unit.escortPhase = ESCORT_PHASES.DOWNED;
    unit.escortDownedRemaining = 12;
    const alpha = { index: 0, teamId: TEAM_IDS.ALPHA, alive: true, position: unit.position.clone() };
    const recovery = updateEscortRecovery(unit, [alpha], 5);
    assert.equal(recovery.recovered, true);
    assert.equal(unit.escortPhase, ESCORT_PHASES.MOVING);
    assert.equal(unit.hp, 210);
    assert.equal(unit.escortProtectionRemaining, 3);
});

test('escort bots receive stable team roles and override navigation toward the objective', () => {
    const players = [
        { index: 0, teamId: TEAM_IDS.ALPHA },
        { index: 2, teamId: TEAM_IDS.ALPHA },
        { index: 4, teamId: TEAM_IDS.ALPHA },
        { index: 1, teamId: TEAM_IDS.BRAVO },
        { index: 3, teamId: TEAM_IDS.BRAVO },
    ];
    assert.deepEqual(players.map((player) => resolveEscortBotRole(player, players)), [
        'ESCORT', 'VANGUARD', 'GUARD', 'HUNTER', 'INTERCEPTOR',
    ]);

    const player = {
        ...players[0],
        position: new THREE.Vector3(-50, 0, 0),
    };
    const policy = { _tmpRoleTarget: new THREE.Vector3(), _tmpRoleForward: new THREE.Vector3() };
    const input = { boost: false, yawLeft: true };
    let target = null;
    const role = applyEscortBotMovement({
        policy,
        input,
        player,
        runtimeContext: {
            navigationPlayers: players,
            escortObjective: { active: true, phase: ESCORT_PHASES.MOVING },
            escortTank: {
                position: new THREE.Vector3(0, 0, 0),
                path: [[0, 0, 0], [0, 0, 100]],
                toIndex: 1,
            },
        },
        clearSteering(value) { value.yawLeft = false; },
        steerToward(_policy, _input, _player, position) { target = position.clone(); },
    });
    assert.equal(role, 'ESCORT');
    assert.equal(player.escortBotRole, 'ESCORT');
    assert.equal(input.yawLeft, false);
    assert.ok(target.distanceTo(new THREE.Vector3(9, 0, -5)) < 0.001);
    assert.equal(input.boost, true);
});

test('escort scoring and post-match block expose both teams contributions', () => {
    const scoring = new HuntScoring(() => 0);
    scoring.registerEscortSeconds(0, 18.4);
    scoring.registerEscortCheckpointContribution(0);
    scoring.registerEscortRepair(0, 75, true);
    scoring.registerEscortTankDamage(1, 320);
    scoring.registerEscortTankDown(1, true);
    const players = [
        { index: 0, name: 'Alpha', isBot: false, entitySlotActive: true },
        { index: 1, name: 'Bravo', isBot: true, entitySlotActive: true },
    ];
    const scoreboard = scoring.getScoreboard(players);
    const block = buildEscortBlock({
        escort: { active: true, progress: 0.75, hpRatio: 0.35, checkpointsReached: 2, checkpointCount: 2 },
        huntScoreboard: scoreboard,
        players,
    });
    assert.equal(block.id, 'escort');
    assert.equal(block.rows.find((row) => row.key === 'route-progress').value, 0.75);
    assert.equal(block.rows.find((row) => row.key === 'escort-time').value, 18.4);
    assert.equal(block.rows.find((row) => row.key === 'tank-damage').value, 320);
    assert.equal(block.rows.find((row) => row.key === 'recoveries').value, 1);
    assert.match(block.rows.find((row) => row.key === 'top-escort').value, /Alpha/);
});

function createClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        contains(value) { return values.has(value); },
        toggle(value, force) {
            const enabled = force === undefined ? !values.has(value) : force === true;
            if (enabled) values.add(value); else values.delete(value);
            return enabled;
        },
    };
}

function createElement(ownerDocument = null) {
    return {
        ownerDocument,
        style: {},
        textContent: '',
        children: [],
        classList: createClassList(),
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren() { this.children.length = 0; },
        setAttribute(name, value) { this[name] = value; },
    };
}

test('Escort match HUD prioritizes route, tank health and recovery state', () => {
    const doc = { createElement: () => createElement(doc) };
    const refs = {
        root: createElement(),
        objective: createElement(),
        scoreboard: createElement(),
        targetProgress: createElement(),
        escortStatus: createElement(),
        escortRole: createElement(),
        escortPhase: createElement(),
        escortProgress: createElement(),
        escortProgressFill: createElement(),
        escortCheckpoints: createElement(doc),
        escortHealth: createElement(),
        escortHpFill: createElement(),
        escortHpText: createElement(),
        escortRecovery: createElement(),
    };
    const hud = new HuntHUD({ runtime: {}, refs });
    hud._updateMatchStatus({
        escortMode: true,
        timeLimitSeconds: 300,
        timeRemainingSeconds: 92,
        escort: {
            active: true, phase: ESCORT_PHASES.RECOVERING, progress: 0.625,
            hp: 0, maxHp: 600, hpRatio: 0, checkpointCount: 2, checkpointsReached: 1,
            repairProgress: 0.4, downedRemainingSeconds: 7,
        },
        scoreboardRows: [
            { teamId: TEAM_IDS.ALPHA, playerIndices: [0], escortSeconds: 31 },
            { teamId: TEAM_IDS.BRAVO, playerIndices: [1], escortTankDamage: 480 },
        ],
    }, [0]);
    assert.equal(refs.objective.textContent, 'Panzer schützen · 1:32');
    assert.equal(refs.escortRole.textContent, 'SCHÜTZEN');
    assert.equal(refs.escortPhase.textContent, 'Reparatur');
    assert.equal(refs.escortProgressFill.style.width, '63%');
    assert.equal(refs.escortHpText.textContent, '0 / 600');
    assert.equal(refs.escortRecovery.textContent, 'Reparatur 40%');
    assert.equal(refs.escortCheckpoints.children.length, 2);
    assert.equal(refs.escortCheckpoints.children[0].classList.contains('reached'), true);
});

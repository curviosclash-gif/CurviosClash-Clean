import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { calculateEndlessScore } from '../src/shared/contracts/EndlessParcoursContract.js';
import { buildEndlessSummary } from '../src/entities/endless/EndlessParcoursProjection.js';
import { registerEndlessStreakEvent } from '../src/entities/endless/EndlessParcoursRunOps.js';
import { ENDLESS_PARCOURS_CHECKPOINT, ENDLESS_PARCOURS_STREAK } from '../src/shared/contracts/EndlessParcoursStageContract.js';

function fixture() {
    const human = { index: 0, isBot: false, alive: true, baseSpeed: 25, hp: 100, shieldHP: 0,
        position: new THREE.Vector3(), hitboxRadius: 1.2, _renderDiscontinuityVersion: 0,
        getDirection(out) { return out.set(0, 0, 1); }, setControlOptions() {} };
    const player = { index: 1, isBot: true, alive: false, position: new THREE.Vector3(), maxHp: 100, hp: 100 };
    const manager = { humanPlayers: [human], players: [human, player], bots: [{ player }],
        deactivateBotSlot() { player.alive = false; player.entitySlotActive = false; } };
    const runtime = new EndlessParcoursRuntime({ baseSeed: 77, entityManager: manager, arena: {} });
    const place = (index, x, y, z, discontinuous = false) => {
        human.position.copy(runtime.getCoursePoint(index, x, y, z).position);
        if (discontinuous) human._renderDiscontinuityVersion++;
        runtime.update(1 / 60);
    };
    return { runtime, human, player, manager, place };
}

test('actual swept ring intersections score once in curves and slopes, while the visible ring stays aligned', () => {
    for (const index of [0, 3, 8, 14]) {
        const { runtime, place } = fixture();
        place(index, 0, 0, 90, true);
        const instance = runtime.activeModules.get(index), ring = instance.gateMesh;
        assert.equal(ring.geometry.type, 'TorusGeometry');
        assert.equal(ring.geometry, runtime._ringGeometry, 'all loaded rings share one owned geometry');
        assert.equal(instance.gatePosts.length, 0);
        const center = runtime.getCoursePoint(index, 0, 0, 116).position;
        assert.ok(ring.position.distanceTo(center) < 1e-6);
        place(index, 0, 0, 119);
        assert.equal(runtime.checkpointsPassed, 1); assert.equal(runtime.lastCheckpointIndex, index);
        assert.equal(runtime.bonusScore, 200);
        assert.equal(runtime.getHudState().reviveArmed, true);
        place(index, 0, 0, 90); place(index, 0, 0, 119);
        assert.equal(runtime.checkpointsPassed, 1, 'reverse and repeat cannot farm the same ring');
        const geometry = runtime._ringGeometry; let disposed = 0; geometry.addEventListener('dispose', () => disposed++);
        runtime.dispose(); runtime.dispose(); assert.equal(disposed, 1);
    }
});

test('passing beside or above a ring, clipping its rim, teleporting or moving backwards gives no bonus or rescue anchor', () => {
    for (const [x, y, discontinuous] of [[24, 0, false], [0, 24, false], [17, 0, false], [0, 0, true]]) {
        const { runtime, place } = fixture();
        place(3, x, y, 100, true); place(3, x, y, 119, discontinuous);
        assert.equal(runtime.checkpointsPassed, 0); assert.equal(runtime.bonusScore, 0);
        assert.equal(runtime.lastCheckpointAnchor, null); assert.equal(runtime.getHudState().reviveArmed, false);
        runtime.dispose();
    }
    const backward = fixture();
    backward.place(3, 0, 0, 119, true); backward.place(3, 0, 0, 100);
    assert.equal(backward.runtime.checkpointsPassed, 0); backward.runtime.dispose();
    const jump = fixture(); jump.place(8, 0, 0, 119);
    assert.equal(jump.runtime.checkpointsPassed, 0, 'a multi-module jump cannot award skipped rings'); jump.runtime.dispose();
});

test('a fast segment scores loaded rings in travel order even after streaming reordered the map', () => {
    const {runtime,place}=fixture();
    place(0,0,0,110,true);
    runtime.activeModules=new Map([...runtime.activeModules].reverse());
    place(1,0,0,119);
    assert.equal(runtime.checkpointsPassed,2);
    assert.equal(runtime.lastCheckpointIndex,1);
    assert.equal(runtime.bonusScore,500,'first ring 200, second ring 200 plus 100 streak');
    runtime.dispose();
});

test('regular and elite kills pay their distinct v3 base scores without counting the elite twice', () => {
    for (const [elite, expected] of [[false, 1500], [true, 4000]]) {
        const { runtime, human, player } = fixture(), slot = runtime._botSlots[0];
        slot.state = 'active'; player.alive = true; player.isEndlessElite = elite;
        runtime.handlePlayerDeath(player, 'PROJECTILE', { killer: human });
        assert.equal(calculateEndlessScore(runtime), expected);
        const summary = buildEndlessSummary(runtime, 'test');
        assert.equal(summary.combatScore, expected);
        assert.equal(summary.botKills, 1); assert.equal(summary.eliteKills, elite ? 1 : 0);
        runtime.handlePlayerDeath(player, 'PROJECTILE', { killer: human });
        assert.equal(calculateEndlessScore(runtime), expected, 'a repeated death cannot score again');
        runtime.dispose();
    }
});

test('the representative clean thirty-second pursuit gives combat thirty to forty percent of the total', () => {
    const { runtime, human, player } = fixture();
    runtime.maxProgressMeters = 1100; runtime.completedModules = 9; runtime.survivalSeconds = 30;
    // Nine real ring rewards at their normal streak growth, then two kills.
    for (let index = 0; index < 9; index++) {
        runtime.bonusScore += ENDLESS_PARCOURS_CHECKPOINT.bonusScore;
        registerEndlessStreakEvent(runtime, 'checkpoint', ENDLESS_PARCOURS_STREAK.checkpointBaseScore);
    }
    for (let index = 0; index < 2; index++) {
        runtime._botSlots[0].state = 'active'; player.alive = true;
        runtime.handlePlayerDeath(player, 'PROJECTILE', { killer: human });
    }
    const summary = buildEndlessSummary(runtime, 'test'), share = summary.combatScore / summary.score;
    assert.ok(share >= 0.3 && share <= 0.4, `representative combat share ${(share * 100).toFixed(1)}%`);
    assert.equal(summary.combatScore, 5000);
    runtime.dispose();
});

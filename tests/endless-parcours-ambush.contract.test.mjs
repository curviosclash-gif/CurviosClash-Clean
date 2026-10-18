import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { beginEndlessAttackWave, advanceEndlessWave, countEndlessOccupiedSlots } from '../src/entities/endless/EndlessParcoursWaveOps.js';
import { reconcileEndlessBots } from '../src/entities/endless/EndlessParcoursSlotOps.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';

function fixture(wave = 1) {
    const human = { index: 0, isBot: false, alive: true, baseSpeed: 25, position: new THREE.Vector3(),
        getDirection(out) { return out.set(0, 0, 1); } };
    const bots = Array.from({ length: 12 }, (_, i) => ({ player: { index: i + 1, isBot: true, alive: false,
        entitySlotActive: false, maxHp: 100, hp: 100, position: new THREE.Vector3() } }));
    const activations = [];
    const manager = { humanPlayers: [human], players: [human, ...bots.map(b => b.player)], bots,
        activateBotSlot(options) {
            const p = bots[options.slot].player;
            if (p.alive) return false;
            Object.assign(p, { alive: true, entitySlotActive: true, maxHp: 100, hp: 100, scenarioRole: options.role });
            p.position.copy(options.position); activations.push({ slot: options.slot, time: runtime.elapsedCombatSeconds }); return true;
        }, deactivateBotSlot(index) { Object.assign(bots[index].player, { alive: false, entitySlotActive: false }); } };
    const arena = { checkCollisionFast(position, radius) {
        for (const instance of runtime.activeModules.values()) {
            if (instance.staticColliders.some(c => sphereIntersectsStaticMeshCollider(c.meshCollider, position, radius))) return true;
        }
        return false;
    } };
    const runtime = new EndlessParcoursRuntime({ baseSeed: 17, entityManager: manager, arena });
    human.position.copy(runtime.getCoursePoint(1, 0, 0, 30).position);
    runtime.currentModuleIndex = 1; runtime.currentProgressMeters = runtime.projectCoursePoint(human.position).s;
    runtime.combatStarted = true;
    beginEndlessAttackWave(runtime, wave);
    return { runtime, human, bots, manager, activations };
}

test('an eliminated hunter is announced again but cannot return before three seconds or accept stale death identity', () => {
    const { runtime, human, bots, activations } = fixture();
    reconcileEndlessBots(runtime); runtime.elapsedCombatSeconds = 1; reconcileEndlessBots(runtime);
    const slot = runtime._botSlots.find(s => s.state === 'active'), generation = slot.activationGeneration;
    runtime.elapsedCombatSeconds = 4;
    runtime.handlePlayerDeath(slot.player, 'MG', { killer: human, activationGeneration: generation, runId: runtime.runId });
    assert.equal(slot.state, 'reserved'); assert.equal(slot.eligibleAt, 7); assert.equal(runtime.botKills, 1);
    reconcileEndlessBots(runtime);
    assert.equal(slot.telegraphedAt, 4);
    runtime.elapsedCombatSeconds = 6.999; reconcileEndlessBots(runtime);
    assert.equal(slot.player.alive, false);
    runtime.elapsedCombatSeconds = 7; reconcileEndlessBots(runtime);
    assert.equal(slot.player.alive, true); assert.equal(slot.activationGeneration, generation + 1);
    runtime.handlePlayerDeath(slot.player, 'MG', { killer: human, activationGeneration: generation, runId: runtime.runId });
    assert.equal(slot.player.alive, true); assert.equal(runtime.botKills, 1);
    assert.equal(activations.at(-1).time, 7); assert.ok(countEndlessOccupiedSlots(runtime._botSlots) <= 2);
    // A wall loss also replenishes the field, without awarding a human kill.
    runtime.handlePlayerDeath(slot.player, 'WALL'); assert.equal(runtime.botKills, 1); assert.equal(slot.eligibleAt, 10);
    runtime.wavePhaseElapsedSeconds = 30; advanceEndlessWave(runtime, 0);
    runtime.elapsedCombatSeconds = 12; reconcileEndlessBots(runtime);
    assert.equal(bots.some(b => b.player.alive), false, 'expired reservations never cross into the pause');
    runtime.dispose();
});

test('an announced ring activates three safe hunters in one tick while ordinary spawns retain their cadence', () => {
    const { runtime, activations } = fixture(4);
    reconcileEndlessBots(runtime);
    const members = runtime._botSlots.filter(s => s.ambushId);
    assert.equal(members.length, 3); assert.equal(runtime.spawnWarning.ambush, true); assert.equal(runtime.spawnWarning.count, 3);
    for (let i = 0; i < members.length; i++) for (let j = 0; j < i; j++) {
        const a = members[i].plannedAnchor, b = members[j].plannedAnchor;
        assert.ok(new THREE.Vector3(a.x, a.y, a.z).distanceTo(new THREE.Vector3(b.x, b.y, b.z)) >= 18);
    }
    runtime.elapsedCombatSeconds = 0.999; reconcileEndlessBots(runtime); assert.equal(activations.length, 0);
    runtime.respiteUntilSeconds = 2;
    runtime.elapsedCombatSeconds = 1; reconcileEndlessBots(runtime); assert.equal(activations.length, 0);
    runtime.elapsedCombatSeconds = 2; reconcileEndlessBots(runtime);
    assert.equal(activations.length, 3); assert.ok(activations.every(a => a.time === 2));
    reconcileEndlessBots(runtime); assert.equal(activations.length, 3, 'ordinary reservation stays gated');
    runtime.elapsedCombatSeconds = 3; reconcileEndlessBots(runtime); assert.equal(activations.length, 3);
    runtime.elapsedCombatSeconds = 3.5; reconcileEndlessBots(runtime); assert.equal(activations.length, 4);
    assert.equal(countEndlessOccupiedSlots(runtime._botSlots), 5);
    runtime.dispose();
});

test('an unloaded ambush must find a fresh safe formation and repeat the whole warning', () => {
    const { runtime, activations } = fixture(4);
    reconcileEndlessBots(runtime);
    const members = runtime._botSlots.filter(s => s.ambushId);
    const index = members[0].plannedAnchor.ambushModuleIndex;
    const old = runtime.activeModules.get(index); runtime.activeModules.delete(index);
    runtime.elapsedCombatSeconds = 1; reconcileEndlessBots(runtime);
    assert.equal(activations.length, 0); assert.ok(members.every(s => s.telegraphedAt === -1));
    runtime.elapsedCombatSeconds = 1.1; reconcileEndlessBots(runtime);
    assert.ok(members.every(s => s.telegraphedAt === 1.1));
    runtime.elapsedCombatSeconds = 2; reconcileEndlessBots(runtime); assert.equal(activations.length, 0);
    runtime.elapsedCombatSeconds = 2.1; reconcileEndlessBots(runtime); assert.equal(activations.length, 3);
    runtime.activeModules.set(index, old); runtime.dispose();
});

test('an elite cannot be farmed repeatedly inside its wave and a blocked formation leaves ordinary slots usable', () => {
    const {runtime,human}=fixture(5);
    runtime._eliteWaveSpawned=5;
    const elite=runtime._botSlots.find(s=>s.plannedElite);
    elite.state='active';elite.player.alive=true;elite.player.entitySlotActive=true;elite.player.isEndlessElite=true;
    runtime.handlePlayerDeath(elite.player,'MG',{killer:human});
    assert.equal(runtime.eliteKills,1);
    assert.ok(runtime._botSlots.every(s=>!s.plannedElite));
    runtime.dispose();
    const blocked=fixture(4);
    // Only rear ordinary anchors remain safe. An impossible ring may wait, but
    // must not deadlock all the other existing reservations.
    blocked.runtime._isSpawnAnchorSafe=anchor=>!anchor.ambushId;
    reconcileEndlessBots(blocked.runtime);
    blocked.runtime.elapsedCombatSeconds=1;
    reconcileEndlessBots(blocked.runtime);
    assert.equal(blocked.activations.length,1);
    blocked.runtime.dispose();
});

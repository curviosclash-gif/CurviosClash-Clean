import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { resolveEndlessAreaBlock, resolveEndlessAreaTier } from '../src/shared/contracts/EndlessParcoursPacingContract.js';
import { completeEndlessFlightObjective, syncEndlessFlightObjective } from '../src/entities/endless/EndlessParcoursObjectiveOps.js';

test('preview order cannot change any seeded module, area or tier at a given physical station', () => {
    for (const seed of [1, 77, 130202, 98765]) {
        const direct = new EndlessParcoursPath({ baseSeed: seed }), sequential = new EndlessParcoursPath({ baseSeed: seed });
        direct.getModule(110);
        for (let index = 0; index <= 110; index++) {
            const module = sequential.getModule(index);
            assert.deepEqual(module, direct.getModule(index));
            if (!index) continue;
            const metric = sequential.getMetric(), start = metric.getStationRange(index).startS;
            const expectedBlock = Math.floor((start - metric.getStationRange(0).endS + 1e-7) / 600);
            assert.equal(module.areaBlock, expectedBlock);
            assert.equal(module.difficultyTier, resolveEndlessAreaTier(expectedBlock));
        }
        direct.dispose(); sequential.dispose();
    }
});

test('the early normal reference flight spends about 25–30 seconds in each physical area', () => {
    for (const seed of [1, 77, 130202, 98765]) {
        const path = new EndlessParcoursPath({ baseSeed: seed });
        let prior = -1, start = 0, measured = 0;
        for (let index = 1; index < 26; index++) {
            const module = path.getModule(index), station = path.getMetric().getStationRange(index).startS;
            if (module.areaBlock === prior) continue;
            if (prior >= 0) {
                const seconds = (station - start) / 20.4;
                assert.ok(seconds >= 25 && seconds <= 30, `seed ${seed}, area ${prior}: ${seconds}s`);
                measured++;
            }
            prior = module.areaBlock; start = station;
        }
        assert.ok(measured >= 3); path.dispose();
    }
});

test('tier boundaries use the same area clock, independent of combat duration', () => {
    assert.deepEqual([0, 2, 3, 7, 8, 14, 15].map(resolveEndlessAreaTier), [1, 1, 2, 2, 3, 3, 4]);
    assert.equal(resolveEndlessAreaBlock(719.999, 120), 0);
    assert.equal(resolveEndlessAreaBlock(720, 120), 1);
    const human = { index: 0, alive: true, baseSpeed: 20, hp: 100, shieldHP: 0,
        position: new THREE.Vector3(), getDirection(out) { return out.set(0, 0, 1); }, setControlOptions() {} };
    const runtime = new EndlessParcoursRuntime({ baseSeed: 77, entityManager: { humanPlayers: [human], bots: [] }, arena: {} });
    const place = (index) => { human.position.copy(runtime.getCoursePoint(index, 0, 0, 5).position); runtime.update(0); };
    place(1); runtime.elapsedCombatSeconds = 10000; runtime.update(0);
    assert.equal(runtime.getHudState().threatLevel, 'EASY');
    let index = 1;
    while (runtime._path.getModule(index).areaBlock < 3) index++;
    human.position.copy(runtime.getCoursePoint(index, 1000, 0, 5).position);
    runtime.update(0);
    assert.equal(runtime.pacingAreaBlock, 0, 'outside flight cannot unlock a later course area');
    assert.equal(runtime.objectiveAreaBlock, 0, 'outside flight cannot unlock a later objective');
    runtime.elapsedCombatSeconds = 0; place(index);
    assert.equal(runtime.pacingAreaBlock, 3); assert.equal(runtime._activePaletteTier, 2);
    assert.equal(runtime.getHudState().threatLevel, 'NORMAL');
    assert.equal(runtime.objectiveAreaBlock, runtime.pacingAreaBlock);
    assert.equal(runtime.currentArea, runtime.activeModules.get(index).module.area);
    place(index - 1);
    assert.equal(runtime.pacingAreaBlock, 3); assert.equal(runtime.objectiveAreaBlock, 3);
    assert.equal(runtime._activePaletteTier, 2);
    runtime.dispose();
});

test('returning to an old area cannot reset an earned flight objective or farm its bonus', () => {
    const path = new EndlessParcoursPath({ baseSeed: 77 });
    const runtime = { _path: path, activeModules: new Map(), objectiveAreaBlock: -1, bonusScore: 0, flightObjectivesCompleted: 0 };
    syncEndlessFlightObjective(runtime, 1, 'industrial');
    runtime.flightObjective.progress = 3;
    assert.equal(completeEndlessFlightObjective(runtime), true);
    const earned = runtime.bonusScore;
    let next = 1;
    while (path.getModule(next).areaBlock === 0) next++;
    syncEndlessFlightObjective(runtime, next, path.getModule(next).area);
    const objective = runtime.flightObjective;
    syncEndlessFlightObjective(runtime, 1, 'industrial');
    syncEndlessFlightObjective(runtime, next, path.getModule(next).area);
    assert.equal(runtime.flightObjective, objective); assert.equal(runtime.bonusScore, earned);
    assert.equal(runtime.flightObjectivesCompleted, 1); path.dispose();
});

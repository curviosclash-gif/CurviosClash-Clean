import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveEndlessStartChoice, resolveEndlessRecordScope } from '../src/shared/contracts/EndlessParcoursSeedContract.js';
import { normalizeArcadeRunSettings, createDefaultArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { ENDLESS_PARCOURS_RULE_VERSION as ruleVersion } from '../src/shared/contracts/EndlessParcoursWaveContract.js';
import { normalizeEndlessParcoursRecords, updateEndlessParcoursRecords, ENDLESS_PARCOURS_RECORDS_STORAGE_KEY as key } from '../src/shared/contracts/EndlessParcoursRecordsContract.js';
import { createArcadeRankContext } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { resolveArcadeRankKey, insertArcadeRankedResult, normalizeArcadeRankedLeaderboard } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { queueEndlessSettlement, retryEndlessSettlements } from '../src/state/arcade/EndlessParcoursSettlementStore.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';

const run = (vehicleId = 'ship5', seedMode = 'free', seed = 77, score = 100) =>
    ({ runId: `${vehicleId}-${seedMode}-${seed}-${score}`, ruleVersion, vehicleId, seedMode, seed, score, distanceMeters: score, combatScore: 50 });
function storeWith(records = null) {
    const data = new Map(records ? [[key, records]] : []);
    return { data, blocked: false,
        loadJsonRecord: (name, fallback) => data.has(name) ? structuredClone(data.get(name)) : fallback,
        readJsonRecordResult: (name) => data.has(name) ? { status: 'found', value: structuredClone(data.get(name)) } : { status: 'missing' },
        saveJsonRecord(name, value) { if (this.blocked && name === key) return false; data.set(name, structuredClone(value)); return true; } };
}

test('free is the settings default; explicit training seeds survive sanitizing and the actual runtime config', () => {
    assert.equal(createDefaultArcadeRunSettings().endlessSeedMode, 'free');
    const first = resolveEndlessStartChoice({}, 0.1), second = resolveEndlessStartChoice({}, 0.9);
    assert.notEqual(first.seed, second.seed); assert.equal(first.seedMode, 'free');
    const choice = { seedMode: 'training', trainingSeed: 130202 };
    assert.deepEqual(resolveEndlessStartChoice(choice, 0.1), resolveEndlessStartChoice(choice, 0.9));
    for (const seed of [0, -1, 1.5, NaN, Infinity, 2147483648]) assert.equal(resolveEndlessStartChoice({ ...choice, trainingSeed: seed }).ok, false);
    const arcade = normalizeArcadeRunSettings({ runType: 'endless_parcours', seed: 130202, endlessSeedMode: 'training' });
    const runtime = createRuntimeConfigSnapshot({ gameMode: 'ARCADE', mode: '1p', localSettings: {modePath:'arcade'}, arcade });
    assert.equal(runtime.arcade.seed, 130202); assert.equal(runtime.arcade.endlessSeedMode, 'training');
    assert.equal(normalizeArcadeRunSettings(JSON.parse(JSON.stringify(arcade))).endlessSeedMode, 'training');
});

test('model, rule and training seed records stay separate while free seeds compete within their model', () => {
    let records = null;
    for (const row of [run('ship5','free',1,1000), run('ship1','free',2,20), run('ship5','training',1,30), run('ship5','training',2,40)]) {
        const result = updateEndlessParcoursRecords(records, row); records = result.records;
        assert.equal(result.isNewRecord, true, 'a first model record is independent of the shared rule maximum');
    }
    records = updateEndlessParcoursRecords(records, run('ship5','free',999,900)).records;
    assert.equal(records.best.score, 1000); assert.equal(records.bestByRuleVersion[ruleVersion].score, 1000);
    assert.equal(records.bestByRunScope[resolveEndlessRecordScope(run('ship5','free',555))].score, 1000);
    assert.equal(records.bestByRunScope[resolveEndlessRecordScope(run('ship1','free'))].score, 20);
    assert.equal(records.bestByRunScope[resolveEndlessRecordScope(run('ship5','training',1))].score, 30);
    assert.equal(records.bestByRunScope[resolveEndlessRecordScope(run('ship5','training',2))].score, 40);
    assert.equal(Object.keys(records.bestByRunScope).length, 4);
});

test('legacy numbers stay unchanged without invented model provenance, and scoped distance survives score-top eviction and restart', () => {
    const legacy = { schemaVersion: 'endless-parcours-records.v3', best: {score:9000,distanceMeters:50000}, top:[{score:9000,distanceMeters:50000}], milestones:['distance-1000'] };
    let records = normalizeEndlessParcoursRecords(legacy);
    assert.equal(records.best.score, 9000); assert.equal(records.bestDistance.distanceMeters, 50000);
    assert.equal(Object.keys(records.bestByRunScope).length, 0); assert.equal(Object.keys(records.bestDistanceByRunScope).length, 0);
    records = updateEndlessParcoursRecords(records, { ...run(), distanceMeters: 8000, score: 1 }).records;
    for (let n=1;n<=8;n++) records=updateEndlessParcoursRecords(records, run('ship5','free',n,n*100)).records;
    records=normalizeEndlessParcoursRecords(JSON.parse(JSON.stringify(records)));
    assert.equal(records.best.score,9000); assert.equal(records.bestDistance.distanceMeters,50000);
    assert.equal(records.bestDistanceByRunScope[resolveEndlessRecordScope(run())].distanceMeters,8000);
    assert.equal(records.bestByRunScope[resolveEndlessRecordScope(run())].combatScore,50);
    assert.deepEqual(records.milestones.includes('distance-1000'),true);
});

test('the real ranked board separates model and training seed and rejects a row from another scope', () => {
    const context = (vehicleId, mode='free', seed=77) => createArcadeRankContext({runId: `${vehicleId}-${mode}-${seed}`,runType:'endless_parcours',vehicleId,profile:{level:1},
        runSettings:normalizeArcadeRunSettings({runType:'endless_parcours',endlessSeedMode:mode,seed})});
    const contexts=[context('ship5'),context('ship1'),context('ship5','training',1),context('ship5','training',2)];
    assert.equal(new Set(contexts.map(resolveArcadeRankKey)).size,4);
    assert.equal(resolveArcadeRankKey(context('ship5','free',1)),resolveArcadeRankKey(context('ship5','free',2)));
    const inserted=insertArcadeRankedResult(null,contexts[0],{score:100});
    const good=inserted.leaderboard.boards[inserted.key][0];
    const normalized=normalizeArcadeRankedLeaderboard({...inserted.leaderboard,boards:{[inserted.key]:[good,{...good,vehicleId:'ship1'}]}});
    assert.deepEqual(normalized.boards[inserted.key],[good]);
});

test('unknown and unreadable record formats remain untouched with a pending settlement', () => {
    const future={schemaVersion:'endless-parcours-records.v99',original:'preserve'};
    for (const unreadable of [false,true]) {
        const store=storeWith(future);
        if(unreadable)store.readJsonRecordResult=()=>({status:'unavailable'});
        const row=run(), settlement={runId:row.runId,vehicleId:'ship5',ruleVersion,xp:125,summary:row};
        const result=queueEndlessSettlement(store,settlement);
        assert.equal(result.pending,true); assert.deepEqual(store.data.get(key),future);
        assert.equal(store.data.has(ARCADE_VEHICLE_PROFILE_STORAGE_KEY),false);
    }
});

test('failed record writes retry the same scoped run and credit vehicle XP exactly once', () => {
    const store=storeWith(),row=run(); store.blocked=true;
    assert.equal(queueEndlessSettlement(store,{runId:row.runId,vehicleId:'ship5',ruleVersion,xp:125,summary:row}).pending,true);
    store.blocked=false; assert.equal(retryEndlessSettlements(store).ok,true); assert.equal(retryEndlessSettlements(store).ok,true);
    assert.equal(store.data.get(key).bestByRunScope[resolveEndlessRecordScope(row)].score,100);
    assert.equal(store.data.get(key).processedSettlementIds.length,1);
    assert.equal(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5.xp,125);
});

test('the runtime freezes its actual model and reads only that model record and distance marker', () => {
    let records=updateEndlessParcoursRecords(null,run('ship5','training',77,100)).records;
    records=updateEndlessParcoursRecords(records,run('ship1','training',77,999)).records;
    const human={index:0,alive:true,hp:100,baseSpeed:20,position:new THREE.Vector3(),getDirection(out){return out.set(0,0,1);},setControlOptions(){}};
    const runtime=new EndlessParcoursRuntime({baseSeed:77,seedMode:'training',arena:{},entityManager:{humanPlayers:[human],bots:[]}});
    runtime.setRecordStore(storeWith(records)); runtime.setRunProfile({vehicleId:'ship5'});
    assert.equal(runtime.getRecordScore(),100); assert.equal(runtime.getRecordDistanceMeters(),100);
    runtime.setRunProfile({vehicleId:'ship1'}); assert.equal(runtime.startVehicleId,'ship5'); assert.equal(runtime.getRecordScore(),100);
    const summary=runtime.finalize('ENDLESS_ABORT',{persist:false,requestRoundEnd:false});
    assert.equal(summary.vehicleId,'ship5'); assert.equal(summary.seedMode,'training'); assert.equal(summary.seed,77);
    runtime.dispose();
});

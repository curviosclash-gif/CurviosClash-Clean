import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/entities/Player.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { syncEndlessHunterSpeed, ENDLESS_HUNTER_SPEED_MULTIPLIER } from '../src/entities/endless/EndlessParcoursHunterOps.js';
import { tryActivateEndlessSlot } from '../src/entities/endless/EndlessParcoursSlotOps.js';
import { applyHuntBotParcoursMovement } from '../src/hunt/HuntBotParcoursOps.js';
import { HuntBotPolicy } from '../src/hunt/HuntBotPolicy.js';
import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { clearSteeringInput, applySteeringTowardPosition } from '../src/hunt/HuntBotSteeringOps.js';
import { OBSERVATION_LENGTH_V1, WALL_DISTANCE_FRONT, WALL_DISTANCE_DOWN, TARGET_DISTANCE_RATIO,
    TARGET_ALIGNMENT, TARGET_IN_FRONT, LOCAL_OPENNESS_RATIO } from '../src/entities/ai/observation/ObservationSchemaV1.js';

const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} vs ${b}`);

test('hunter permanent speed follows the player without copying pickups or compounding strategy multipliers', () => {
    const human = { alive: true, baseSpeed: 50, _speedEffectBaseSpeed: 25 };
    let calls = 0;
    const player = { alive: true, entitySlotActive: true, endlessRunId: 'run', baseSpeed: 30,
        _speedEffectBaseSpeed: 20, _arcadeBaseSpeed: 10, isBoosting: true, speed: 90,
        setControlOptions(options) { calls++; Player.prototype.setControlOptions.call(this, options); } };
    const runtime = { runId: 'run', entityManager: { humanPlayers: [human] }, _hunterSpeedOptions: { speed: 1 } };
    for (let index=0; index<1000; index++) syncEndlessHunterSpeed(runtime, player);
    near(player._speedEffectBaseSpeed, 25*ENDLESS_HUNTER_SPEED_MULTIPLIER);
    near(player.baseSpeed, 25*ENDLESS_HUNTER_SPEED_MULTIPLIER*1.5);
    assert.equal(player.speed,90,'an active boost keeps its current motion until the normal player tick');
    assert.equal(calls,1);
    human._speedEffectBaseSpeed=40; human.baseSpeed=80;
    syncEndlessHunterSpeed(runtime,player); near(player._speedEffectBaseSpeed,44.8); near(player.baseSpeed,67.2);
    assert.equal(calls,2);
    player.isBoosting=false; player._speedEffectBaseSpeed=undefined; player.baseSpeed=10;
    syncEndlessHunterSpeed(runtime,player); near(player.baseSpeed,44.8); near(player.speed,44.8);
    player.endlessRunId='foreign'; human._speedEffectBaseSpeed=50;
    assert.equal(syncEndlessHunterSpeed(runtime,player),false); near(player.baseSpeed,44.8);
    player.endlessRunId='run'; player.entitySlotActive=false;
    assert.equal(syncEndlessHunterSpeed(runtime,player),false);
    player.entitySlotActive=true; runtime._disposed=true;
    assert.equal(syncEndlessHunterSpeed(runtime,player),false);
});

function runtimeFixture() {
    const human={index:0,alive:true,position:new THREE.Vector3(),baseSpeed:25};
    const player={index:1,isBot:true,alive:true,entitySlotActive:true,position:new THREE.Vector3()};
    const manager={humanPlayers:[human],players:[human,player],bots:[{player}],deactivateBotSlot(){player.alive=false;}};
    const runtime=new EndlessParcoursRuntime({baseSeed:4242,entityManager:manager,arena:{}});
    runtime._botSlots[0].state='active';player.endlessRunId=runtime.runId;
    player.position.copy(runtime.getCoursePoint(3,0,0,50).position);
    return {runtime,manager,player,human};
}

test('per-bot snapshots use arc length in curves, reverse ahead hunters and stay bounded across repeated queries', () => {
    const f=runtimeFixture(),{runtime,player}=f;
    const metric=runtime.getPathMetric(),botS=runtime.projectCoursePoint(player.position).s;
    runtime.currentProgressMeters=botS+100;
    const route=runtime.getBotRouteSnapshot(1),expected=new THREE.Vector3().copy(metric.sampleAtS(botS+32).position);
    assert.ok(route.checkpoints[0].pos.distanceTo(expected)<1e-6);
    assert.equal(route.runId,runtime.runId);
    for(let index=0;index<1000;index++)assert.equal(runtime.getBotRouteSnapshot(1),route);
    assert.equal(runtime._hunterRoutes.size,1);
    runtime.currentProgressMeters=botS-100;
    assert.equal(runtime.getBotRouteSnapshot(1),route);
    assert.ok(route.checkpoints[0].pos.distanceTo(metric.sampleAtS(botS-32).position)<1e-6);
    const count=metric.getModuleCount();
    player.position.z=1e9;
    assert.equal(runtime.getBotRouteSnapshot(1),null);assert.equal(metric.getModuleCount(),count);
    assert.equal(runtime.getBotRouteSnapshot(0),null);assert.equal(runtime.getBotRouteSnapshot(1234),null);
    runtime.dispose();assert.equal(runtime._hunterRoutes.size,0);assert.equal(runtime.getBotRouteSnapshot(1),null);
});

test('optional bot route lookup leaves the normal UI and authored parcours snapshot unchanged', () => {
    const legacy={enabled:true,routeId:'authored'},borrowed={enabled:true,kind:'endless_hunter'};
    const manager={_parcoursProgressSystem:{getRouteSnapshot(){return legacy;}},
        endlessParcoursRuntime:{getBotRouteSnapshot(index){return index===1?borrowed:null;}}};
    assert.equal(EntityManager.prototype.getParcoursRouteSnapshot.call(manager),legacy);
    assert.equal(EntityManager.prototype.getParcoursRouteSnapshot.call(manager,1),borrowed);
    assert.equal(EntityManager.prototype.getParcoursRouteSnapshot.call(manager,0),null);
    manager.endlessParcoursRuntime=null;
    assert.equal(EntityManager.prototype.getParcoursRouteSnapshot.call(manager,1),legacy);
});

test('counter-flow hunters continue along their heading after passing the human instead of turning into the wall', () => {
    const {runtime,player}=runtimeFixture();
    const metric=runtime.getPathMetric(), projected=runtime.projectCoursePoint(player.position);
    const station=projected.s, tangent=new THREE.Vector3().copy(projected.tangent);
    player.getDirection=out=>out.copy(tangent).negate();
    runtime.currentProgressMeters=station+80;
    const route=runtime.getBotRouteSnapshot(player.index);
    assert.ok(route.checkpoints[0].pos.distanceTo(metric.sampleAtS(station-32).position)<1e-6);
    player.getDirection=out=>out.copy(tangent);
    runtime.currentProgressMeters=station-80;
    assert.ok(runtime.getBotRouteSnapshot(player.index).checkpoints[0].pos.distanceTo(metric.sampleAtS(station+32).position)<1e-6);
    runtime.dispose();
});

test('a reserved ahead hunter enters facing back along its curved course frame', () => {
    const {runtime,manager}=runtimeFixture();
    const instance=[...runtime.activeModules.values()].find(i=>i.module.moduleIndex>0&&!i.module.recovery);
    const local=instance.module.botAnchors.find(a=>a.ahead&&!a.elite);
    assert.ok(local);
    const frame=runtime.getCoursePoint(instance.module.moduleIndex,local.x,local.y,local.z);
    const expected=new THREE.Vector3().copy(frame.tangent).negate();
    const slot=runtime._botSlots[0];
    Object.assign(slot,{state:'reserved',reservedWave:1,telegraphedAt:0,plannedElite:false,
        plannedAnchor:{id:local.id,x:frame.position.x,y:frame.position.y,z:frame.position.z,ahead:true}});
    runtime.waveNumber=1;runtime.wavePhase='attack';runtime.elapsedCombatSeconds=3;
    runtime.currentModuleIndex=instance.module.moduleIndex;runtime.lastBotActivationAtSeconds=-Infinity;
    runtime._isSpawnAnchorSafe=()=>true;
    let direction;
    manager.activateBotSlot=options=>{direction=options.direction.clone();return true;};
    assert.equal(tryActivateEndlessSlot(runtime,slot),true);
    assert.ok(direction.distanceTo(expected)<1e-6);
    runtime.dispose();
});

function movementFixture() {
    const target=new THREE.Vector3(12,0,32);
    const route={enabled:true,kind:'endless_hunter',runId:'run',checkpoints:[{pos:target}]};
    const player={index:1,isBot:true,endlessRunId:'run',alive:true,position:new THREE.Vector3(),hitboxRadius:2.5,
        getDirection(out){return out.set(0,0,1);}};
    const policy={_tmpRoleForward:new THREE.Vector3(),_tmpGate:new THREE.Vector3(),_tmpForward:new THREE.Vector3(),_tmpRight:new THREE.Vector3(),_tmpUp:new THREE.Vector3()};
    const input={shootMG:true,shootRocket:true,shootItem:true,useItem:2,boost:true};
    const manager={getParcoursRouteSnapshot(){return route;},arena:{checkCollisionFast(){return false;}}};
    const context={entityManager:manager,arena:manager.arena,players:[player]};
    return {route,player,policy,input,manager,context,
        apply(extra={}) {return applyHuntBotParcoursMovement({policy,input,player,runtimeContext:context,
            clearSteering:clearSteeringInput,steerToward:applySteeringTowardPosition,...extra});}};
}

test('route movement keeps weapon decisions, hands back close combat and retreat, and rejects thin intervening geometry', () => {
    const f=movementFixture();assert.equal(f.apply(),'ENDLESS_ROUTE');
    assert.equal(f.input.shootMG,true);assert.equal(f.input.shootRocket,true);assert.equal(f.input.shootItem,true);assert.equal(f.input.useItem,2);
    assert.equal(f.input.boost,false);assert.ok(f.input.yawLeft);
    assert.equal(f.apply({shouldRetreat:true}),null);
    f.context.players.push({index:0,alive:true,position:new THREE.Vector3(0,0,20)});
    assert.equal(f.apply(),null,'a reachable nearby enemy keeps existing fight movement');
    f.context.players.length=1;
    // A 0.1m wall between the old four sample centres must still block navigation.
    f.manager.arena.checkCollisionFast=(p,r)=>Math.abs(p.z-6)<r;
    assert.equal(f.apply(),null);
    f.manager.arena.checkCollisionFast=()=>false;f.route.runId='old';assert.equal(f.apply(),null);
    f.route.runId='run';f.route.kind='authored';assert.equal(f.apply(),null);
});

for(const [name,create] of [
    ['hunt',()=>new HuntBotPolicy()],
    ['hunt bridge',()=>new HuntBridgePolicy({autoLoadCheckpoint:false})],
    ['heuristic',()=>new HeuristicBotPolicy({difficulty:'NORMAL'})],
])test(`${name} policy reaches the shared route boundary without replacing its fight policy`,()=>{
    const f=movementFixture(),policy=create();
    Object.assign(f.player,{hp:100,maxHp:100,shieldHP:100,maxShieldHp:100,baseSpeed:25,speed:25,
        scenarioRole:'pursuer',inventory:[],rocketInventory:[],getAimDirection(out){return out.set(0,0,1);}});
    Object.assign(f.context,{mode:'HUNT',rules:{planarMode:false},projectiles:[],dt:1/60});
    const enemy={index:0,alive:true,hp:100,maxHp:100,shieldHP:0,maxShieldHp:100,position:new THREE.Vector3(0,0,70),
        getDirection(out){return out.set(0,0,1);}};
    f.context.players.push(enemy);
    const observation=new Float32Array(OBSERVATION_LENGTH_V1);
    for(let i=WALL_DISTANCE_FRONT;i<=WALL_DISTANCE_DOWN;i++)observation[i]=1;
    observation[TARGET_DISTANCE_RATIO]=70/120;observation[TARGET_ALIGNMENT]=1;
    observation[TARGET_IN_FRONT]=1;observation[LOCAL_OPENNESS_RATIO]=1;f.context.observation=observation;
    const input=policy.update(1/60,f.player,f.context);
    assert.equal(f.player.botObjectiveType,'ENDLESS_ROUTE');
    assert.ok(input.yawLeft||input.yawAxis>0);
    assert.equal(input.boost,false);
    assert.equal(input.shootMG,true,'following the course retains a valid aligned machine-gun attack');
});

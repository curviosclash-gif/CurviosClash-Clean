import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createK19ShipProbeSweep } from './helpers/k19-ship-probe.mjs';
import { FROZEN_HELIX_MAP } from '../src/core/config/maps/presets/frozen_helix.js';
import { buildRouteFromParcours, resolveParcoursForPortalChain } from '../src/entities/systems/ParcoursProgressUtils.js';
import { compileArenaCollision } from './helpers/parcours-race-line.mjs';
import { K19_FROZEN_CP06_WAYPOINTS, K19_FROZEN_CP07_WAYPOINTS, K19_FROZEN_CP09_ENTRY_POSITION, resolveK19CheckpointEntryOverride, resolveCollinearDepartureSweep } from './helpers/k19-waypoint-transition.mjs';

const map = FROZEN_HELIX_MAP.frozen_helix;
const chainConfig = id => ({ arcade: { enabled: true, runType: 'five_portals', portalChainId: id } });

test('Frozen CP07 is approached through the open lower mouth with an exactly straight final departure', () => {
    const start = new THREE.Vector3(-16.673269567305564,145.46107305668247,-77.99857549377249);
    const finish = new THREE.Vector3(24,90,30);
    const clear = createK19ShipProbeSweep(map);
    assert.equal(clear(start,finish),false,'the direct line hits the central pillar');
    const route=[start,...K19_FROZEN_CP07_WAYPOINTS.map(p=>new THREE.Vector3(p.x,p.y,p.z)),finish];
    for(let index=1;index<route.length;index++)assert.equal(clear(route[index-1],route[index]),true,'all real ship probes clear every authored waypoint leg');
    const last=route.at(-2), incoming=route.at(-3), direction=last.clone().sub(incoming).normalize();
    const arrivalBand=2.4, maxMotionDisplacement=9.718;
    const switchPoint=last.clone().addScaledVector(direction,-arrivalBand);
    const turnEnd=switchPoint.clone().addScaledVector(direction,maxMotionDisplacement);
    const asPoint=p=>({x:p.x,y:p.y,z:p.z});
    const proof={switchPoint:asPoint(switchPoint),turnEnd:asPoint(turnEnd),target:asPoint(finish),arrivalBand,maxMotionDisplacement};
    assert.ok(resolveCollinearDepartureSweep(proof),'the entire final turn interval shares one positive vertical ray');
    assert.equal(resolveCollinearDepartureSweep({...proof,target:{x:24.000001,y:90,z:30}}),null,'even a tiny bend retains the full conservative envelope');
    assert.equal(buildRouteFromParcours(map.parcours,{positionScale:3}).rules.bidirectionalCheckpoints,true,'the existing resolved ring rules permit this upward crossing');
    assert.equal(map.parcours.rules.maxSegmentTimeMs,18000,'the gameplay deadline stays unchanged');
});

test('Frozen CP05 exits the north bore above its platform before the full ship turns toward CP06', () => {
    const start = new THREE.Vector3(89.99949530484439,150.0222005277053,15.47006981347259);
    const finish = new THREE.Vector3(-30,135,-75);
    const clear = createK19ShipProbeSweep(map);
    assert.equal(clear(start,finish),false,'turning west inside the bore hits the unchanged wall');
    const route=[start,...K19_FROZEN_CP06_WAYPOINTS.map(p=>new THREE.Vector3(p.x,p.y,p.z)),finish];
    for(let index=1;index<route.length;index++)assert.equal(clear(route[index-1],route[index]),true,'all actual ship wall probes clear both route legs');
    const length=route.slice(1).reduce((sum,p,index)=>sum+p.distanceTo(route[index]),0);
    assert.ok(length/16 < map.parcours.rules.maxSegmentTimeMs/1000,'the unboosted route fits the unchanged 18-second segment limit');
});

test('Frozen CP09 stays inside its real ring sphere while skirting the overlapping portal and tube', () => {
    const target = buildRouteFromParcours(map.parcours, { positionScale: 3 }).checkpoints.find(c => c.id === 'CP09');
    const portalEndpoints = map.portals.flatMap(pair => [pair.a, pair.b].map(p => ({ x: p[0] * 3, y: p[1] * 3, z: p[2] * 3 })));
    const input = { mapKey: 'frozen_helix', checkpointId: 'CP09', target, playerRadius: 1.2, portalEndpoints, portalClearance: 6.2 };
    const browserOverride = new Function(`return (${resolveK19CheckpointEntryOverride.toString()});`)();
    const entry = browserOverride(input);
    assert.deepEqual(entry, resolveK19CheckpointEntryOverride(input), 'browser executes the same geometry guards');
    assert.equal(entry.accepted, true);
    assert.deepEqual(entry.position, K19_FROZEN_CP09_ENTRY_POSITION);
    assert.ok(entry.checkpointDistance < entry.contactRadius);
    assert.ok(entry.nearestPortalDistance > entry.portalClearance);
    const clear = createK19ShipProbeSweep(map);
    const start = new THREE.Vector3(15.523293411644843, 94.14117938646693, 40.00563807559937);
    const finish = new THREE.Vector3(entry.position.x, entry.position.y, entry.position.z);
    const center = new THREE.Vector3(...target.pos);
    const oldRadialEntry = center.clone().addScaledVector(start.clone().sub(center).normalize(), target.radius + input.playerRadius - 0.6);
    assert.equal(clear(start, oldRadialEntry), false, 'the prior radial entry hits the tube wall');
    const route = [start, finish];
    for (let index = 1; index < route.length; index++) {
        assert.equal(clear(route[index - 1], route[index]), true, 'actual ship probes clear the directly flown leg');
        const line = new THREE.Line3(route[index - 1], route[index]);
        for (const p of portalEndpoints) {
            const center = new THREE.Vector3(p.x, p.y, p.z);
            assert.ok(line.closestPointToPoint(center, true, new THREE.Vector3()).distanceTo(center) > input.portalClearance);
        }
    }
    assert.equal(browserOverride({ ...input, target: { ...target, radius: 1 } }).accepted, false, 'no enlarged trigger for a stale route');
    assert.equal(browserOverride({ ...input, portalEndpoints: [entry.position] }).accepted, false, 'portal contact is still forbidden');
    assert.equal(browserOverride({ ...input, checkpointId: 'CP08' }), null, 'the override belongs only to the authored CP09');
});

test('Frozen K19 clears the tube-mouth rings and leaves ordinary and existing portal-chain routes intact', () => {
    assert.strictEqual(resolveParcoursForPortalChain(map), map.parcours);
    assert.strictEqual(resolveParcoursForPortalChain(map, chainConfig('five_portals')), map.parcours);
    const variant = resolveParcoursForPortalChain(map, chainConfig('portal_chain_k19'));
    assert.deepEqual(variant.checkpoints.find(c => c.id === 'CP03').pos, [-35, 80, 0]);
    assert.deepEqual(variant.checkpoints.find(c => c.id === 'CP04').pos, [-20, 75, 30]);
    assert.deepEqual(map.parcours.checkpoints.find(c => c.id === 'CP03').pos, [-35, 73, 0]);
    assert.deepEqual(variant.checkpoints.filter(c => !['CP03', 'CP04'].includes(c.id)),
        map.parcours.checkpoints.filter(c => !['CP03', 'CP04'].includes(c.id)));
    assert.strictEqual(variant.rules, map.parcours.rules);
    assert.strictEqual(variant.finish, map.parcours.finish);
});

for (const checkpointId of ['CP03', 'CP04']) test(`the complete K19 ${checkpointId} crossing disc clears compiled tube and platform collision`, () => {
    const collision = compileArenaCollision(map, 3);
    const variant = resolveParcoursForPortalChain(map, chainConfig('portal_chain_k19'));
    const checkpoint = buildRouteFromParcours(variant, { positionScale: 3 }).checkpoints.find(c => c.id === checkpointId);
    const original = buildRouteFromParcours(map.parcours, { positionScale: 3 }).checkpoints.find(c => c.id === checkpointId);
    const normal = checkpoint.forward;
    const up = [-normal[0] * normal[1], 1 - normal[1] ** 2, -normal[1] * normal[2]];
    const length = Math.hypot(...up);
    for (let i = 0; i < 3; i++) up[i] /= length;
    const side = [normal[1] * up[2] - normal[2] * up[1],
        normal[2] * up[0] - normal[0] * up[2], normal[0] * up[1] - normal[1] * up[0]];
    let originalBlocked = 0;
    for (let radius = 0; radius <= checkpoint.radius; radius += 0.5) {
        for (let sample = 0; sample < 128; sample++) {
            const angle = sample * Math.PI * 2 / 128;
            const offset = up.map((value, axis) => radius * (value * Math.cos(angle) + side[axis] * Math.sin(angle)));
            const point = { x: checkpoint.pos[0] + offset[0], y: checkpoint.pos[1] + offset[1], z: checkpoint.pos[2] + offset[2] };
            assert.equal(collision.checkCollisionFast(point, 1.2), false, 'ring disc plus native pilot radius must be outside compiled collision');
            if (collision.checkCollisionFast({ ...point, y: original.pos[1] + offset[1] }, 1.2)) originalBlocked++;
        }
    }
    assert.ok(originalBlocked > 0, 'the unchanged authored ring is the negative control for the actual tube/platform conflict');
    assert.equal(checkpoint.radius, original.radius, 'the ring trigger is never enlarged');
    assert.deepEqual(checkpoint.forward, original.forward);
});

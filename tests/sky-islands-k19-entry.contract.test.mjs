import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SKY_ISLANDS_MAP } from '../src/core/config/maps/presets/sky_islands.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { createK19ShipProbeSweep } from './helpers/k19-ship-probe.mjs';
import { K19_SKY_CP07_ENTRY_POSITION, resolveK19CheckpointEntryOverride } from './helpers/k19-waypoint-transition.mjs';

test('Sky CP07 enters its real ring above both nearby portals with the complete ship', () => {
    const map = SKY_ISLANDS_MAP.sky_islands;
    const route = buildRouteFromParcours(map.parcours, { positionScale: 3 });
    const target = route.checkpoints.find(c => c.id === 'CP07');
    const start = new THREE.Vector3(...route.checkpoints.find(c => c.id === 'CP06').pos);
    const loggedShortcutPortal = { x: 212.18654926784848, y: 221.5, z: 43.212024050615845 };
    const portalEndpoints = [
        ...map.portals.flatMap(pair => [pair.a, pair.b].map(p => ({ x: p[0] * 3, y: p[1] * 3, z: p[2] * 3 }))),
        loggedShortcutPortal,
    ];
    const input = { mapKey: 'sky_islands', checkpointId: 'CP07', target, playerRadius: 1.2, portalEndpoints, portalClearance: 6.2 };
    const browserOverride = new Function(`return (${resolveK19CheckpointEntryOverride.toString()});`)();
    const entry = browserOverride(input);
    assert.equal(entry.accepted, true);
    assert.deepEqual(entry, resolveK19CheckpointEntryOverride(input));
    assert.deepEqual(entry.position, K19_SKY_CP07_ENTRY_POSITION);
    assert.equal(entry.checkpointDistance, 15);
    assert.ok(entry.checkpointDistance < entry.contactRadius);
    assert.equal(route.rules.bidirectionalCheckpoints, true);

    const center = new THREE.Vector3(...target.pos);
    const oldRadialEntry = center.clone().addScaledVector(start.clone().sub(center).normalize(), entry.contactRadius - 0.6);
    assert.ok(oldRadialEntry.distanceTo(new THREE.Vector3(loggedShortcutPortal.x, loggedShortcutPortal.y, loggedShortcutPortal.z)) < input.portalClearance,
        'the old radial choice is unsafe around the second portal');
    const finish = new THREE.Vector3(entry.position.x, entry.position.y, entry.position.z);
    const clear = createK19ShipProbeSweep(map);
    assert.equal(clear(start, finish), true);
    assert.equal(clear(start, start), false, 'a degenerate route is never accepted as geometry evidence');
    assert.equal(clear(start, new THREE.Vector3(NaN, 0, 0)), false, 'non-finite routes fail closed');
    const line = new THREE.Line3(start, finish);
    for (const p of portalEndpoints) {
        const portal = new THREE.Vector3(p.x, p.y, p.z);
        assert.ok(line.closestPointToPoint(portal, true, new THREE.Vector3()).distanceTo(portal) > input.portalClearance);
    }
    assert.equal(browserOverride({ ...input, target: { ...target, radius: 1 } }).accepted, false);
    assert.equal(browserOverride({ ...input, portalEndpoints: [entry.position] }).accepted, false);
    assert.equal(browserOverride({ ...input, checkpointId: 'CP08' }), null);
});

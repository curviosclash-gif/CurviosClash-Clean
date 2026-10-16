import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CHRONO_SPILLWAY_MAP } from '../src/core/config/maps/presets/parcours_pack_v130_chrono_spillway.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { K19_CHRONO_CHECKPOINT_WAYPOINTS, maximumOrientationDeviationEnvelope } from './helpers/k19-waypoint-transition.mjs';
import { createK19ShipProbeSweep } from './helpers/k19-ship-probe.mjs';
import { getVehicleModularConfig } from '../src/entities/vehicle-registry.js';
import { ARCADE_PART_SIZE_GROUPS } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeWallHitboxScale } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';

const map = CHRONO_SPILLWAY_MAP;
const route = buildRouteFromParcours(map.parcours, { positionScale: 3 });
const asVector = p => new THREE.Vector3(p.x, p.y, p.z);
const cases = [
    { id: 'CP05', start: [-139.75692899258064, 170.10720067506318, 95.67592478920888] },
    { id: 'CP09', start: [216.1143660772056, 93.50830016740579, -98.3609584542074] },
    { id: 'CP10', start: [306.19872342552486, 81.62042319237247, -63.522678639354226] },
    { id: 'CP11', start: [366, 72, 54] },
    { id: 'CP12', start: [396, 60, 126] },
];

for (const { id, start: coordinates } of cases) test(`Chrono ${id} clears the actual ship and authored geometry with unchanged gates`, () => {
    const clear = createK19ShipProbeSweep(map);
    const start = new THREE.Vector3(...coordinates);
    const finish = new THREE.Vector3(...route.checkpoints.find(c => c.id === id).pos);
    assert.equal(clear(start, finish), false, 'the old diagonal line is a real collision negative control');
    const points = [start, ...K19_CHRONO_CHECKPOINT_WAYPOINTS[id].map(asVector), finish];
    let length = 0;
    for (let index = 1; index < points.length; index++) {
        const from = points[index - 1], to = points[index];
        assert.equal(clear(from, to), true, 'all actual ship5 wall probes clear the complete leg');
        length += from.distanceTo(to);
        const line = new THREE.Line3(from, to);
        for (const portal of map.portals.flatMap(pair => [pair.a, pair.b])) {
            const center = new THREE.Vector3(...portal).multiplyScalar(3);
            assert.ok(line.closestPointToPoint(center, true, new THREE.Vector3()).distanceTo(center) > 6.2);
        }
        if (id === 'CP05') assert.ok(to.x > from.x, 'leave east through the tunnel instead of crossing the old westward trail');
    }
    assert.equal(route.rules.maxSegmentTimeMs, 17000);
    assert.ok(length / 16 < 17, 'the unboosted polyline fits the authored segment deadline');
});

test('Chrono CP10 keeps the continuous departure envelope clear from its measured native start', () => {
    const clear = createK19ShipProbeSweep(map);
    const start = new THREE.Vector3(...cases.find(entry => entry.id === 'CP10').start);
    const target = new THREE.Vector3(366, 72, 54);
    const groups = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map(group => [group, 100]));
    const shape = buildArcadeHitboxShape(getVehicleModularConfig('ship5').parts, groups, {
        originScale: resolveArcadeWallHitboxScale('ship5'),
    });
    const departure = waypoint => {
        const direction = waypoint.clone().sub(start).normalize();
        const switchPoint = waypoint.clone().addScaledVector(direction, -2.4);
        const turnEnd = switchPoint.clone().addScaledVector(direction, 7.068);
        const midpoint = switchPoint.clone().lerp(turnEnd, 0.5);
        const rotationEnvelope = maximumOrientationDeviationEnvelope(shape.boundRadius, switchPoint, turnEnd, target);
        assert.ok(Number.isFinite(rotationEnvelope), 'reject the +Z quaternion singularity');
        assert.equal(clear(start, turnEnd), true);
        assert.equal(clear(switchPoint, turnEnd, { orientationTarget: target }), true);
        return clear(midpoint, target, { envelopeRadius: 7.068 / 2 + rotationEnvelope });
    };
    assert.equal(departure(new THREE.Vector3(363, 72, 0)), false, 'previous straight-leg-only candidate clips the conservative departure hull');
    assert.equal(departure(asVector(K19_CHRONO_CHECKPOINT_WAYPOINTS.CP10[0])), true);
    assert.equal(clear(start, target, { envelopeRadius: NaN }), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MapSandstormSystem } from '../src/entities/systems/MapSandstormSystem.js';
import { normalizeMapSandstorm } from '../src/shared/contracts/MapSandstormContract.js';

const CANYON = MAP_PRESET_CATALOG.clockwork_canyon;
const MAP_SCALE = 3;

// Box maps are authored in geometry units that the arena scales by ARENA.MAP_SCALE whether or not
// they scale their spawn anchors, so their shelter volumes live in that same space.
function isInsideObstacle(point, obstacle) {
    if (obstacle.shape === 'tube') {
        const start = new THREE.Vector3(...obstacle.start);
        const end = new THREE.Vector3(...obstacle.end);
        const closest = new THREE.Line3(start, end).closestPointToPoint(point, true, new THREE.Vector3());
        return closest.distanceTo(point) < obstacle.radius;
    }
    const [x, y, z] = obstacle.pos;
    const [sx, sy, sz] = obstacle.size;
    return Math.abs(point.x - x) < sx / 2 && Math.abs(point.y - y) < sy / 2 && Math.abs(point.z - z) < sz / 2;
}

function hasRoof(point) {
    return CANYON.obstacles.some((obstacle) => {
        if (obstacle.shape === 'tube') return false;
        const [x, y, z] = obstacle.pos;
        const [sx, sy, sz] = obstacle.size;
        return Math.abs(point.x - x) < sx / 2 && Math.abs(point.z - z) < sz / 2 && y - sy / 2 > point.y;
    });
}

function samples(volume, steps = 5) {
    const out = [];
    const f = (i) => (i + 0.5) / steps;
    for (let ix = 0; ix < steps; ix += 1) {
        for (let iy = 0; iy < steps; iy += 1) {
            for (let iz = 0; iz < steps; iz += 1) {
                out.push(new THREE.Vector3(
                    volume.min[0] + (volume.max[0] - volume.min[0]) * f(ix),
                    volume.min[1] + (volume.max[1] - volume.min[1]) * f(iy),
                    volume.min[2] + (volume.max[2] - volume.min[2]) * f(iz),
                ));
            }
        }
    }
    return out;
}

test('shelters follow the arena geometry scale even on maps that keep their anchors unscaled', () => {
    const owner = {
        ARENA: { MAP_SCALE },
        players: [],
        arena: {
            currentMapDefinition: {
                size: [150, 70, 150],
                sandstorm: { enabled: true, shelterVolumes: [{ id: 'nook', min: [10, 0, 10], max: [20, 10, 20] }] },
            },
            raycast: () => ({ hit: false }),
        },
        renderer: { cameras: [], addToScene() {}, removeFromScene() {} },
    };
    const system = new MapSandstormSystem(owner);
    system.startRound();
    assert.equal(system.isSheltered(new THREE.Vector3(45, 15, 45)), true, 'the nook the arena built at 3x');
    assert.equal(system.isSheltered(new THREE.Vector3(15, 5, 15)), false, 'not the unscaled spot');
});

test('the desert canyon has a sandstorm with roofed rock nooks to shelter in', () => {
    const storm = normalizeMapSandstorm(CANYON.sandstorm);
    assert.ok(storm, 'Clockwork Canyon has a sandstorm');
    assert.equal(storm.activeSeconds - storm.ingressSeconds - storm.egressSeconds, 30, 'same 30 s peak as the pyramid');
    assert.ok(storm.shelterVolumes.length >= 4, 'one nook per canyon side at least');
    for (const volume of storm.shelterVolumes) {
        const points = samples(volume);
        const open = points.filter((point) => !CANYON.obstacles.some((obstacle) => isInsideObstacle(point, obstacle)));
        assert.ok(open.length >= points.length * 0.8, `${volume.id}: only ${open.length}/${points.length} open`);
        assert.ok(open.every(hasRoof), `${volume.id}: every open point has rock above it`);
    }
    for (const portal of CANYON.portals) {
        for (const end of [portal.a, portal.b]) {
            assert.ok(!storm.shelterVolumes.some((volume) => end.every((value, axis) => value >= volume.min[axis]
                && value <= volume.max[axis])), `portal ${end} stays outside the nooks`);
        }
    }
});

test('both sandstorm maps share one ambience profile kind and one shelter list with their storm', () => {
    const pyramid = MAP_PRESET_CATALOG.pyramid;
    assert.equal(CANYON.audioProfile.id, pyramid.audioProfile.id, 'the storm ambience is not tied to one map');
    assert.equal(CANYON.audioProfile.shelterVolumes, CANYON.sandstorm.shelterVolumes);
    assert.equal(pyramid.audioProfile.shelterVolumes, pyramid.sandstorm.shelterVolumes);
    assert.equal(CANYON.audioProfile.warningSeconds, CANYON.sandstorm.warningSeconds);
});

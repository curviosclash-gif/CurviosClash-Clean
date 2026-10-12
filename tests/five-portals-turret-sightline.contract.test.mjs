import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { PARCOURS_PACK_V130_MAPS } from '../src/core/config/maps/presets/parcours_pack_v130.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { ArenaGeometryCompilePipeline } from '../src/entities/arena/ArenaGeometryCompilePipeline.js';

const MAP = PARCOURS_PACK_V130_MAPS.glass_serpent;
const MAP_SCALE = MAP.scaleAuthoredAnchors ? CONFIG_SECTIONS.ARENA.MAP_SCALE : 1;

function buildGlassSerpentCollision() {
    const [width, height, depth] = MAP.size.map((size) => size * MAP_SCALE);
    const arena = {
        bounds: {
            minX: -width / 2, maxX: width / 2,
            minY: 0, maxY: height,
            minZ: -depth / 2, maxZ: depth / 2,
        },
        openFaces: [],
        obstacles: [],
        _pendingObstacleGeos: [],
        _pendingFoamGeos: [],
        _pendingObstacleEdgeGeos: [],
        _pendingFoamEdgeGeos: [],
    };
    new ArenaGeometryCompilePipeline(arena).compileObstacleStage({
        obstacleDefs: MAP.obstacles,
        scale: MAP_SCALE,
    });
    return { arena, collision: new ArenaCollision(arena) };
}

function scalePoint(point) {
    return new Vector3(...point).multiplyScalar(MAP_SCALE);
}

function hasClearSight(collision, start, end) {
    const distance = start.distanceTo(end);
    const steps = Math.ceil(distance / 0.5);
    const sample = new Vector3();
    for (let step = 1; step < steps; step += 1) {
        sample.lerpVectors(start, end, step / steps);
        if (collision.checkCollisionFast(sample, 0.18)) return false;
    }
    return true;
}

test('glass serpent balcony turret protects the playable tube branch and still covers the balcony', () => {
    const { collision } = buildGlassSerpentCollision();
    const turretDefinition = MAP.staticTurrets.find((entry) => entry.id === 'gs_rocket_balcony');
    const turret = scalePoint(turretDefinition.pos);
    const range = turretDefinition.range * MAP_SCALE;
    const tubeCheckpoint = MAP.parcours.checkpoints.find((entry) => entry.id === 'CP07_TUBE');
    const branchEntry = MAP.parcours.checkpoints.find((entry) => entry.id === 'CP06');
    const balconyCheckpoint = MAP.parcours.checkpoints.find((entry) => entry.id === 'CP07_BALCONY');
    const tubeCenter = scalePoint(tubeCheckpoint.pos);
    const tubeUpperRoutePoint = tubeCenter.clone().add(new Vector3(0, 9, 0));
    const lastTubeRoutePoint = scalePoint(branchEntry.pos).lerp(tubeCenter, 0.95);
    const balconyCenter = scalePoint(balconyCheckpoint.pos);
    const exit = scalePoint(MAP.fivePortalsExit.pos);
    const routePoints = [tubeCenter, tubeUpperRoutePoint, lastTubeRoutePoint];

    assert.equal(MAP_SCALE, 3, 'these authored anchors use the configured desktop map scale');
    assert.ok(!collision.checkCollisionFast(turret, 0.18), 'the turret starts in free space');
    for (const point of routePoints) {
        assert.ok(!collision.checkCollisionFast(point, 0.8), 'the route sample is flyable');
        assert.ok(
            point.distanceTo(tubeCenter) <= tubeCheckpoint.radius * MAP_SCALE,
            'the elevated route sample remains inside CP07_TUBE in world units'
        );
        assert.ok(
            !hasClearSight(collision, turret, point),
            'the relocated turret must not shoot through the playable tunnel mouth'
        );
    }

    assert.ok(!collision.checkCollisionFast(balconyCenter, 0.8), 'the balcony checkpoint stays playable');
    assert.ok(turret.distanceTo(balconyCenter) <= range, 'the balcony remains in rocket range');
    assert.ok(hasClearSight(collision, turret, balconyCenter), 'the balcony remains visible');
    assert.ok(turret.distanceTo(exit) > range, 'the turret still cannot cover the course exit');

    const previousTurret = scalePoint([76, 47, 24]);
    assert.ok(
        routePoints.every((point) => hasClearSight(collision, previousTurret, point)),
        'the previous high anchor exposes the actual tube route to rocket fire'
    );
});

import * as THREE from 'three';
import { getVehicleModularConfig } from '../../src/entities/vehicle-registry.js';
import { ARCADE_PART_SIZE_GROUPS } from '../../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeWallHitboxScale } from '../../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { buildArcadeHitboxShape } from '../../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { compileArenaCollision } from './parcours-race-line.mjs';

// Real K19 ship5 wall probes, authored collision at runtime scale, and the Player's exact facing.
export function createK19ShipProbeSweep(map) {
    const collision = compileArenaCollision(map, 3);
    const groups = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map(group => [group, 100]));
    const shape = buildArcadeHitboxShape(getVehicleModularConfig('ship5').parts, groups, {
        originScale: resolveArcadeWallHitboxScale('ship5'),
    });
    const forward = new THREE.Vector3(0, 0, -1);
    const point = new THREE.Vector3(), probe = new THREE.Vector3();
    return (from, to, { envelopeRadius = 0, orientationTarget = null } = {}) => {
        const distance = from.distanceTo(to);
        if (!Number.isFinite(distance) || distance <= 0
            || !Number.isFinite(envelopeRadius) || envelopeRadius < 0
            || (orientationTarget && ![orientationTarget.x, orientationTarget.y, orientationTarget.z].every(Number.isFinite))) return false;
        const rotation = new THREE.Quaternion().setFromUnitVectors(forward, to.clone().sub(from).normalize());
        const steps = Math.ceil(distance / 0.5);
        for (let step = 0; step <= steps; step++) {
            point.lerpVectors(from, to, step / steps);
            if (orientationTarget) {
                const direction = orientationTarget.clone().sub(point);
                if (direction.lengthSq() <= 1e-20) return false;
                rotation.setFromUnitVectors(forward, direction.normalize());
            }
            for (let offset = 0; offset < shape.probes.length; offset += 4) {
                probe.set(shape.probes[offset], shape.probes[offset + 1], shape.probes[offset + 2]).applyQuaternion(rotation).add(point);
                if (collision.checkCollisionFast(probe, shape.probes[offset + 3] + envelopeRadius)) return false;
            }
        }
        return true;
    };
}

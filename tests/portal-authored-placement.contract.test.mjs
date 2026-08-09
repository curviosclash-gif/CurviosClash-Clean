import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { resolvePortalPosition } from '../src/entities/arena/PortalPlacementOps.js';

const PORTAL_CONFIG = { RADIUS: 4.0, RING_SIZE: 4.0 };

// Nachgestellt aus der Messung auf chrono_spillway und wind_cathedral: der autorierte Punkt
// steckt in Geometrie, ein freier Platz liegt dicht daneben, aber auf anderer Hoehe.
function createArenaWithFreeSpotAt(freeSpots, { horizontalTolerance = 0.75 } = {}) {
    const checkedPositions = [];
    return {
        checkedPositions,
        bounds: { minX: -400, maxX: 400, minY: 0, maxY: 285, minZ: -400, maxZ: 400 },
        checkCollision(position) {
            checkedPositions.push({ x: position.x, y: position.y, z: position.z });
            return !freeSpots.some((spot) => (
                Math.abs(position.x - spot.x) <= horizontalTolerance
                && Math.abs(position.z - spot.z) <= horizontalTolerance
                && Math.abs(position.y - spot.y) <= 0.75
            ));
        },
    };
}

test('an authored portal blocked by geometry is placed on a nearby height', () => {
    const authored = new THREE.Vector3(300, 84, -48);
    // Freier Platz: 2.5 Einheiten seitlich, 12 Einheiten hoeher.
    const arena = createArenaWithFreeSpotAt([{ x: 300 + 2.5, y: 84 + 12, z: -48 }], { horizontalTolerance: 2.6 });

    const resolved = resolvePortalPosition(authored, 29, arena, PORTAL_CONFIG, {
        verticalOffsets: [0, 2.5, -2.5, 5, -5, 8, -8, 12, -12],
    });

    assert.ok(resolved, 'a free spot 12 units above the authored point must be found');
    assert.ok(
        Math.abs(resolved.y - (84 + 12)) <= 0.75,
        `expected the resolved portal near y=96, got y=${resolved?.y}`,
    );
    assert.ok(
        Math.hypot(resolved.x - authored.x, resolved.z - authored.z) <= 6,
        'the portal stays horizontally close to the authored position',
    );
});

test('the authored position itself still wins when it is free', () => {
    const authored = new THREE.Vector3(10, 20, 30);
    const arena = createArenaWithFreeSpotAt([{ x: 10, y: 20, z: 30 }]);

    const resolved = resolvePortalPosition(authored, 11, arena, PORTAL_CONFIG, {
        verticalOffsets: [0, 2.5, -2.5],
    });

    assert.equal(resolved, authored);
    assert.equal(arena.checkedPositions.length, 1, 'a free authored spot costs exactly one collision check');
});

test('vertical probing stays opt-in so dynamic placement is unchanged', () => {
    const authored = new THREE.Vector3(300, 84, -48);
    const arena = createArenaWithFreeSpotAt([{ x: 300 + 2.5, y: 84 + 12, z: -48 }], { horizontalTolerance: 2.6 });

    // Ohne die Option verhaelt sich die Suche wie bisher und findet den Platz nicht.
    assert.equal(resolvePortalPosition(authored, 29, arena, PORTAL_CONFIG), null);
    assert.ok(
        arena.checkedPositions.every((position) => position.y === 84),
        'the default search must not vary the height',
    );
});

test('an endpoint with no free space anywhere is still reported as unplaceable', () => {
    const authored = new THREE.Vector3(0, 50, 0);
    const arena = createArenaWithFreeSpotAt([]);

    const resolved = resolvePortalPosition(authored, 7, arena, PORTAL_CONFIG, {
        verticalOffsets: [0, 2.5, -2.5, 5, -5, 8, -8, 12, -12],
    });

    assert.equal(resolved, null);
});

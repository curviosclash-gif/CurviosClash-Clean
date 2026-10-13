import * as THREE from 'three';

/**
 * Random free spots inside the arena bounds. Up to 50 draws look for a spot without a collision
 * (radius 3); after that the last draw is returned unchecked, as before this left Arena.js.
 */

function drawX(bounds, margin, random) {
    return bounds.minX + margin + random() * (bounds.maxX - bounds.minX - 2 * margin);
}

function drawZ(bounds, margin, random) {
    return bounds.minZ + margin + random() * (bounds.maxZ - bounds.minZ - 2 * margin);
}

export function getRandomArenaPosition(arena, margin, random) {
    const b = arena.bounds;
    for (let attempts = 0; attempts < 50; attempts++) {
        const x = drawX(b, margin, random);
        const y = 3 + random() * (b.maxY - 6);
        const z = drawZ(b, margin, random);
        const pos = new THREE.Vector3(x, y, z);
        if (!arena.checkCollision(pos, 3)) return pos;
    }
    const x = drawX(b, margin, random);
    const y = 3 + random() * (b.maxY - 6);
    const z = drawZ(b, margin, random);
    return new THREE.Vector3(x, y, z);
}

export function getRandomArenaPositionOnLevel(arena, level, margin, random) {
    const b = arena.bounds;
    const y = Number.isFinite(level) ? level : (b.minY + b.maxY) * 0.5;
    for (let attempts = 0; attempts < 50; attempts++) {
        const x = drawX(b, margin, random);
        const z = drawZ(b, margin, random);
        const pos = new THREE.Vector3(x, y, z);
        if (!arena.checkCollision(pos, 3)) return pos;
    }
    const x = drawX(b, margin, random);
    const z = drawZ(b, margin, random);
    return new THREE.Vector3(x, y, z);
}

import * as THREE from 'three';

const EXTRA_PORTAL_SLOTS_3D = Object.freeze([
    Object.freeze([-0.62, 0.3, -0.28]), Object.freeze([0.62, 0.3, 0.28]),
    Object.freeze([0.28, 0.46, -0.62]), Object.freeze([-0.28, 0.46, 0.62]),
    Object.freeze([-0.62, 0.68, 0.48]), Object.freeze([0.62, 0.68, -0.48]),
    Object.freeze([-0.18, 0.82, 0.68]), Object.freeze([0.18, 0.82, -0.68]),
]);

export function getMapPortalSlots3D(currentMapKey) {
    const layouts = {
        standard: [
            [-0.75, 0.18, -0.75], [0.75, 0.18, 0.75], [0.75, 0.35, -0.75], [-0.75, 0.35, 0.75],
            [-0.2, 0.52, -0.82], [0.2, 0.52, 0.82], [-0.82, 0.62, 0.2], [0.82, 0.62, -0.2],
            [0, 0.26, -0.35], [0, 0.58, 0.35], [-0.45, 0.72, 0], [0.45, 0.72, 0],
        ],
        empty: [
            [-0.78, 0.2, -0.78], [0.78, 0.2, 0.78], [0.78, 0.2, -0.78], [-0.78, 0.2, 0.78],
            [0, 0.45, -0.82], [0, 0.45, 0.82], [-0.82, 0.45, 0], [0.82, 0.45, 0],
            [-0.35, 0.72, -0.35], [0.35, 0.72, 0.35], [0.35, 0.72, -0.35], [-0.35, 0.72, 0.35],
        ],
        maze: [
            [-0.8, 0.22, -0.6], [0.8, 0.22, 0.6], [-0.8, 0.22, 0.6], [0.8, 0.22, -0.6],
            [-0.25, 0.5, -0.8], [0.25, 0.5, 0.8], [-0.6, 0.62, 0], [0.6, 0.62, 0],
            [0, 0.35, -0.2], [0, 0.35, 0.2], [-0.4, 0.75, -0.35], [0.4, 0.75, 0.35],
        ],
        complex: [
            [-0.82, 0.2, -0.82], [0.82, 0.2, 0.82], [0.82, 0.2, -0.82], [-0.82, 0.2, 0.82],
            [-0.5, 0.42, -0.1], [0.5, 0.42, 0.1], [-0.1, 0.55, 0.5], [0.1, 0.55, -0.5],
            [0, 0.72, -0.72], [0, 0.72, 0.72], [-0.72, 0.72, 0], [0.72, 0.72, 0],
        ],
        pyramid: [
            [-0.78, 0.18, -0.78], [0.78, 0.18, 0.78], [0.78, 0.18, -0.78], [-0.78, 0.18, 0.78],
            [-0.45, 0.38, -0.45], [0.45, 0.38, 0.45], [0, 0.58, -0.78], [0, 0.58, 0.78],
            [-0.78, 0.58, 0], [0.78, 0.58, 0], [-0.2, 0.78, 0], [0.2, 0.78, 0],
        ],
    };
    return (layouts[currentMapKey] || layouts.standard).concat(EXTRA_PORTAL_SLOTS_3D);
}

export function getMapPlanarAnchors(currentMapKey) {
    const anchors = {
        standard: [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [0, -0.45], [0, 0.45], [-0.45, 0], [0.45, 0]],
        empty: [[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75], [0, -0.55], [0, 0.55], [-0.55, 0], [0.55, 0]],
        maze: [[-0.78, -0.62], [0.78, -0.62], [0.78, 0.62], [-0.78, 0.62], [0, -0.72], [0, 0.72], [-0.52, 0], [0.52, 0]],
        complex: [[-0.82, -0.82], [0.82, -0.82], [0.82, 0.82], [-0.82, 0.82], [-0.55, 0], [0.55, 0], [0, -0.55], [0, 0.55]],
        pyramid: [[-0.78, -0.78], [0.78, -0.78], [0.78, 0.78], [-0.78, 0.78], [-0.48, 0], [0.48, 0], [0, -0.48], [0, 0.48]],
    };
    return anchors[currentMapKey] || anchors.standard;
}

export function resolvePlanarLevels(portalLevels, requestedLevelCount, bounds, mapScale = 1) {
    const levelCount = Math.max(2, Math.round(Number(requestedLevelCount) || 5));
    const minY = Number(bounds?.minY) || 0;
    const maxY = Number(bounds?.maxY) || 0;
    const height = maxY - minY;
    if (height <= 0) return [minY + 3];

    const scale = Number(mapScale) > 0 ? Number(mapScale) : 1;
    const authoredLevels = [...new Set(
        (Array.isArray(portalLevels) ? portalLevels : [])
            .map((y) => Number(y) * scale)
            .filter(Number.isFinite)
    )].sort((a, b) => a - b);
    const rangeMin = authoredLevels.length >= 2 ? authoredLevels[0] : minY;
    const rangeMax = authoredLevels.length >= 2 ? authoredLevels[authoredLevels.length - 1] : maxY;
    if (authoredLevels.length === levelCount) return authoredLevels;

    const step = (rangeMax - rangeMin) / (authoredLevels.length >= 2 ? levelCount - 1 : levelCount);
    return Array.from({ length: levelCount }, (_, index) => (
        rangeMin + step * index + (authoredLevels.length >= 2 ? 0 : step * 0.5)
    ));
}

export function resolvePlanarTransitionOrder(levels, bounds) {
    const transitionCount = Math.max(0, (Array.isArray(levels) ? levels.length : 0) - 1);
    const arenaMidY = ((Number(bounds?.minY) || 0) + (Number(bounds?.maxY) || 0)) * 0.5;
    let spawnLevelIndex = 0;
    let spawnLevelDistance = Infinity;
    for (let i = 0; i < levels.length; i++) {
        const distance = Math.abs(levels[i] - arenaMidY);
        if (distance >= spawnLevelDistance) continue;
        spawnLevelIndex = i;
        spawnLevelDistance = distance;
    }
    const distanceFromSpawn = (band) => Math.min(
        Math.abs(band - spawnLevelIndex),
        Math.abs(band + 1 - spawnLevelIndex)
    );
    return Array.from({ length: transitionCount }, (_, index) => index)
        .sort((left, right) => distanceFromSpawn(left) - distanceFromSpawn(right) || left - right);
}

export function portalPositionFromSlot(slot, seed, arena, portalConfig) {
    const b = arena.bounds;
    const margin = portalConfig.RING_SIZE + 2.5;
    const nx = (slot[0] + 1) * 0.5;
    const ny = slot[1];
    const nz = (slot[2] + 1) * 0.5;
    const pos = new THREE.Vector3(
        b.minX + margin + nx * (b.maxX - b.minX - 2 * margin),
        b.minY + margin + ny * (b.maxY - b.minY - 2 * margin),
        b.minZ + margin + nz * (b.maxZ - b.minZ - 2 * margin)
    );
    return resolvePortalPosition(pos, seed, arena, portalConfig);
}

export function portalPositionFromXZLevel(nx, nz, levelY, seed, arena, portalConfig) {
    const b = arena.bounds;
    const margin = portalConfig.RING_SIZE + 2.5;
    const pos = new THREE.Vector3(
        b.minX + margin + (nx + 1) * 0.5 * (b.maxX - b.minX - 2 * margin),
        levelY,
        b.minZ + margin + (nz + 1) * 0.5 * (b.maxZ - b.minZ - 2 * margin)
    );
    return resolvePortalPosition(pos, seed, arena, portalConfig);
}

export function resolvePlanarElevatorPair(nx, nz, lowY, highY, seed, arena, portalConfig) {
    const b = arena.bounds;
    const margin = portalConfig.RING_SIZE + 2.5;
    const baseX = b.minX + margin + (nx + 1) * 0.5 * (b.maxX - b.minX - 2 * margin);
    const baseZ = b.minZ + margin + (nz + 1) * 0.5 * (b.maxZ - b.minZ - 2 * margin);

    const lowProbe = new THREE.Vector3();
    const highProbe = new THREE.Vector3();
    for (let i = 0; i < 28; i++) {
        const angle1 = (((seed + i * 41) % 360) * Math.PI) / 180;
        const dist1 = i === 0 ? 0 : 2.2 + (i - 1) * 1.2;
        const x1 = Math.max(b.minX + margin, Math.min(b.maxX - margin, baseX + Math.cos(angle1) * dist1));
        const z1 = Math.max(b.minZ + margin, Math.min(b.maxZ - margin, baseZ + Math.sin(angle1) * dist1));

        const angle2 = (((seed + 180 + i * 41) % 360) * Math.PI) / 180;
        const dist2 = i === 0 ? 3.0 : 2.2 + i * 1.2;
        const x2 = Math.max(b.minX + margin, Math.min(b.maxX - margin, baseX + Math.cos(angle2) * dist2));
        const z2 = Math.max(b.minZ + margin, Math.min(b.maxZ - margin, baseZ + Math.sin(angle2) * dist2));

        lowProbe.set(x1, lowY, z1);
        highProbe.set(x2, highY, z2);

        if (!arena.checkCollision(lowProbe, 2.0) && !arena.checkCollision(highProbe, 2.0)) {
            return { low: lowProbe.clone(), high: highProbe.clone() };
        }
    }
    return null;
}

const NO_VERTICAL_OFFSETS = Object.freeze([0]);

export function resolvePortalPosition(pos, seed, arena, portalConfig, options = {}) {
    const b = arena.bounds;
    const margin = portalConfig.RING_SIZE + 2.5;
    const testRadius = portalConfig.RADIUS * 0.75;
    if (!arena.checkCollision(pos, testRadius)) {
        return pos;
    }

    // Offsets are ordered nearest-first, so a rescued portal stays as close to the
    // authored spot as the geometry allows.
    const verticalOffsets = Array.isArray(options.verticalOffsets) && options.verticalOffsets.length > 0
        ? options.verticalOffsets
        : NO_VERTICAL_OFFSETS;
    const probe = new THREE.Vector3();
    for (let i = 0; i < 20; i++) {
        const angle = (((seed + i * 37) % 360) * Math.PI) / 180;
        const dist = 2.5 + i * 1.3;
        for (const verticalOffset of verticalOffsets) {
            probe.set(
                pos.x + Math.cos(angle) * dist,
                pos.y + verticalOffset,
                pos.z + Math.sin(angle) * dist
            );

            probe.x = Math.max(b.minX + margin, Math.min(b.maxX - margin, probe.x));
            probe.y = Math.max(b.minY + margin, Math.min(b.maxY - margin, probe.y));
            probe.z = Math.max(b.minZ + margin, Math.min(b.maxZ - margin, probe.z));

            if (!arena.checkCollision(probe, testRadius)) {
                return probe.clone();
            }
        }
    }

    return null;
}

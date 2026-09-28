export function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePositiveNumber(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeVector3(value, fallback = [0, 0, 0]) {
    const source = Array.isArray(value) ? value : fallback;
    return [
        normalizeNumber(source[0], fallback[0]),
        normalizeNumber(source[1], fallback[1]),
        normalizeNumber(source[2], fallback[2]),
    ];
}

export function resolveObstacleBox(obstacle) {
    if (Array.isArray(obstacle?.pos) && Array.isArray(obstacle?.size)) {
        const position = normalizeVector3(obstacle.pos);
        const size = normalizeVector3(obstacle.size, [1, 1, 1]).map((value) => Math.max(0.1, Math.abs(value)));
        return { position, size, foam: String(obstacle?.kind || '').toLowerCase() === 'foam' };
    }

    if (String(obstacle?.shape || '').toLowerCase() !== 'tube') return null;
    const start = normalizeVector3(obstacle.start);
    const end = normalizeVector3(obstacle.end);
    const radius = normalizePositiveNumber(obstacle.radius, 1);
    return {
        position: start.map((value, index) => (value + end[index]) * 0.5),
        size: start.map((value, index) => Math.max(radius * 2, Math.abs(end[index] - value) + radius * 2)),
        foam: String(obstacle?.kind || '').toLowerCase() === 'foam',
    };
}

export function collectPortalPoints(mapDefinition) {
    const points = [];
    const portals = Array.isArray(mapDefinition?.portals) ? mapDefinition.portals : [];
    portals.forEach((portal) => {
        [portal?.a, portal?.b, portal?.position, portal?.pos].forEach((position) => {
            if (Array.isArray(position) && position.length >= 3) points.push(normalizeVector3(position));
        });
    });
    return points;
}

export function collectSpawnPoints(mapDefinition) {
    const points = [];
    const append = (spawn) => {
        const position = Array.isArray(spawn) ? spawn : (spawn?.position || spawn?.pos);
        if (Array.isArray(position) && position.length >= 3) {
            points.push(normalizeVector3(position));
        } else if (spawn && typeof spawn === 'object') {
            const xyz = [Number(spawn.x), Number(spawn.y), Number(spawn.z)];
            if (xyz.every(Number.isFinite)) points.push(xyz);
        }
    };
    append(mapDefinition?.playerSpawn);
    (Array.isArray(mapDefinition?.botSpawns) ? mapDefinition.botSpawns : []).forEach(append);
    return points;
}

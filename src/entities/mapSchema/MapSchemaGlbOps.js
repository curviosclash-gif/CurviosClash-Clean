function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function vector3(value) {
    const source = Array.isArray(value) ? value : [];
    return [
        finiteNumber(source[0]),
        finiteNumber(source[1]),
        finiteNumber(source[2]),
    ];
}

export function sanitizeGLBModels(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry, index) => {
        const source = entry && typeof entry === 'object' ? entry : {};
        const url = typeof source.url === 'string' ? source.url.trim() : '';
        if (!url) return [];
        return [{
            id: String(source.id || '').trim() || `model-${index + 1}`,
            url,
            position: vector3(source.position),
            rotation: vector3(source.rotation),
            scale: positiveNumber(source.scale, 1),
            targetSize: positiveNumber(source.targetSize, 0),
        }];
    });
}

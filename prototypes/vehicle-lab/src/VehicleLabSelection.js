export function normalizeVehicleLabPartIndex(index) {
    return Number.isInteger(index) && index >= 0 ? index : null;
}

export function normalizeVehicleLabPartPath(path = []) {
    if (!Array.isArray(path)) return [];
    return path
        .map((segment) => Number(segment))
        .filter((segment) => Number.isInteger(segment) && segment >= 0);
}

export function buildVehicleLabSelectionKey(index, path = []) {
    const normalizedIndex = normalizeVehicleLabPartIndex(index);
    if (normalizedIndex === null) return '';

    const normalizedPath = normalizeVehicleLabPartPath(path);
    return normalizedPath.length > 0
        ? `${normalizedIndex}:${normalizedPath.join('.')}`
        : `${normalizedIndex}:root`;
}

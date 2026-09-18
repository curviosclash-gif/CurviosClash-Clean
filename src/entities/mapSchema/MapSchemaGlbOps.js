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

export const MAX_EMBEDDED_GLB_URL_CHARS = 512 * 1024;

/**
 * The collision mode of a GLB map that states none of its own. Only 'fallbackOnly' and 'dynamic'
 * build anything different; every other mode takes the collision straight off the drawn scene,
 * which is the mode the loading overlay already names 'Szenen-Collider'. It lives here so the
 * menu preview and the running match cannot end up naming the same collision differently.
 */
export const DEFAULT_GLB_COLLIDER_MODE = 'scene';

/**
 * @param {unknown} value collider mode as a map states it, if it states one
 * @returns {string} the stated mode, or the shared default
 */
export function resolveGLBColliderMode(value) {
    const mode = typeof value === 'string' ? value.trim() : '';
    return mode || DEFAULT_GLB_COLLIDER_MODE;
}

export function normalizeAllowedGLBUrl(value) {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url) return '';
    if (url.startsWith('data:model/gltf-binary;base64,')) {
        return url.length <= MAX_EMBEDDED_GLB_URL_CHARS ? url : '';
    }
    if (url.includes('\\') || url.includes('?') || url.includes('#')) return '';
    const normalized = url.replace(/^\.\//, '').replace(/^\//, '');
    if (normalized.includes(':')) return '';
    let segments;
    try {
        segments = normalized.split('/').map((segment) => decodeURIComponent(segment));
    } catch {
        return '';
    }
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
    return normalized.toLowerCase().endsWith('.glb') ? normalized : '';
}

export function sanitizeGLBModels(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry, index) => {
        const source = entry && typeof entry === 'object' ? entry : {};
        const url = normalizeAllowedGLBUrl(source.url);
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

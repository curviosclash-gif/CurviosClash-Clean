import * as THREE from 'three';

const PORTAL_VISUAL_TYPES = new Set([
    'portal_ring', 'portal_cross', 'portal_diamond', 'portal_hex',
    'portal_octagon', 'portal_square', 'portal_star', 'portal_triangle',
]);

export function normalizePortalVisualType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return PORTAL_VISUAL_TYPES.has(normalized) ? normalized : 'portal_ring';
}

function regularPolygon(sides, radius, rotation = Math.PI / 2) {
    return Array.from({ length: sides }, (_, index) => {
        const angle = rotation + (index / sides) * Math.PI * 2;
        return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
    });
}

function portalShapePoints(visualType, radius) {
    if (visualType === 'portal_triangle') return regularPolygon(3, radius);
    if (visualType === 'portal_square') return regularPolygon(4, radius, Math.PI / 4);
    if (visualType === 'portal_diamond') return regularPolygon(4, radius);
    if (visualType === 'portal_hex') return regularPolygon(6, radius);
    if (visualType === 'portal_octagon') return regularPolygon(8, radius);
    if (visualType === 'portal_star') {
        return Array.from({ length: 10 }, (_, index) => {
            const angle = Math.PI / 2 + (index / 10) * Math.PI * 2;
            const pointRadius = index % 2 === 0 ? radius : radius * 0.46;
            return new THREE.Vector2(Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius);
        });
    }
    return [
        [-1, -0.34], [-0.34, -0.34], [-0.34, -1], [0.34, -1],
        [0.34, -0.34], [1, -0.34], [1, 0.34], [0.34, 0.34],
        [0.34, 1], [-0.34, 1], [-0.34, 0.34], [-1, 0.34],
    ].map(([x, y]) => new THREE.Vector2(x * radius, y * radius));
}

export function createPortalShapeGeometry(visualType, radius, band = false) {
    const points = portalShapePoints(visualType, radius);
    const shape = new THREE.Shape(points);
    if (band) {
        shape.holes.push(new THREE.Path(points.map((point) => point.clone().multiplyScalar(0.78)).reverse()));
    }
    return new THREE.ShapeGeometry(shape);
}

import * as THREE from 'three';

export const PORTAL_PAIR_MARK_COUNT = 10;

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

function createBandShape(visualType, outerRadius, bandWidth) {
    const normalizedType = normalizePortalVisualType(visualType);
    const innerRadius = Math.max(outerRadius * 0.1, outerRadius - bandWidth);
    const shape = new THREE.Shape();
    if (normalizedType === 'portal_ring') {
        shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
        const hole = new THREE.Path();
        hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
        shape.holes.push(hole);
        return shape;
    }

    const outerPoints = portalShapePoints(normalizedType, outerRadius);
    const innerScale = innerRadius / outerRadius;
    shape.setFromPoints(outerPoints);
    shape.holes.push(new THREE.Path(
        outerPoints.map((point) => point.clone().multiplyScalar(innerScale)).reverse()
    ));
    return shape;
}

function createExtrudedShape(shape, depth, bevelSize) {
    const safeDepth = Math.max(0.02, depth);
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: safeDepth,
        steps: 1,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: Math.min(Math.max(0.01, bevelSize), safeDepth * 0.45),
        bevelThickness: Math.min(safeDepth * 0.24, 0.08),
        curveSegments: 32,
    });
    geometry.translate(0, 0, -safeDepth * 0.5);
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();
    return geometry;
}

export function createPortalShapeGeometry(visualType, radius, band = false) {
    const normalizedType = normalizePortalVisualType(visualType);
    if (band) {
        return new THREE.ShapeGeometry(createBandShape(normalizedType, radius, radius * 0.22));
    }
    if (normalizedType === 'portal_ring') {
        return new THREE.CircleGeometry(radius, 48);
    }
    return new THREE.ShapeGeometry(new THREE.Shape(portalShapePoints(normalizedType, radius)));
}

export function createPortalFrameGeometry(visualType, outerRadius, bandWidth, depth = 0.38) {
    return createExtrudedShape(
        createBandShape(visualType, outerRadius, bandWidth),
        depth,
        Math.min(0.075, bandWidth * 0.16)
    );
}

function createGlyphShape(markIndex, radius) {
    const index = ((Math.trunc(markIndex) % PORTAL_PAIR_MARK_COUNT) + PORTAL_PAIR_MARK_COUNT)
        % PORTAL_PAIR_MARK_COUNT;
    if (index === 0) return createBandShape('portal_ring', radius, radius * 0.34);
    if (index === 1) return new THREE.Shape(regularPolygon(3, radius));
    if (index === 2) return new THREE.Shape(regularPolygon(4, radius, Math.PI / 4));
    if (index === 3) return new THREE.Shape(regularPolygon(4, radius));
    if (index === 4) return new THREE.Shape(regularPolygon(5, radius));
    if (index === 5) return new THREE.Shape(regularPolygon(6, radius));
    if (index === 6) return new THREE.Shape(portalShapePoints('portal_cross', radius));
    if (index === 7) return new THREE.Shape(portalShapePoints('portal_star', radius));
    if (index === 8) {
        return new THREE.Shape([
            [-0.9, 0.72], [0, 0.08], [0.9, 0.72], [0.9, 0.18],
            [0, -0.48], [-0.9, 0.18],
        ].map(([x, y]) => new THREE.Vector2(x * radius, y * radius)));
    }
    return new THREE.Shape([
        [-1, 0.72], [-0.12, 0.16], [-1, -0.72], [-0.35, -0.72],
        [0, -0.22], [0.35, -0.72], [1, -0.72], [0.12, 0.16],
        [1, 0.72], [0.35, 0.72], [0, 0.22], [-0.35, 0.72],
    ].map(([x, y]) => new THREE.Vector2(x * radius, y * radius)));
}

export function createPortalPairMarkGeometry(markIndex, radius = 0.52, depth = 0.18) {
    return createExtrudedShape(createGlyphShape(markIndex, radius), depth, 0.035);
}

export function createPortalArrowGeometry(radius = 0.58, depth = 0.14) {
    const shape = new THREE.Shape([
        [-0.26, -1], [0.26, -1], [0.26, 0.12], [0.7, 0.12],
        [0, 1], [-0.7, 0.12], [-0.26, 0.12],
    ].map(([x, y]) => new THREE.Vector2(x * radius, y * radius)));
    return createExtrudedShape(shape, depth, 0.025);
}

export function createPortalCrownGeometry(radius = 0.7, depth = 0.2) {
    const shape = new THREE.Shape([
        [-1, -0.55], [-0.92, 0.55], [-0.38, 0.02], [0, 0.86],
        [0.38, 0.02], [0.92, 0.55], [1, -0.55],
    ].map(([x, y]) => new THREE.Vector2(x * radius, y * radius)));
    return createExtrudedShape(shape, depth, 0.035);
}

export function createPortalChevronGeometry(radius = 0.6, depth = 0.12) {
    const shape = new THREE.Shape([
        [-1, 0.5], [0, -0.34], [1, 0.5], [1, 0.08],
        [0, -0.78], [-1, 0.08],
    ].map(([x, y]) => new THREE.Vector2(x * radius, y * radius)));
    return createExtrudedShape(shape, depth, 0.025);
}

export function samplePortalInnerEdge(visualType, radius, count) {
    const sampleCount = Math.max(1, Math.trunc(count));
    const normalizedType = normalizePortalVisualType(visualType);
    if (normalizedType === 'portal_ring') {
        return Array.from({ length: sampleCount }, (_, index) => {
            const angle = Math.PI / 2 + (index / sampleCount) * Math.PI * 2;
            return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
        });
    }

    const points = portalShapePoints(normalizedType, radius);
    const segmentLengths = [];
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const length = points[i].distanceTo(points[(i + 1) % points.length]);
        segmentLengths.push(length);
        perimeter += length;
    }

    const samples = [];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        let distance = (sampleIndex / sampleCount) * perimeter;
        for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex++) {
            const edgeLength = segmentLengths[edgeIndex];
            if (distance <= edgeLength || edgeIndex === points.length - 1) {
                const alpha = edgeLength > 0 ? distance / edgeLength : 0;
                samples.push(points[edgeIndex].clone().lerp(points[(edgeIndex + 1) % points.length], alpha));
                break;
            }
            distance -= edgeLength;
        }
    }
    return samples;
}

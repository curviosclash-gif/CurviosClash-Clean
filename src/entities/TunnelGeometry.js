import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const EPSILON = 1e-4;
const DEFAULT_RADIAL_SEGMENTS = 48;

function asPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasFinitePositionAttribute(geometry) {
    const position = geometry?.getAttribute?.('position');
    if (!position || position.itemSize < 3 || position.count <= 0) {
        return false;
    }
    for (let i = 0; i < position.count; i++) {
        if (
            !Number.isFinite(position.getX(i))
            || !Number.isFinite(position.getY(i))
            || !Number.isFinite(position.getZ(i))
        ) {
            return false;
        }
    }
    return true;
}

function hasFiniteBounds(geometry) {
    const box = geometry?.boundingBox;
    const sphere = geometry?.boundingSphere;
    if (!box || !sphere) return false;
    return Number.isFinite(box.min.x)
        && Number.isFinite(box.min.y)
        && Number.isFinite(box.min.z)
        && Number.isFinite(box.max.x)
        && Number.isFinite(box.max.y)
        && Number.isFinite(box.max.z)
        && Number.isFinite(sphere.radius);
}

function projectAngleToRectangle(angle, halfWidth, halfHeight) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const tX = Math.abs(dirX) > EPSILON ? halfWidth / Math.abs(dirX) : Number.POSITIVE_INFINITY;
    const tY = Math.abs(dirY) > EPSILON ? halfHeight / Math.abs(dirY) : Number.POSITIVE_INFINITY;
    const distance = Math.min(tX, tY);
    return [dirX * distance, dirY * distance];
}

function createTunnelEndFace(width, height, tunnelRadius, radialSegments) {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const face = new THREE.RingGeometry(tunnelRadius, 1, radialSegments, 1);
    const position = face.getAttribute('position');
    const ringVertexCount = radialSegments + 1;

    for (let i = 0; i < ringVertexCount; i++) {
        const outerIndex = ringVertexCount + i;
        const angle = Math.atan2(position.getY(outerIndex), position.getX(outerIndex));
        const [x, y] = projectAngleToRectangle(angle, halfWidth, halfHeight);
        position.setXYZ(outerIndex, x, y, 0);
    }

    position.needsUpdate = true;
    face.computeVertexNormals();
    return face;
}

function createCanonicalBoxWithTunnel(width, height, depth, tunnelRadius, radialSegments) {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const halfDepth = depth * 0.5;
    const geometries = [];

    const frontFace = createTunnelEndFace(width, height, tunnelRadius, radialSegments);
    frontFace.translate(0, 0, halfDepth);
    geometries.push(frontFace);

    const backFace = createTunnelEndFace(width, height, tunnelRadius, radialSegments);
    backFace.rotateY(Math.PI);
    backFace.translate(0, 0, -halfDepth);
    geometries.push(backFace);

    const rightFace = new THREE.PlaneGeometry(depth, height);
    rightFace.rotateY(Math.PI * 0.5);
    rightFace.translate(halfWidth, 0, 0);
    geometries.push(rightFace);

    const leftFace = new THREE.PlaneGeometry(depth, height);
    leftFace.rotateY(-Math.PI * 0.5);
    leftFace.translate(-halfWidth, 0, 0);
    geometries.push(leftFace);

    const topFace = new THREE.PlaneGeometry(width, depth);
    topFace.rotateX(-Math.PI * 0.5);
    topFace.translate(0, halfHeight, 0);
    geometries.push(topFace);

    const bottomFace = new THREE.PlaneGeometry(width, depth);
    bottomFace.rotateX(Math.PI * 0.5);
    bottomFace.translate(0, -halfHeight, 0);
    geometries.push(bottomFace);

    const tunnelWall = new THREE.CylinderGeometry(tunnelRadius, tunnelRadius, depth, radialSegments, 1, true);
    tunnelWall.rotateX(Math.PI * 0.5);
    tunnelWall.scale(-1, 1, 1);
    tunnelWall.computeVertexNormals();
    geometries.push(tunnelWall);

    const merged = mergeGeometries(geometries, false) || new THREE.BoxGeometry(width, height, depth);
    geometries.forEach((geo) => geo.dispose());
    return merged;
}

function resolveCanonicalSetup(boxW, boxH, boxD, tunnelAxis) {
    const axis = tunnelAxis === 'x' || tunnelAxis === 'y' || tunnelAxis === 'z' ? tunnelAxis : 'z';

    if (axis === 'x') {
        return {
            axis,
            width: boxD,
            height: boxH,
            depth: boxW,
            rotateToAxis: (geometry) => geometry.rotateY(Math.PI * 0.5),
        };
    }

    if (axis === 'y') {
        return {
            axis,
            width: boxW,
            height: boxD,
            depth: boxH,
            rotateToAxis: (geometry) => geometry.rotateX(-Math.PI * 0.5),
        };
    }

    return {
        axis: 'z',
        width: boxW,
        height: boxH,
        depth: boxD,
        rotateToAxis: null,
    };
}

/**
 * Erzeugt eine Box-Geometrie mit zylindrischem Durchbruch.
 * tunnelAxis: 'x' | 'y' | 'z'
 */
export function createBoxWithTunnel(boxW, boxH, boxD, tunnelRadius, tunnelAxis = 'z') {
    const safeW = asPositiveNumber(boxW, 1);
    const safeH = asPositiveNumber(boxH, 1);
    const safeD = asPositiveNumber(boxD, 1);
    const buildFallbackGeometry = () => new THREE.BoxGeometry(safeW, safeH, safeD);

    const setup = resolveCanonicalSetup(safeW, safeH, safeD, tunnelAxis);
    const maxRadius = Math.max(EPSILON, Math.min(setup.width, setup.height) * 0.5 - EPSILON);
    const fallbackRadius = maxRadius * 0.35;
    const safeRadius = Math.min(asPositiveNumber(tunnelRadius, fallbackRadius), maxRadius);

    if (safeRadius <= EPSILON) {
        return buildFallbackGeometry();
    }

    let geometry = createCanonicalBoxWithTunnel(
        setup.width,
        setup.height,
        setup.depth,
        safeRadius,
        DEFAULT_RADIAL_SEGMENTS,
    );

    if (typeof setup.rotateToAxis === 'function') {
        setup.rotateToAxis(geometry);
    }

    if (!hasFinitePositionAttribute(geometry)) {
        geometry.dispose();
        geometry = buildFallbackGeometry();
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (!hasFiniteBounds(geometry)) {
        geometry.dispose();
        geometry = buildFallbackGeometry();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
    }
    return geometry;
}

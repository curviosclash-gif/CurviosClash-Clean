import * as THREE from 'three';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

const WARNING_COLOR = 0xff5a36;
const EDGE_INSET = 0.35;

function createGridGeometry(width, height, columns = 10, rows = 6) {
    const points = [];
    const minX = width * -0.5;
    const minY = height * -0.5;
    for (let column = 0; column <= columns; column += 1) {
        const x = minX + (width * column) / columns;
        points.push(x, minY, 0, x, minY + height, 0);
    }
    for (let row = 0; row <= rows; row += 1) {
        const y = minY + (height * row) / rows;
        points.push(minX, y, 0, minX + width, y, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
}

function createFaceMesh(face, bounds) {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const depth = bounds.maxZ - bounds.minZ;
    let geometry;
    const mesh = new THREE.LineSegments();

    if (face === 'maxY') {
        geometry = createGridGeometry(width, depth, 10, 10);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(0, bounds.maxY - EDGE_INSET, 0);
    } else if (face === 'minX' || face === 'maxX') {
        geometry = createGridGeometry(depth, height);
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set(face === 'minX' ? bounds.minX + EDGE_INSET : bounds.maxX - EDGE_INSET, height * 0.5, 0);
    } else {
        geometry = createGridGeometry(width, height);
        mesh.position.set(0, height * 0.5, face === 'minZ' ? bounds.minZ + EDGE_INSET : bounds.maxZ - EDGE_INSET);
    }

    mesh.geometry = geometry;
    mesh.material = new THREE.LineBasicMaterial({
        color: WARNING_COLOR,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    mesh.renderOrder = 2;
    mesh.userData.exclusionZoneFace = face;
    return mesh;
}

export class ExclusionBoundaryVisual {
    constructor(renderer) {
        this.renderer = renderer || null;
        this.meshes = [];
        this.elapsedSeconds = 0;
    }

    build(openFaces, bounds) {
        this.clear();
        if (!Array.isArray(openFaces) || openFaces.length === 0 || !bounds) return;
        for (const face of openFaces) {
            const mesh = createFaceMesh(face, bounds);
            this.renderer?.addToScene?.(mesh);
            this.meshes.push(mesh);
        }
    }

    update(dt) {
        if (this.meshes.length === 0) return;
        this.elapsedSeconds += Math.max(0, Number(dt) || 0);
        const opacity = 0.045 + ((Math.sin(this.elapsedSeconds * 3.2) + 1) * 0.035);
        for (const mesh of this.meshes) mesh.material.opacity = opacity;
    }

    clear() {
        for (const mesh of this.meshes) {
            this.renderer?.removeFromScene?.(mesh);
            disposeObject3DResources(mesh);
        }
        this.meshes.length = 0;
        this.elapsedSeconds = 0;
    }

    dispose() {
        this.clear();
    }
}

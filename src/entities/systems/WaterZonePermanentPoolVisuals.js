import * as THREE from 'three';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

function createWaterSurface(radius, ringCount = 8, segmentCount = 48) {
    const countPerRing = segmentCount + 1;
    const positions = new Float32Array((ringCount + 1) * countPerRing * 3);
    const radii = new Float32Array((ringCount + 1) * countPerRing);
    const angles = new Float32Array((ringCount + 1) * countPerRing);
    const indices = [];
    for (let ring = 0; ring <= ringCount; ring += 1) {
        const distance = radius * ring / ringCount;
        for (let segment = 0; segment <= segmentCount; segment += 1) {
            const index = ring * countPerRing + segment;
            const angle = Math.PI * 2 * segment / segmentCount;
            positions[index * 3] = Math.cos(angle) * distance;
            positions[index * 3 + 1] = Math.sin(angle) * distance;
            radii[index] = distance;
            angles[index] = angle;
            if (ring === 0 || segment === segmentCount) continue;
            const a = (ring - 1) * countPerRing + segment;
            const b = ring * countPerRing + segment;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return { geometry, radii, angles };
}

/** Visual lifecycle for fixed circular water pools, separate from dynamic dam waves. */
export class WaterZonePermanentPoolVisuals {
    constructor(renderer) {
        this.renderer = renderer || null;
        this.entries = [];
        this.time = 0;
    }

    build(zones) {
        this.clear();
        if (!this.renderer?.addToScene) return;
        for (const zone of zones) {
            if (zone.surfaceVisible === false) continue;
            const group = new THREE.Group();
            group.name = `water-zone-${zone.id}`;
            const material = new THREE.MeshPhysicalMaterial({
                color: 0x17668a, emissive: 0x082a3b, emissiveIntensity: 0.35,
                transparent: true, opacity: 0.68, roughness: 0.18, metalness: 0.05,
                transmission: 0.12, depthWrite: false, side: THREE.DoubleSide,
            });
            const water = createWaterSurface(zone.radius);
            const surface = new THREE.Mesh(water.geometry, material);
            surface.name = `${group.name}-surface`;
            surface.rotation.x = -Math.PI / 2;
            surface.position.set(zone.center[0], zone.surfaceLevel, zone.center[2]);
            surface.renderOrder = 4;
            group.add(surface);
            this.renderer.addToScene(group);
            this.entries.push({ group, surface, baseY: zone.surfaceLevel, water: { ...water, radius: zone.radius } });
        }
    }

    update(dt, scale) {
        this.time += Math.max(0, Number(dt) || 0);
        for (let index = 0; index < this.entries.length; index += 1) {
            const entry = this.entries[index];
            entry.surface.position.y = entry.baseY;
            const positions = entry.surface.geometry.attributes.position;
            for (let vertex = 0; vertex < entry.water.radii.length; vertex += 1) {
                const radialProgress = entry.water.radii[vertex] / entry.water.radius;
                const phase = this.time * 1.4 + entry.water.angles[vertex] * 2 * radialProgress - radialProgress * 7;
                positions.array[vertex * 3 + 2] = Math.sin(phase) * scale * 0.055 * (0.25 + radialProgress * 0.75);
            }
            positions.needsUpdate = true;
            entry.surface.geometry.computeVertexNormals();
        }
    }

    clear() {
        for (const entry of this.entries) {
            this.renderer?.removeFromScene?.(entry.group);
            disposeObject3DResources(entry.group);
        }
        this.entries.length = 0;
        this.time = 0;
    }

    dispose() {
        this.clear();
        this.renderer = null;
    }
}

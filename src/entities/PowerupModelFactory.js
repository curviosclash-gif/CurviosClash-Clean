import * as THREE from 'three';
import { getPickupVisualDescriptor } from './PickupRegistry.js';

function createStandardMaterial(color, options = {}) {
    return new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: Number(options.emissiveIntensity) || 0.5,
        roughness: Number(options.roughness) || 0.3,
        metalness: Number(options.metalness) || 0.65,
        transparent: !!options.transparent,
        opacity: Number.isFinite(options.opacity) ? options.opacity : 1.0,
    });
}

function createBasicMaterial(color, options = {}) {
    return new THREE.MeshBasicMaterial({
        color,
        transparent: !!options.transparent,
        opacity: Number.isFinite(options.opacity) ? options.opacity : 1.0,
        wireframe: !!options.wireframe,
        depthWrite: options.depthWrite !== false,
    });
}

export class PowerupModelFactory {
    constructor(size = 1.5) {
        this.size = Math.max(0.5, Number(size) || 1.5);
        this._geometries = this._createSharedGeometries();
    }

    _createSharedGeometries() {
        const s = this.size;
        const geos = {
            cube: new THREE.BoxGeometry(s, s, s),
            octa: new THREE.OctahedronGeometry(s * 0.52, 0),
            icosa: new THREE.IcosahedronGeometry(s * 0.5, 0),
            sphere: new THREE.SphereGeometry(s * 0.42, 14, 10),
            coreSphere: new THREE.SphereGeometry(s * 0.24, 12, 8),
            rod: new THREE.CylinderGeometry(s * 0.08, s * 0.08, s * 0.78, 8),
            thickRod: new THREE.CylinderGeometry(s * 0.2, s * 0.2, s * 0.86, 10),
            cone: new THREE.ConeGeometry(s * 0.24, s * 0.58, 10),
            rocketBody: new THREE.CylinderGeometry(s * 0.14, s * 0.14, s * 0.96, 10),
            fin: new THREE.BoxGeometry(s * 0.42, s * 0.08, s * 0.18),
            ring: new THREE.TorusGeometry(s * 0.48, s * 0.05, 10, 18),
            halo: new THREE.TorusGeometry(s * 0.58, s * 0.04, 10, 18),
        };

        geos.cone.rotateX(Math.PI);
        geos.rocketBody.rotateX(Math.PI / 2);
        return geos;
    }

    createModel(type, config = {}) {
        const visualDescriptor = getPickupVisualDescriptor(type);
        const visualKind = visualDescriptor?.kind || String(type || '').toUpperCase();
        const color = Number(config.color) || 0xffffff;

        try {
            if (visualKind === 'speed') return this._createSpeedModel(color);
            if (visualKind === 'slow') return this._createSlowModel(color);
            if (visualKind === 'thick') return this._createThickTrailModel(color);
            if (visualKind === 'thin') return this._createThinTrailModel(color);
            if (visualKind === 'shield') return this._createShieldModel(color);
            if (visualKind === 'slow-time') return this._createSlowTimeModel(color);
            if (visualKind === 'ghost') return this._createGhostModel(color);
            if (visualKind === 'invert') return this._createInvertModel(color);
            if (visualKind === 'rocket') return this._createRocketModel(color, visualDescriptor?.scale || 1);
            return this._createFallbackCube(color);
        } catch {
            return this._createFallbackCube(color);
        }
    }

    _createFallbackCube(color) {
        const group = new THREE.Group();
        const base = new THREE.Mesh(this._geometries.cube, createStandardMaterial(color, {
            emissiveIntensity: 0.45,
            roughness: 0.26,
            metalness: 0.72,
            transparent: true,
            opacity: 0.86,
        }));
        const wire = new THREE.Mesh(this._geometries.halo, createBasicMaterial(color, {
            wireframe: true,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
        }));
        wire.rotation.x = Math.PI * 0.5;
        group.add(base);
        group.add(wire);
        return group;
    }

    _createSpeedModel(color) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(this._geometries.octa, createStandardMaterial(color, { emissiveIntensity: 0.62 }));
        const arrow = new THREE.Mesh(this._geometries.cone, createStandardMaterial(0xffffff, {
            emissiveIntensity: 0.35,
            roughness: 0.22,
            metalness: 0.58,
        }));
        arrow.position.y = this.size * 0.36;
        const ring = new THREE.Mesh(this._geometries.ring, createBasicMaterial(color, {
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
        }));
        ring.rotation.x = Math.PI * 0.5;
        group.add(core);
        group.add(arrow);
        group.add(ring);
        return group;
    }

    _createSlowModel(color) {
        const group = new THREE.Group();
        const shell = new THREE.Mesh(this._geometries.sphere, createStandardMaterial(color, {
            emissiveIntensity: 0.48,
            roughness: 0.45,
            metalness: 0.28,
            transparent: true,
            opacity: 0.9,
        }));
        const belt = new THREE.Mesh(this._geometries.halo, createBasicMaterial(0x99ddff, {
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
        }));
        belt.rotation.z = Math.PI * 0.38;
        group.add(shell);
        group.add(belt);
        return group;
    }

    _createThickTrailModel(color) {
        const group = new THREE.Group();
        const rod = new THREE.Mesh(this._geometries.thickRod, createStandardMaterial(color, {
            emissiveIntensity: 0.58,
            roughness: 0.35,
            metalness: 0.7,
        }));
        const ring = new THREE.Mesh(this._geometries.ring, createBasicMaterial(0xffffff, {
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
        }));
        ring.rotation.x = Math.PI * 0.5;
        group.add(rod);
        group.add(ring);
        return group;
    }

    _createThinTrailModel(color) {
        const group = new THREE.Group();
        const rod = new THREE.Mesh(this._geometries.rod, createStandardMaterial(color, {
            emissiveIntensity: 0.62,
            roughness: 0.24,
            metalness: 0.55,
        }));
        const top = new THREE.Mesh(this._geometries.coreSphere, createStandardMaterial(0xffffff, {
            emissiveIntensity: 0.3,
            roughness: 0.2,
            metalness: 0.48,
        }));
        top.position.y = this.size * 0.24;
        group.add(rod);
        group.add(top);
        return group;
    }

    _createShieldModel(color) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(this._geometries.icosa, createStandardMaterial(color, {
            emissiveIntensity: 0.68,
            roughness: 0.18,
            metalness: 0.72,
            transparent: true,
            opacity: 0.9,
        }));
        const shell = new THREE.Mesh(this._geometries.halo, createBasicMaterial(0x99ccff, {
            transparent: true,
            opacity: 0.36,
            depthWrite: false,
        }));
        shell.rotation.x = Math.PI * 0.45;
        group.add(core);
        group.add(shell);
        return group;
    }

    _createSlowTimeModel(color) {
        const group = new THREE.Group();
        const ringA = new THREE.Mesh(this._geometries.ring, createStandardMaterial(color, {
            emissiveIntensity: 0.52,
            roughness: 0.28,
            metalness: 0.6,
        }));
        const ringB = new THREE.Mesh(this._geometries.ring, createBasicMaterial(0xffffff, {
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
        }));
        ringB.rotation.z = Math.PI * 0.5;
        const core = new THREE.Mesh(this._geometries.coreSphere, createStandardMaterial(0xffffff, {
            emissiveIntensity: 0.2,
            roughness: 0.2,
            metalness: 0.4,
        }));
        group.add(ringA);
        group.add(ringB);
        group.add(core);
        return group;
    }

    _createGhostModel(color) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(this._geometries.octa, createStandardMaterial(color, {
            emissiveIntensity: 0.42,
            roughness: 0.4,
            metalness: 0.25,
            transparent: true,
            opacity: 0.78,
        }));
        const aura = new THREE.Mesh(this._geometries.halo, createBasicMaterial(0xffffff, {
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
        }));
        aura.rotation.y = Math.PI * 0.5;
        group.add(body);
        group.add(aura);
        return group;
    }

    _createInvertModel(color) {
        const group = new THREE.Group();
        const ringA = new THREE.Mesh(this._geometries.ring, createStandardMaterial(color, {
            emissiveIntensity: 0.5,
            roughness: 0.25,
            metalness: 0.62,
        }));
        const ringB = new THREE.Mesh(this._geometries.ring, createStandardMaterial(0xffffff, {
            emissiveIntensity: 0.2,
            roughness: 0.35,
            metalness: 0.4,
        }));
        ringA.rotation.x = Math.PI * 0.5;
        ringB.rotation.y = Math.PI * 0.5;
        group.add(ringA);
        group.add(ringB);
        return group;
    }

    _createRocketModel(color, scale = 1) {
        const group = new THREE.Group();
        const s = Math.max(0.72, Number(scale) || 1);

        const body = new THREE.Mesh(this._geometries.rocketBody, createStandardMaterial(color, {
            emissiveIntensity: 0.58,
            roughness: 0.24,
            metalness: 0.75,
        }));
        body.scale.setScalar(s);

        const tip = new THREE.Mesh(this._geometries.cone, createStandardMaterial(0xffffff, {
            emissiveIntensity: 0.22,
            roughness: 0.22,
            metalness: 0.55,
        }));
        tip.position.z = -this.size * 0.6 * s;
        tip.scale.setScalar(s);

        const finA = new THREE.Mesh(this._geometries.fin, createStandardMaterial(color, {
            emissiveIntensity: 0.3,
            roughness: 0.32,
            metalness: 0.58,
        }));
        finA.position.z = this.size * 0.22 * s;
        finA.scale.setScalar(s);

        const finB = finA.clone();
        finB.rotation.z = Math.PI * 0.5;

        const glow = new THREE.Mesh(this._geometries.halo, createBasicMaterial(color, {
            transparent: true,
            opacity: 0.22 + (s - 0.72) * 0.2,
            depthWrite: false,
        }));
        glow.rotation.x = Math.PI * 0.5;
        glow.scale.setScalar(s);

        group.add(body);
        group.add(tip);
        group.add(finA);
        group.add(finB);
        group.add(glow);
        return group;
    }

    dispose() {
        if (!this._geometries) return;
        for (const geometry of Object.values(this._geometries)) {
            if (geometry && typeof geometry.dispose === 'function') {
                geometry.dispose();
            }
        }
        this._geometries = null;
    }
}

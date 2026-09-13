import * as THREE from 'three';
import { getPickupVisualDescriptor } from './PickupRegistry.js';
import { createBasicMaterial, createStandardMaterial } from './powerup/PowerupSharedMaterials.js';

// Materials live in their own module: identical pickup looks share one instance, which keeps this
// file under the line budget and the sharing rule in one place.

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
            if (visualKind === 'health') return this._createHealthModel(color);
            if (visualKind === 'turret' || visualKind === 'rocket-turret') return this._createTurretModel(color, visualKind === 'rocket-turret');
            if (visualKind === 'slow-time') return this._createSlowTimeModel(color);
            if (visualKind === 'ghost') return this._createGhostModel(color);
            if (visualKind === 'fog') return this._createFogModel(color);
            if (visualKind === 'invert') return this._createInvertModel(color);
            if (visualKind === 'trail-gap') return this._createTrailGapModel(color);
            if (visualKind === 'emp') return this._createEmpModel(color);
            if (visualKind === 'magnet') return this._createMagnetModel(color);
            if (visualKind === 'decoy') return this._createDecoyModel(color);
            if (visualKind === 'purge') return this._createPurgeModel(color);
            if (visualKind === 'swap') return this._createSwapModel(color);
            if (visualKind === 'mine') return this._createMineModel(color);
            if (visualKind === 'weapon-fan') {
                return this._createWeaponFanModel(color, visualDescriptor?.fanProjectiles || 3);
            }
            if (visualKind === 'rocket') {
                return this._createRocketModel(
                    color,
                    visualDescriptor?.scale || 1,
                    visualDescriptor?.rocketTier || 'WEAK'
                );
            }
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

    _createHealthModel(color) {
        const group = new THREE.Group();
        const horizontal = new THREE.Mesh(this._geometries.thickRod, createStandardMaterial(color, {
            emissiveIntensity: 0.55,
            roughness: 0.24,
            metalness: 0.45,
        }));
        const vertical = horizontal.clone();
        horizontal.rotation.z = Math.PI * 0.5;
        group.add(horizontal, vertical);
        return group;
    }

    _createTurretModel(color, rocket = false) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(this._geometries.sphere, createStandardMaterial(color, {
            emissiveIntensity: 0.5,
            roughness: 0.35,
            metalness: 0.75,
        }));
        const barrel = new THREE.Mesh(rocket ? this._geometries.thickRod : this._geometries.rod, createStandardMaterial(0xffffff, {
            emissiveIntensity: 0.2,
            roughness: 0.3,
            metalness: 0.8,
        }));
        barrel.rotation.x = Math.PI * 0.5;
        barrel.position.z = -this.size * 0.45;
        group.add(body, barrel);
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

    _createFogModel(color) {
        const group = new THREE.Group();
        const material = createStandardMaterial(color, {
            emissiveIntensity: 0.24,
            roughness: 0.82,
            metalness: 0.08,
            transparent: true,
            opacity: 0.9,
        });
        const center = new THREE.Mesh(this._geometries.sphere, material);
        const left = center.clone();
        const right = center.clone();
        center.scale.set(1.1, 0.8, 0.9);
        left.position.set(-this.size * 0.34, -this.size * 0.08, 0);
        left.scale.set(0.78, 0.62, 0.72);
        right.position.set(this.size * 0.34, -this.size * 0.06, 0);
        right.scale.set(0.86, 0.68, 0.78);
        group.add(center, left, right);
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

    _createTrailGapModel(color) {
        const group = new THREE.Group();
        const material = createStandardMaterial(color, { emissiveIntensity: 0.62 });
        const left = new THREE.Mesh(this._geometries.rod, material);
        const right = left.clone();
        left.rotation.z = right.rotation.z = Math.PI * 0.5;
        left.position.x = -this.size * 0.32;
        right.position.x = this.size * 0.32;
        left.scale.y = right.scale.y = 0.55;
        group.add(left, right);
        return group;
    }

    _createEmpModel(color) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(this._geometries.coreSphere, createStandardMaterial(color, { emissiveIntensity: 0.8 }));
        const ringA = new THREE.Mesh(this._geometries.halo, createBasicMaterial(color, { transparent: true, opacity: 0.65 }));
        const ringB = ringA.clone();
        ringA.rotation.x = Math.PI * 0.5;
        ringB.rotation.y = Math.PI * 0.5;
        group.add(core, ringA, ringB);
        return group;
    }

    _createMagnetModel(color) {
        const group = new THREE.Group();
        const material = createStandardMaterial(color, { emissiveIntensity: 0.6 });
        const left = new THREE.Mesh(this._geometries.thickRod, material);
        const right = left.clone();
        left.position.x = -this.size * 0.23;
        right.position.x = this.size * 0.23;
        const bridge = new THREE.Mesh(this._geometries.thickRod, material);
        bridge.rotation.z = Math.PI * 0.5;
        bridge.position.y = -this.size * 0.28;
        bridge.scale.y = 0.7;
        group.add(left, right, bridge);
        return group;
    }

    _createDecoyModel(color) {
        const group = new THREE.Group();
        const first = new THREE.Mesh(this._geometries.octa, createStandardMaterial(color, { transparent: true, opacity: 0.72 }));
        const second = first.clone();
        first.position.x = -this.size * 0.2;
        second.position.x = this.size * 0.2;
        second.scale.setScalar(0.72);
        group.add(first, second);
        return group;
    }

    _createPurgeModel(color) {
        const group = new THREE.Group();
        for (let i = 0; i < 3; i += 1) {
            const ring = new THREE.Mesh(this._geometries.ring, createStandardMaterial(color, { emissiveIntensity: 0.48 }));
            ring.rotation.set(i === 0 ? Math.PI * 0.5 : 0, i === 1 ? Math.PI * 0.5 : 0, i === 2 ? Math.PI * 0.5 : 0);
            group.add(ring);
        }
        return group;
    }

    _createSwapModel(color) {
        const group = new THREE.Group();
        const material = createStandardMaterial(color, { emissiveIntensity: 0.62 });
        const forward = new THREE.Mesh(this._geometries.cone, material);
        const backward = forward.clone();
        forward.position.x = -this.size * 0.24;
        backward.position.x = this.size * 0.24;
        forward.rotation.z = -Math.PI * 0.5;
        backward.rotation.z = Math.PI * 0.5;
        group.add(forward, backward);
        return group;
    }

    _createMineModel(color) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(this._geometries.icosa, createStandardMaterial(color, { emissiveIntensity: 0.7, metalness: 0.85 }));
        core.scale.setScalar(0.72);
        group.add(core);
        for (let i = 0; i < 4; i += 1) {
            const spike = new THREE.Mesh(this._geometries.cone, createStandardMaterial(0xffffff, { emissiveIntensity: 0.25 }));
            spike.rotation.z = Math.PI * 0.5;
            spike.rotation.y = i * Math.PI * 0.5;
            spike.position.set(Math.cos(i * Math.PI * 0.5) * this.size * 0.42, 0, Math.sin(i * Math.PI * 0.5) * this.size * 0.42);
            spike.scale.setScalar(0.55);
            group.add(spike);
        }
        return group;
    }

    _createWeaponFanModel(color, projectileCount) {
        const group = new THREE.Group();
        const count = Math.max(3, Math.min(5, Math.floor(Number(projectileCount) || 3)));
        const core = new THREE.Mesh(this._geometries.octa, createStandardMaterial(color, {
            emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.72,
        }));
        core.scale.setScalar(0.72);
        group.add(core);
        for (let i = 0; i < count; i += 1) {
            const marker = new THREE.Mesh(this._geometries.rod, createStandardMaterial(0xffffff, {
                emissiveIntensity: 0.45,
                roughness: 0.25,
                metalness: 0.55,
            }));
            const angle = count === 1 ? 0 : -Math.PI / 6 + (Math.PI / 3) * i / (count - 1);
            marker.rotation.z = angle;
            marker.position.set(Math.sin(angle) * this.size * 0.42, Math.cos(angle) * this.size * 0.42, 0);
            marker.scale.set(0.65, 0.68, 0.65);
            group.add(marker);
        }

        const label = new THREE.Group();
        const labelMaterial = createBasicMaterial(0xffffff, { depthWrite: false });
        const addBar = (x, y, scaleX, scaleY, rotation = 0) => {
            const bar = new THREE.Mesh(this._geometries.cube, labelMaterial);
            bar.position.set(x, y, 0);
            bar.scale.set(scaleX, scaleY, 0.035);
            bar.rotation.z = rotation;
            label.add(bar);
        };
        addBar(-0.32, 0, 0.18, 0.035, Math.PI / 4);
        addBar(-0.32, 0, 0.18, 0.035, -Math.PI / 4);
        const segments = count === 3 ? ['t', 'm', 'b', 'rt', 'rb']
            : count === 4 ? ['m', 'lt', 'rt', 'rb'] : ['t', 'm', 'b', 'lt', 'rb'];
        for (const segment of segments) {
            const horizontal = segment === 't' || segment === 'm' || segment === 'b';
            const x = horizontal ? 0.2 : (segment.startsWith('l') ? 0.06 : 0.34);
            const y = segment === 't' ? 0.22 : segment === 'b' ? -0.22
                : segment === 'm' ? 0 : segment.endsWith('t') ? 0.11 : -0.11;
            addBar(x, y, horizontal ? 0.15 : 0.035, horizontal ? 0.035 : 0.11);
        }
        label.position.set(0, this.size * 0.92, this.size * 0.5);
        label.scale.setScalar(this.size);
        Object.assign(label.userData, { weaponFanLabel: true, markerText: `×${count}` });
        group.add(label);
        Object.assign(group.userData, { fanProjectiles: count, markerText: `×${count}` });
        return group;
    }

    _createRocketModel(color, scale = 1, tier = 'WEAK') {
        const group = new THREE.Group();
        const s = Math.max(0.72, Number(scale) || 1);
        const markerCount = ({ WEAK: 0, MEDIUM: 1, HEAVY: 2, MEGA: 3 })[tier] ?? 0;

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
        for (let i = 0; i < markerCount; i += 1) {
            const marker = new THREE.Mesh(this._geometries.halo, createBasicMaterial(0xffffff, {
                transparent: true,
                opacity: 0.5,
                depthWrite: false,
            }));
            marker.rotation.x = Math.PI * 0.5;
            marker.position.z = this.size * (0.05 + i * 0.2) * s;
            marker.scale.setScalar(0.48 * s);
            group.add(marker);
        }
        group.userData.rocketTier = tier;
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

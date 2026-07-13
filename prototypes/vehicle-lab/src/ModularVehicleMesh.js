import * as THREE from 'three';

/**
 * ModularVehicleMesh builds a 3D vehicle from a configuration object.
 */
export class ModularVehicleMesh extends THREE.Group {
    constructor(config = {}) {
        super();
        this.isModularVehicle = true;
        this.config = config;
        this.materials = new Map();
        this.geometries = new Map();
        this.dynamicGeometries = new Set();
        this.isWireframe = false;

        this.initMaterials(config);
        this.build();
    }

    initMaterials(config) {
        // Dispose existing if any
        this.materials.forEach(m => m.dispose());
        this.materials.clear();

        this.materials.set('primary', new THREE.MeshStandardMaterial({ color: config.primaryColor || 0x60a5fa, roughness: 0.3, metalness: 0.6 }));
        this.materials.set('secondary', new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7, metalness: 0.2 }));
        this.materials.set('glass', new THREE.MeshPhysicalMaterial({ color: 0x1e293b, transmission: 0.5, opacity: 0.7, roughness: 0.2, metalness: 0.1, clearcoat: 1.0 }));
        this.materials.set('glow', new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 }));
    }

    setWireframe(enabled) {
        this.isWireframe = enabled;
        this.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.wireframe = enabled;
            }
        });
    }

    build() {
        this.disposeDynamicGeometries();

        // Resource Disposal (Geometries & Cloned Materials)
        this.traverse(child => {
            if (child.isMesh) {
                // Geometry disposal moved to a global check if needed, 
                // but since we cache them now, we don't dispose them here!
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(m => {
                        let isBase = false;
                        this.materials.forEach(base => { if (base === m) isBase = true; });
                        if (!isBase) m.dispose();
                    });
                }
            }
        });

        this.clear();
        if (!this.config.parts) return;

        this.config.parts.forEach((partConfig, index) => {
            this.buildRecursive(this, partConfig, index, [], false);
        });
    }

    trackDynamicGeometry(geometry) {
        if (!geometry || !geometry.isBufferGeometry) return geometry;
        this.dynamicGeometries.add(geometry);
        return geometry;
    }

    disposeDynamicGeometries() {
        this.dynamicGeometries.forEach((geometry) => {
            geometry.dispose();
        });
        this.dynamicGeometries.clear();
    }

    buildRecursive(parentGroup, partConfig, index, path = [], isMirror = false) {
        const part = this.createPart(partConfig);
        if (!part) return null;

        part.userData.partIndex = index;
        part.userData.path = path;
        part.userData.config = partConfig;
        part.userData.isMirror = isMirror;

        parentGroup.add(part);

        // Mirroring logic
        if (parentGroup === this && !isMirror) {
            const mirrorAxis = partConfig.mirrorAxis || (partConfig.mirror ? 'x' : null);
            if (mirrorAxis) {
                const mirrored = this.buildRecursive(this, partConfig, index, path, true);
                if (mirrored) {
                    if (mirrorAxis === 'x') { mirrored.position.x *= -1; mirrored.rotation.y *= -1; mirrored.rotation.z *= -1; }
                    else if (mirrorAxis === 'y') { mirrored.position.y *= -1; mirrored.rotation.x *= -1; mirrored.rotation.z *= -1; }
                    else if (mirrorAxis === 'z') { mirrored.position.z *= -1; mirrored.rotation.x *= -1; mirrored.rotation.y *= -1; }
                }
            }
        }

        // Children
        if (partConfig.children) {
            partConfig.children.forEach((childConfig, cIdx) => {
                this.buildRecursive(part, childConfig, index, [...path, cIdx], isMirror);
            });
        }

        return part;
    }

    getGeometry(type, size) {
        const key = `${type}_${size.join('_')}`;
        if (this.geometries.has(key)) return this.geometries.get(key);

        let geo;
        const s = size;
        switch (type) {
            case 'box': geo = new THREE.BoxGeometry(s[0], s[1], s[2]); break;
            case 'sphere': geo = new THREE.SphereGeometry(s[0], 16, 12); break;
            case 'cylinder': geo = new THREE.CylinderGeometry(s[0], s[1], s[2], 12); break;
            case 'cone': geo = new THREE.ConeGeometry(s[0], s[1], 12); break;
            case 'torus': geo = new THREE.TorusGeometry(s[0], s[1], 8, 24); break;
            case 'capsule': geo = new THREE.CapsuleGeometry(s[0], s[1], 4, 8); break;
            case 'pylon': geo = new THREE.CylinderGeometry(s[0], s[1], s[2], 8); break;
        }

        if (geo) this.geometries.set(key, geo);
        return geo;
    }

    createPart(data) {
        let geo;
        const s = data.size || [1, 1, 1];

        // Specialized Types
        if (data.geo === 'engine') return this.createEngineCompound(data);
        if (data.geo === 'forcefield') return this.createForceFieldCompound(data);
        if (data.geo === 'flame') return this.createFlameCompound(data);

        geo = this.getGeometry(data.geo, s);
        if (!geo) return null;

        const matBase = this.materials.get(data.material) || this.materials.get('primary');
        const mat = matBase.clone();

        // Custom Per-Part Styling
        if (data.color) mat.color.set(data.color);
        if (data.opacity !== undefined) {
            mat.transparent = true;
            mat.opacity = data.opacity;
        }
        if (data.emissive) {
            mat.emissive?.set(data.emissive);
            mat.emissiveIntensity = data.emissiveIntensity !== undefined ? data.emissiveIntensity : 1;
        }

        const mesh = new THREE.Mesh(geo, mat);
        mesh.material.wireframe = this.isWireframe;
        this.applyTransforms(mesh, data);
        return mesh;
    }

    applyTransforms(mesh, data) {
        if (data.pos) mesh.position.set(...data.pos);
        if (data.rot) mesh.rotation.set(...data.rot.map(r => THREE.MathUtils.degToRad(r)));
        if (data.scale) mesh.scale.set(...data.scale);

        mesh.name = data.name || 'Part';
        mesh.userData.config = data;
    }

    createEngineCompound(data) {
        const group = new THREE.Group();
        const s = data.size || [0.28, 0.28, 0.5]; // radiusTop, radiusBottom, height

        // Shroud
        const shroudGeo = this.trackDynamicGeometry(new THREE.CylinderGeometry(s[0], s[1], s[2], 12));
        shroudGeo.rotateX(Math.PI / 2);
        const shroud = new THREE.Mesh(shroudGeo, this.materials.get('secondary').clone());
        group.add(shroud);

        // Nozzle
        const nozzleGeo = this.trackDynamicGeometry(new THREE.CylinderGeometry(s[0] * 0.7, s[0] * 0.8, s[2] * 0.3, 12, 1, true));
        nozzleGeo.rotateX(Math.PI / 2);
        const nozzle = new THREE.Mesh(nozzleGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.2 }));
        nozzle.position.z = s[2] * 0.5;
        group.add(nozzle);

        // Core
        const coreGeo = this.trackDynamicGeometry(new THREE.SphereGeometry(s[0] * 0.4, 8, 8));
        const core = new THREE.Mesh(coreGeo, this.materials.get('glow').clone());
        core.position.z = s[2] * 0.4;
        group.add(core);

        this.applyTransforms(group, data);
        return group;
    }

    createForceFieldCompound(data) {
        const s = data.size || [0.06, 0.06, 1.2]; // radiusTop, radiusBottom, length
        const geo = this.trackDynamicGeometry(new THREE.CylinderGeometry(s[0], s[1], s[2], 8, 1, true));
        geo.rotateX(Math.PI / 2);

        const mat = new THREE.MeshStandardMaterial({
            color: data.color || 0x00ffff,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            emissive: data.color || 0x00ffff,
            emissiveIntensity: 0.5
        });

        const mesh = new THREE.Mesh(geo, mat);

        // Inner Wireframe
        const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: data.color || 0x00ffff,
            wireframe: true,
            transparent: true,
            opacity: 0.2
        }));
        mesh.add(wire);

        this.applyTransforms(mesh, data);
        mesh.userData.isForceField = true;
        return mesh;
    }

    createFlameCompound(data) {
        const s = data.size || [0.15, 0.01, 0.5]; // radiusTop, radiusBottom, length
        const geo = this.trackDynamicGeometry(new THREE.CylinderGeometry(s[0], s[1], s[2], 8));
        geo.rotateX(-Math.PI / 2);

        const mat = new THREE.MeshBasicMaterial({
            color: data.color || 0x00eeff,
            transparent: true,
            opacity: 0.8
        });

        const mesh = new THREE.Mesh(geo, mat);
        this.applyTransforms(mesh, data);
        return mesh;
    }

    tick(dt, time) {
        this.traverse(child => {
            const config = child.userData.config;
            if (!config) return;

            // Specialized standard animations
            if (child.userData.isForceField) {
                const pulse = 0.2 + 0.1 * Math.sin(time * 10);
                child.material.opacity = pulse;
            }

            // Custom Animations from Config
            if (config.anim) {
                const a = config.anim;
                const speed = a.speed || 1;
                const amount = a.amount || 1;

                switch (a.type) {
                    case 'rotate':
                        if (a.axis === 'x') child.rotation.x += speed * dt;
                        else if (a.axis === 'y') child.rotation.y += speed * dt;
                        else child.rotation.z += speed * dt;
                        break;
                    case 'bob':
                        const bob = Math.sin(time * speed) * amount * 0.1;
                        child.position.y = (config.pos ? config.pos[1] : 0) + bob;
                        break;
                    case 'pulse':
                        const pulse = 1 + Math.sin(time * speed) * amount * 0.1;
                        child.scale.setScalar(pulse * (config.scale ? config.scale[0] : 1));
                        break;
                }
            }

            // Highlight selected part
            if (child.userData.partIndex !== undefined && child.userData.partIndex === this.selectedIndex && !child.userData.isMirror) {
                if (child.material && (child.material.emissive || child.material.isMeshStandardMaterial)) {
                    const pulse = (Math.sin(time * 8) + 1) * 0.2; // 0 to 0.4 pulse
                    if (child.material.emissive) {
                        child.material.emissiveIntensity = (config.emissiveIntensity || 0) + pulse;
                    }
                }
            }
        });
    }

    setSelectedIndex(index) {
        this.selectedIndex = index;
    }

    updateConfig(newConfig) {
        this.config = newConfig;
        this.initMaterials(newConfig);
        this.build();
    }

    dispose() {
        this.disposeDynamicGeometries();
        this.traverse(child => {
            if (child.isMesh) {
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(m => m.dispose());
                }
            }
        });
        this.geometries.forEach(g => g.dispose());
        this.geometries.clear();
        this.materials.forEach(m => m.dispose());
        this.materials.clear();
    }
}

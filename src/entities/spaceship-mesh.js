/**
 * SPACESHIP-MESH.JS - 3D Raumschiff-Modell
 * Sci-Fi Raumschiff aus Three.js Primitiven
 */

import * as THREE from 'three';

export class SpaceshipMesh extends THREE.Group {
    constructor(color) {
        super();
        this.playerColor = color;

        this.primaryMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.2,
            metalness: 0.8,
            emissive: new THREE.Color(color).multiplyScalar(0.15),
            emissiveIntensity: 0.3
        });

        this.darkMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a1a,
            roughness: 0.5,
            metalness: 0.9
        });

        this.glowMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.9
        });

        this.engineGlowMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.85
        });

        this.engineCoreMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x00ffff,
            emissiveIntensity: 1.5
        });

        this.forceFieldMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            emissive: 0x00ffff,
            emissiveIntensity: 0.5
        });

        this._time = 0;
        this.forceFields = [];

        this.muzzle = new THREE.Object3D();
        this.add(this.muzzle);
        this.muzzle.position.set(0, 0, -2.5);

        this.createSaucer();
        this.createCockpitDome();
        this.createEngines();
        this.createWinglets();
        this.createCannon();
    }

    createSaucer() {
        // Main Saucer Body (Scaled)
        const geo = new THREE.CylinderGeometry(1.0, 1.2, 0.25, 16);
        const saucer = new THREE.Mesh(geo, this.primaryMat);
        this.add(saucer);

        // Rim
        const rimGeo = new THREE.TorusGeometry(1.2, 0.08, 8, 32);
        rimGeo.rotateX(Math.PI / 2);
        const rim = new THREE.Mesh(rimGeo, this.darkMat);
        this.add(rim);

        // Bottom dome (Scaled)
        const bottomGeo = new THREE.SphereGeometry(1.2, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        const bottom = new THREE.Mesh(bottomGeo, this.darkMat);
        bottom.position.y = -0.2;
        this.add(bottom);
    }

    createCockpitDome() {
        // Glas-Kuppel oben (Scaled)
        const geo = new THREE.SphereGeometry(0.625, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0x88ccff,
            transmission: 0.6,
            opacity: 0.75,
            roughness: 0.05,
            metalness: 0.0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0.25, -0.5); // Scaled
        this.add(mesh);
    }

    createEngines() {
        const shroudGeo = new THREE.CylinderGeometry(0.2, 0.18, 0.5, 12);
        shroudGeo.rotateX(Math.PI / 2);

        const nozzleGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.15, 12, 1, true);
        nozzleGeo.rotateX(Math.PI / 2);

        const coreGeo = new THREE.SphereGeometry(0.1, 8, 8);

        const createEngineAssembly = (side) => {
            const group = new THREE.Group();
            // Directly on the saucer rim (reduced offset)
            group.position.set(side * 1.35, 0, 0.4);

            const shroud = new THREE.Mesh(shroudGeo, this.darkMat);
            group.add(shroud);

            const nozzle = new THREE.Mesh(nozzleGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.2 }));
            nozzle.position.z = 0.25;
            group.add(nozzle);

            const core = new THREE.Mesh(coreGeo, this.engineCoreMat);
            core.position.z = 0.18;
            group.add(core);

            this.add(group);
            return group;
        };

        const lEng = createEngineAssembly(-1);
        const rEng = createEngineAssembly(1);

        // Force Fields removed as requested


        // Flame
        const glowGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const addFlame = (parent) => {
            const flame = new THREE.Mesh(glowGeo, this.engineGlowMat.clone());
            flame.name = 'flame';
            flame.position.set(0, 0, 0.35);
            parent.add(flame);
        };

        addFlame(lEng);
        addFlame(rEng);


    }



    tick(dt) {
        this._time += dt;

        this.forceFields.forEach((field, i) => {
            const pulse = 0.2 + 0.1 * Math.sin(this._time * 10 + i);
            field.material.opacity = pulse;
        });


    }

    createWinglets() {
        // Small side stabilizers (Scaled)
        const geo = new THREE.BoxGeometry(0.8, 0.1, 2.5);
        const mat = new THREE.MeshStandardMaterial({ color: this.playerColor });

        const left = new THREE.Mesh(geo, mat);
        left.position.set(-1.4, 0, -1.5);
        this.add(left);

        const right = new THREE.Mesh(geo, mat);
        right.position.set(1.4, 0, -1.5);
        this.add(right);
    }

    createCannon() {
        // Zwei Kanonen vorne (Scaled)
        const geo = new THREE.CylinderGeometry(0.05, 0.05, 1.25, 6);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0x334466, metalness: 0.95, roughness: 0.2 });

        const left = new THREE.Mesh(geo, mat);
        left.position.set(-0.5, 0, -2);
        this.add(left);

        const right = new THREE.Mesh(geo, mat);
        right.position.set(0.5, 0, -2);
        this.add(right);
    }
}

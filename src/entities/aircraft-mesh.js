/**
 * AIRCRAFT-MESH.JS - 3D Flugzeug-Modell
 * Procedurally generiertes Flugzeug aus Three.js Primitiven
 */

import * as THREE from 'three';

export class AircraftMesh extends THREE.Group {
    constructor(color) {
        super();

        this.playerColor = color;

        // Materalien
        this.primaryMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.3,
            metalness: 0.6,
            emissive: new THREE.Color(color).multiplyScalar(0.2),
            emissiveIntensity: 0.2
        });

        this.secondaryMat = new THREE.MeshStandardMaterial({
            color: 0x334155, // Dark slate
            roughness: 0.7,
            metalness: 0.2
        });

        this.cockpitMat = new THREE.MeshPhysicalMaterial({
            color: 0x1e293b,
            transmission: 0.5,
            opacity: 0.7,
            roughness: 0.2,
            metalness: 0.1,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1
        });

        this.glowMat = new THREE.MeshBasicMaterial({
            color: 0x60a5fa,
            transparent: true,
            opacity: 0.8
        });

        this.engineCoreMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x00ffff,
            emissiveIntensity: 2.0,
            metalness: 1.0,
            roughness: 0.0
        });

        this.forceFieldMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            wireframe: false,
            emissive: 0x00ffff,
            emissiveIntensity: 0.5
        });



        this._time = 0;
        this.forceFields = [];

        this.createBody();
        this.createWings();
        this.createTail();
        this.createCockpit();
        this.createEngines();
        this.createCannon();

        // Initial rotation to align with game physics (if needed)
        // Physics: -Z is forward.
        // Mesh: By default, cylinder is Y-up.
        // So we rotate the group so local -Z is forward?
        // Let's assume the construction below builds it along -Z.
    }

    createBody() {
        // Main Fuselage
        const geo = new THREE.CylinderGeometry(0.5, 0.7, 5, 12);
        geo.rotateX(Math.PI / 2); // Align to Z-axis
        const mesh = new THREE.Mesh(geo, this.primaryMat);
        mesh.position.z = -0.4;
        this.add(mesh);

        // Nose Cone
        const noseGeo = new THREE.ConeGeometry(0.5, 1.6, 12);
        noseGeo.rotateX(-Math.PI / 2); // Pointing to -Z
        const nose = new THREE.Mesh(noseGeo, this.primaryMat);
        nose.position.z = -3.7;
        this.add(nose);
    }

    createWings() {
        // Main Wings (Delta shapeish) - scaled down
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(2.4, 2.0);
        shape.lineTo(2.4, 0.8);
        shape.lineTo(0, -1.2);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1 });
        geo.rotateX(Math.PI / 2);
        geo.rotateY(-Math.PI / 2);

        // Left Wing
        const leftWing = new THREE.Mesh(geo, this.primaryMat);
        leftWing.position.set(-0.4, 0, 0.8);
        leftWing.rotation.x = Math.PI;
        this.add(leftWing);

        // Right Wing
        const rightWing = new THREE.Mesh(geo, this.primaryMat);
        rightWing.position.set(0.4, 0, 0.8);
        this.add(rightWing);


    }


    createTail() {
        // Vertical Stabilizer
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(1.0, 1.2);
        shape.lineTo(0.6, 1.2);
        shape.lineTo(-0.4, 0);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 });
        geo.translate(-0.3, 0, 0);

        const tail = new THREE.Mesh(geo, this.primaryMat);
        tail.position.set(0, 0.4, 1.6);
        tail.rotation.y = Math.PI / 2;
        this.add(tail);

        // Horizontal Stabilizers? (Already have wings)
    }

    createCockpit() {
        const geo = new THREE.CapsuleGeometry(0.28, 0.8, 4, 8);
        const mesh = new THREE.Mesh(geo, this.cockpitMat);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(0, 0.36, -0.8);
        this.add(mesh);
    }

    createEngines() {
        // Multi-part Engine Design (Scaled down by 30% from 0.7 -> 0.5)
        const shroudGeo = new THREE.CylinderGeometry(0.28, 0.24, 1.0, 12);
        shroudGeo.rotateX(Math.PI / 2);

        const nozzleGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.3, 12, 1, true);
        nozzleGeo.rotateX(Math.PI / 2);

        const coreGeo = new THREE.SphereGeometry(0.12, 12, 8);

        const createEngineAssembly = (x, z) => {
            const group = new THREE.Group();
            group.position.set(x, 0.1, z);
            group.scale.set(0.5, 0.5, 0.5);

            // Shroud (Outer shell)
            const shroud = new THREE.Mesh(shroudGeo, this.secondaryMat);
            group.add(shroud);

            // Nozzle (Detailed end)
            const nozzle = new THREE.Mesh(nozzleGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.2 }));
            nozzle.position.z = 0.5;
            group.add(nozzle);

            // Glowing Core
            const core = new THREE.Mesh(coreGeo, this.engineCoreMat);
            core.position.z = 0.36;
            group.add(core);

            // Greebles
            const greebleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.24);
            for (let i = 0; i < 4; i++) {
                const g = new THREE.Mesh(greebleGeo, this.secondaryMat);
                const angle = (i / 4) * Math.PI * 2;
                g.position.set(Math.cos(angle) * 0.26, Math.sin(angle) * 0.26, 0);
                group.add(g);
            }

            this.add(group);
            return group;
        };

        const lEng = createEngineAssembly(-2.3, 2.0);
        const rEng = createEngineAssembly(2.3, 2.0);

        // Force Fields removed as requested


        // Glow / Flame (extracted to standard 'flame' objects)
        const glowGeo = new THREE.CylinderGeometry(0.16, 0.002, 0.6, 8);
        glowGeo.rotateX(-Math.PI / 2);

        const addFlame = (parent) => {
            const flame = new THREE.Mesh(glowGeo, this.glowMat.clone());
            flame.name = 'flame';
            flame.position.set(0, 0, 0.7); // Move further back due to detailed nozzle
            parent.add(flame);
        };

        addFlame(lEng);
        addFlame(rEng);
    }

    tick(dt) {
        this._time += dt;

        // Animated Force Fields
        this.forceFields.forEach((field, i) => {
            const pulse = 0.2 + 0.1 * Math.sin(this._time * 10 + i);
            field.material.opacity = pulse;
        });
    }

    createCannon() {
        // Under nose gun (Scaled)
        const geo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.4 });
        const cannon = new THREE.Mesh(geo, mat);
        cannon.position.set(0, -0.36, -1.6);
        this.add(cannon);

        this.muzzle = new THREE.Object3D();
        this.muzzle.position.set(0, -0.36, -2.4);
        this.add(this.muzzle);
    }
}

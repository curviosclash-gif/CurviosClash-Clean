/**
 * ARROW-MESH.JS - 3D Pfeil-Modell
 * Schlankes, aerodynamisches Pfeilformat
 */

import * as THREE from 'three';

export class ArrowMesh extends THREE.Group {
    constructor(color) {
        super();
        this.playerColor = color;

        this.primaryMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.15,
            metalness: 0.85,
            emissive: new THREE.Color(color).multiplyScalar(0.25),
            emissiveIntensity: 0.4
        });

        this.accentMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.1,
            metalness: 0.95,
            emissive: 0xffffff,
            emissiveIntensity: 0.1
        });

        this.thrusterMat = new THREE.MeshBasicMaterial({
            color: 0xff4400,
            transparent: true,
            opacity: 0.9
        });

        this.engineCoreMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            emissive: 0x00ffff,
            emissiveIntensity: 2.0
        });

        this.forceFieldMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            emissive: 0x00ffff,
            emissiveIntensity: 0.5
        });

        this._time = 0;
        this.forceFields = [];

        this.createBody();
        this.createFins();
        this.createEngines();
    }

    createBody() {
        // Main Shaft (Scaled)
        const geo = new THREE.CylinderGeometry(0.1, 0.25, 4, 8);
        geo.rotateX(Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.primaryMat);
        mesh.position.z = 1.0;
        this.add(mesh);

        // Arrow head (Scaled)
        const headGeo = new THREE.ConeGeometry(0.4, 1.2, 8);
        headGeo.rotateX(-Math.PI / 2);
        const head = new THREE.Mesh(headGeo, this.primaryMat); // Using primaryMat for consistency with original arrowhead
        head.position.z = -1.6;
        this.add(head);

        this.muzzle = new THREE.Object3D();
        this.muzzle.position.set(head.position.x, head.position.y, -2.2); // Just in front of head
        this.add(this.muzzle);
    }

    createArrowhead() {
        // Spitze vorne - klassischer Kegel
        const coneGeo = new THREE.ConeGeometry(1.2, 12, 8);
        coneGeo.rotateX(-Math.PI / 2);
        const nose = new THREE.Mesh(coneGeo, this.primaryMat);
        nose.position.z = -15;
        this.add(nose);

        // Pfeispitze-Schultern (Angled Cut)
        const wingShape = new THREE.Shape();
        wingShape.moveTo(0, 0);
        wingShape.lineTo(6, 5);
        wingShape.lineTo(8, 0);
        wingShape.lineTo(6, -1);
        const wGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.6, bevelEnabled: false });
        wGeo.rotateX(Math.PI / 2);
        wGeo.rotateY(-Math.PI / 2);

        const leftW = new THREE.Mesh(wGeo, this.primaryMat);
        leftW.position.set(-2, 0, -7);
        leftW.rotation.x = Math.PI;
        this.add(leftW);

        const rightW = new THREE.Mesh(wGeo, this.primaryMat);
        rightW.position.set(2, 0, -7);
        this.add(rightW);
    }

    createFins() {
        // Heck-Stabilisatoren (X-förmig)
        const finShape = new THREE.Shape();
        finShape.moveTo(0, 0);
        finShape.lineTo(0, 7 / 4); // Scaled by 4
        finShape.lineTo(5 / 4, 10 / 4); // Scaled by 4
        finShape.lineTo(5 / 4, 3 / 4); // Scaled by 4

        const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.5 / 4, bevelEnabled: false }); // Scaled by 4
        finGeo.rotateX(Math.PI / 2);
        finGeo.rotateY(-Math.PI / 2);

        // 4 Fins in X-Anordnung
        const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        angles.forEach(angle => {
            const fin = new THREE.Mesh(finGeo, this.primaryMat);
            fin.position.z = 10 / 4; // Scaled by 4
            fin.rotation.z = angle;
            // Adjust position based on angle
            fin.position.x = Math.cos(angle + Math.PI / 2) * (1.5 / 4); // Scaled by 4
            fin.position.y = Math.sin(angle + Math.PI / 2) * (1.5 / 4); // Scaled by 4
            this.add(fin);
        });
    }

    createEngines() {
        const shroudGeo = new THREE.CylinderGeometry(0.25, 0.2, 0.8, 12);
        shroudGeo.rotateX(Math.PI / 2);

        const nozzleGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.25, 12, 1, true);
        nozzleGeo.rotateX(Math.PI / 2);

        const coreGeo = new THREE.SphereGeometry(0.1, 8, 8);

        const createEngineAssembly = (side) => {
            const group = new THREE.Group();
            // Directly at the fins (reduced offset)
            group.position.set(side * 0.45, 0, 3.2);

            const shroud = new THREE.Mesh(shroudGeo, this.accentMat);
            group.add(shroud);

            const nozzle = new THREE.Mesh(nozzleGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.2 }));
            nozzle.position.z = 0.4;
            group.add(nozzle);

            const core = new THREE.Mesh(coreGeo, this.engineCoreMat);
            core.position.z = 0.3;
            group.add(core);

            this.add(group);
            return group;
        };

        const lEng = createEngineAssembly(-1);
        const rEng = createEngineAssembly(1);

        // Force Fields removed as requested


        // Flame
        const glowGeo = new THREE.CylinderGeometry(0.15, 0.01, 0.5, 8);
        glowGeo.rotateX(-Math.PI / 2);

        const addFlame = (parent) => {
            const flame = new THREE.Mesh(glowGeo, this.thrusterMat.clone());
            flame.name = 'flame';
            flame.position.set(0, 0, 0.55);
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
}

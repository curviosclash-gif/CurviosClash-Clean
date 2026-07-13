/**
 * MANTA-MESH.JS - 3D Manta-Ray-Stil-Gleiter
 * Breiter, flacher Gleiter mit geschwungenen Flügeln
 */

import * as THREE from 'three';

export class MantaMesh extends THREE.Group {
    constructor(color) {
        super();
        this.playerColor = color;

        this.primaryMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.25,
            metalness: 0.6,
            emissive: new THREE.Color(color).multiplyScalar(0.2),
            emissiveIntensity: 0.35,
            side: THREE.DoubleSide
        });

        this.darkMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.6,
            metalness: 0.4
        });

        this.glowMat = new THREE.MeshBasicMaterial({
            color: 0x00eeff,
            transparent: true,
            opacity: 0.8
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

        this.muzzle = new THREE.Object3D();
        this.add(this.muzzle);
        this.muzzle.position.set(0, -0.2, -2.1);

        this.createBody();
        this.createWings();
        this.createTail();
        this.createEngines();
        this.createEyes();
        this.createCannon();
    }

    createBody() {
        // Flacher Körper (gedrückte Raute)
        const shape = new THREE.Shape();
        shape.moveTo(0, -20); // Nose
        shape.bezierCurveTo(4, -12, 6, -4, 5, 4);
        shape.bezierCurveTo(4, 8, 2, 10, 0, 11);  // tail start
        shape.bezierCurveTo(-2, 10, -4, 8, -5, 4);
        shape.bezierCurveTo(-6, -4, -4, -12, 0, -20);
        this.wingTipZ = 1.0;

        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: 2.5,
            bevelEnabled: true,
            bevelSize: 1.2,
            bevelThickness: 1.0,
            bevelSegments: 3
        });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, 0, 0);

        const mesh = new THREE.Mesh(geo, this.primaryMat);
        mesh.position.y = -1;
        this.add(mesh);
    }

    createWings() {
        // Linker Flügel (geschwungen) - gekürzt
        const leftShape = new THREE.Shape();
        leftShape.moveTo(0, 0);
        leftShape.bezierCurveTo(-3, -2, -8, -5, -13, -3);
        leftShape.bezierCurveTo(-15, -1, -15, 3, -13, 4);
        leftShape.bezierCurveTo(-8, 5, -3, 3, 0, 2);

        const leftGeo = new THREE.ExtrudeGeometry(leftShape, {
            depth: 1,
            bevelEnabled: true,
            bevelSize: 0.4,
            bevelThickness: 0.3
        });
        leftGeo.rotateX(-Math.PI / 2);

        const leftWing = new THREE.Mesh(leftGeo, this.primaryMat);
        leftWing.position.set(-5, -0.5, -6);
        this.add(leftWing);

        // Rechter Flügel (Spiegelung) - gekürzt
        const rightShape = new THREE.Shape();
        rightShape.moveTo(0, 0);
        rightShape.bezierCurveTo(3, -2, 8, -5, 13, -3);
        rightShape.bezierCurveTo(15, -1, 15, 3, 13, 4);
        rightShape.bezierCurveTo(8, 5, 3, 3, 0, 2);


        const rightGeo = new THREE.ExtrudeGeometry(rightShape, {
            depth: 1,
            bevelEnabled: true,
            bevelSize: 0.4,
            bevelThickness: 0.3
        });
        rightGeo.rotateX(-Math.PI / 2);

        const rightWing = new THREE.Mesh(rightGeo, this.primaryMat);
        rightWing.position.set(5, -0.5, -6);
        this.add(rightWing);

        // Unter-Lichtstreifen an Flügeln
        const lineGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6);
        lineGeo.rotateZ(Math.PI / 2);

        const lineL = new THREE.Mesh(lineGeo, this.glowMat);
        lineL.position.set(-1.3, -0.1, -0.3);
        this.add(lineL);

        const lineR = new THREE.Mesh(lineGeo, this.glowMat);
        lineR.position.set(1.3, -0.1, -0.3);
        this.add(lineR);
    }

    createTail() {
        // Dünner Schwanz
        const geo = new THREE.CylinderGeometry(0.05, 0.15, 1.2, 6);
        geo.rotateX(Math.PI / 2);
        const tail = new THREE.Mesh(geo, this.darkMat);
        tail.position.z = 1.2;
        this.add(tail);

        // Schwanzflosse (vertikal)
        const finShape = new THREE.Shape();
        finShape.moveTo(0, 0);
        finShape.lineTo(0, 0.55);
        finShape.lineTo(0.36, 0.27);
        finShape.lineTo(0.27, 0);
        const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.036, bevelEnabled: false });
        finGeo.rotateX(Math.PI / 2);
        finGeo.rotateY(Math.PI / 2);
        const fin = new THREE.Mesh(finGeo, this.primaryMat);
        fin.position.set(0, 0.18, 1.3);
        this.add(fin);
    }

    createEngines() {
        const shroudGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.25, 12);
        shroudGeo.rotateX(Math.PI / 2);

        const nozzleGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12, 1, true);
        nozzleGeo.rotateX(Math.PI / 2);

        const coreGeo = new THREE.SphereGeometry(0.04, 8, 8);

        const createEngineAssembly = (side) => {
            const group = new THREE.Group();
            group.position.set(side * 17.5, -0.2, -5.5);

            const shroud = new THREE.Mesh(shroudGeo, this.darkMat);
            group.add(shroud);

            const nozzle = new THREE.Mesh(nozzleGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.2 }));
            nozzle.position.z = 0.15;
            group.add(nozzle);

            const core = new THREE.Mesh(coreGeo, this.engineCoreMat);
            core.position.z = 0.1;
            group.add(core);

            this.add(group);
            return group;
        };

        const lEng = createEngineAssembly(-1);
        const rEng = createEngineAssembly(1);

        // Force Fields removed as requested


        // Flame
        const glowGeo = new THREE.SphereGeometry(0.1, 8, 8);
        const addFlame = (parent) => {
            const flame = new THREE.Mesh(glowGeo, this.glowMat.clone());
            flame.name = 'flame';
            flame.position.set(0, 0, 0.25);
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

    createEyes() {
        // Zwei leuchtende "Augen" / Sensoren vorne
        const eyeGeo = new THREE.SphereGeometry(0.11, 8, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0066, transparent: true, opacity: 0.9 });

        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(-0.27, 0.09, -1.6);
        this.add(eyeL);

        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(0.27, 0.09, -1.6);
        this.add(eyeR);
    }

    createCannon() {
        const geo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.9, roughness: 0.3 });
        const cannon = new THREE.Mesh(geo, mat);
        cannon.position.set(0, -0.2, -1.8);
        this.add(cannon);
    }
}

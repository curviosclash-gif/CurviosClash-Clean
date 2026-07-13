/**
 * DRONE-MESH.JS - 3D Drohnen-Modell
 * Kantiger, technischer Quadro-Drohnen-Look
 */

import * as THREE from 'three';

export class DroneMesh extends THREE.Group {
    constructor(color) {
        super();
        this.playerColor = color;

        this.primaryMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.3,
            metalness: 0.75,
            emissive: new THREE.Color(color).multiplyScalar(0.2),
            emissiveIntensity: 0.3
        });

        this.darkMat = new THREE.MeshStandardMaterial({
            color: 0x111122,
            roughness: 0.7,
            metalness: 0.5
        });

        this.rotorMat = new THREE.MeshStandardMaterial({
            color: 0x334455,
            roughness: 0.4,
            metalness: 0.8,
            transparent: true,
            opacity: 0.6
        });

        this.ledMat = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 1.0
        });

        this.thrusterMat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
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
        this.muzzle.position.set(0, -3, -12);

        this.createCore();
        this.createArms();
        this.createEngines();
        this.createSensors();
        this.createCannon();
    }

    createCore() {
        // Haupt-Körper (flacher Quader)
        const geo = new THREE.BoxGeometry(1.6, 0.8, 2.4);
        const mesh = new THREE.Mesh(geo, this.primaryMat);
        this.add(mesh);

        // Obere Abdeckung (leicht abgerundet durch Bevel)
        const topGeo = new THREE.BoxGeometry(1.2, 0.3, 2);
        const top = new THREE.Mesh(topGeo, this.darkMat);
        top.position.y = 0.55;
        this.add(top);

        // Unterseite - Sensor-Array
        const sensorGeo = new THREE.BoxGeometry(0.8, 0.16, 1.2);
        const sensorMat = new THREE.MeshStandardMaterial({ color: 0x001133, roughness: 0.2, metalness: 0.9 });
        const sensor = new THREE.Mesh(sensorGeo, sensorMat);
        sensor.position.y = -0.48;
        this.add(sensor);

        // Status-LED Streifen
        const ledGeo = new THREE.BoxGeometry(1, 0.08, 0.08);
        const led = new THREE.Mesh(ledGeo, this.ledMat);
        led.position.set(0, 0.42, -0.8);
        this.add(led);

        const led2 = new THREE.Mesh(ledGeo, this.ledMat);
        led2.position.set(0, 0.42, 0.8);
        this.add(led2);
    }

    createArms() {
        // 4 Ausleger-Arme diagonal
        const armGeo = new THREE.BoxGeometry(3.2, 0.24, 0.4);

        const arm1 = new THREE.Mesh(armGeo, this.primaryMat);
        arm1.rotation.y = Math.PI / 4;
        arm1.position.y = 0.1;
        this.add(arm1);

        const arm2 = new THREE.Mesh(armGeo, this.primaryMat);
        arm2.rotation.y = -Math.PI / 4;
        arm2.position.y = 0.1;
        this.add(arm2);

        // Arm-Verstärkungen (kleine Quader an den Enden)
        const bracketGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
        const positions = [
            { x: 1.6, z: 1.6 },
            { x: -1.6, z: 1.6 },
            { x: 1.6, z: -1.6 },
            { x: -1.6, z: -1.6 }
        ];
        positions.forEach(pos => {
            const b = new THREE.Mesh(bracketGeo, this.darkMat);
            b.position.set(pos.x, 0.1, pos.z);
            this.add(b);
        });
    }

    createEngines() {
        // Multi-part Blocky Engine Design (Scaled)
        const shroudGeo = new THREE.BoxGeometry(0.4, 0.4, 0.8);
        const nozzleGeo = new THREE.BoxGeometry(0.28, 0.28, 0.2);
        const coreGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);

        const createEngineAssembly = (side) => {
            const group = new THREE.Group();
            // Directly on the arms (reduced offset)
            group.position.set(side * 1.6, 0.1, 1.5);

            const shroud = new THREE.Mesh(shroudGeo, this.darkMat);
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
        const glowGeo = new THREE.BoxGeometry(0.3, 0.3, 0.1);
        const addFlame = (parent) => {
            const flame = new THREE.Mesh(glowGeo, this.thrusterMat.clone());
            flame.name = 'flame';
            flame.position.set(0, 0, 0.5);
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

    createSensors() {
        // Front-Kamera
        const camGeo = new THREE.BoxGeometry(0.6, 0.4, 0.3);
        const camMat = new THREE.MeshStandardMaterial({ color: 0x000011, roughness: 0.1, metalness: 0.9 });
        const cam = new THREE.Mesh(camGeo, camMat);
        cam.position.set(0, -0.1, -1.4);
        this.add(cam);

        // Kamera-Linse
        const lensGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.16, 10);
        lensGeo.rotateX(Math.PI / 2);
        const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x0011ff, transmission: 0.4, roughness: 0.0, metalness: 0.0 });
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.position.set(0, -0.1, -1.56);
        this.add(lens);

        // Ranging-Sensor (vorne)
        const sGeo = new THREE.BoxGeometry(0.2, 0.2, 0.16);
        const redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const rangeSensor = new THREE.Mesh(sGeo, redMat);
        rangeSensor.position.set(0, 0.2, -1.4);
        this.add(rangeSensor);
    }

    createCannon() {
        // Untergehängtes Geschütz
        const barrelGeo = new THREE.CylinderGeometry(0.1, 0.1, 2, 6);
        barrelGeo.rotateX(Math.PI / 2);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.95, roughness: 0.2 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.position.set(0, -0.6, -1.4);
        this.add(barrel);

        // Halterung
        const mountGeo = new THREE.BoxGeometry(0.4, 0.4, 1.6);
        const mount = new THREE.Mesh(mountGeo, this.darkMat);
        mount.position.set(0, -0.4, -0.8);
        this.add(mount);
    }
}

/**
 * ORB-MESH.JS - 3D Energie-Orb-Modell
 * Futuristischer schwebender Energie-Orb mit rotierenden Ringen
 */

import * as THREE from 'three';

export class OrbMesh extends THREE.Group {
    constructor(color) {
        super();
        this.playerColor = color;
        this._time = 0;

        this.coreMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.05,
            metalness: 0.2,
            emissive: new THREE.Color(color),
            emissiveIntensity: 0.6,
            transparent: true,
            opacity: 0.9
        });

        this.shellMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.1,
            metalness: 0.9,
            emissive: new THREE.Color(color).multiplyScalar(0.3),
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });

        this.ringMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.05,
            metalness: 1.0,
            emissive: new THREE.Color(color).multiplyScalar(0.5),
            emissiveIntensity: 0.7
        });

        this.innerGlowMat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.5,
            side: THREE.BackSide
        });

        this.cannonMat = new THREE.MeshStandardMaterial({
            color: 0x111122,
            roughness: 0.2,
            metalness: 0.95
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
        this.muzzle.position.set(0, 0, -2.4);

        this.createCore();
        this.createShell();
        this.createRings();
        this.createEngines();
    }

    createCore() {
        // Main Core (Scaled)
        const geo = new THREE.SphereGeometry(1.0, 16, 16);
        this.coreMesh = new THREE.Mesh(geo, this.coreMat);
        this.add(this.coreMesh);

        // Core glow
        const glowGeo = new THREE.SphereGeometry(1.2, 16, 16);
        const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: this.playerColor, transparent: true, opacity: 0.15 }));
        this.add(glow);
    }

    createShell() {
        // Outer energy shell (Scaled)
        const geo = new THREE.IcosahedronGeometry(1.4, 1);
        const mat = new THREE.MeshStandardMaterial({
            color: this.playerColor,
            wireframe: true,
            transparent: true,
            opacity: 0.4
        });
        const shell = new THREE.Mesh(geo, mat);
        this.add(shell);

        // Hexagonale Panzerung (Box-Gitter simuliert) - Scaled
        const panelMat = new THREE.MeshStandardMaterial({
            color: 0x334466,
            roughness: 0.3,
            metalness: 0.9,
            transparent: true,
            opacity: 0.6,
            wireframe: false
        });

        // 6 Platten am Äquator
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const panelGeo = new THREE.BoxGeometry(0.5, 0.5, 0.16); // Scaled from 3,3,1
            const panel = new THREE.Mesh(panelGeo, panelMat);
            panel.position.set(
                Math.cos(angle) * 1.3, // Scaled from 8
                0,
                Math.sin(angle) * 1.3 // Scaled from 8
            );
            panel.lookAt(0, 0, 0);
            this.add(panel);
        }
    }

    createRings() {
        // Rotating Orbit Rings (Scaled)
        const ringGeo = new THREE.TorusGeometry(2, 0.04, 8, 48);

        this.ring1 = new THREE.Mesh(ringGeo, this.ringMat);
        this.add(this.ring1);

        this.ring2 = new THREE.Mesh(ringGeo, this.ringMat);
        this.ring2.rotation.x = Math.PI / 2;
        this.add(this.ring2);

        const ring3Geo = new THREE.TorusGeometry(2.4, 0.03, 8, 48);
        this.ring3 = new THREE.Mesh(ring3Geo, this.ringMat);
        this.ring3.rotation.y = Math.PI / 4;
        this.add(this.ring3);

        // LED-Punkte an den Ringen - Scaled
        const dotGeo = new THREE.SphereGeometry(0.13, 6, 6); // Scaled from 0.8
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });

        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const dot = new THREE.Mesh(dotGeo, dotMat);
            dot.position.set(Math.cos(angle) * 2, 0, Math.sin(angle) * 2); // Scaled from 10
            this.ring1.add(dot);
        }
    }

    createEngines() {
        // Reduzierte Größe (30% kleiner)
        const shroudGeo = new THREE.CylinderGeometry(0.24, 0.2, 0.5, 12);
        shroudGeo.rotateX(Math.PI / 2);

        const nozzleGeo = new THREE.CylinderGeometry(0.18, 0.2, 0.15, 12, 1, true);
        nozzleGeo.rotateX(Math.PI / 2);

        const coreGeo = new THREE.SphereGeometry(0.08, 8, 8);

        const createEngineAssembly = (side) => {
            const group = new THREE.Group();
            // Positioned closer and without the Z-offset
            group.position.set(side * 2.2, 0, 0);
            group.rotation.y = side * Math.PI / 2;

            const shroud = new THREE.Mesh(shroudGeo, this.shellMat);
            group.add(shroud);

            const nozzle = new THREE.Mesh(nozzleGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.2 }));
            nozzle.position.z = 0.25;
            group.add(nozzle);

            const core = new THREE.Mesh(coreGeo, this.engineCoreMat);
            core.position.z = 0.2;
            group.add(core);

            this.add(group);
            return group;
        };

        const lEng = createEngineAssembly(-1);
        const rEng = createEngineAssembly(1);

        // Force Fields entfernt wie gewünscht

        // Flame (Skalierung angepasst)
        const glowGeo = new THREE.SphereGeometry(0.18, 8, 8);
        const addFlame = (parent) => {
            const flame = new THREE.Mesh(glowGeo, this.ringMat.clone());
            flame.name = 'flame';
            flame.position.set(0, 0, 0.3);
            parent.add(flame);
        };

        addFlame(lEng);
        addFlame(rEng);
    }
    tick(dt) {
        this._time += dt;
        if (this.ring1) this.ring1.rotation.y += dt * 1.2;
        if (this.ring2) this.ring2.rotation.z += dt * 0.8;
        if (this.ring3) {
            this.ring3.rotation.y += dt * 0.5;
            this.ring3.rotation.x += dt * 0.3;
        }
        // Pulsierender Kern
        if (this.coreMesh) {
            const pulse = 0.9 + 0.1 * Math.sin(this._time * 3);
            this.coreMesh.scale.setScalar(pulse);
        }

        // Force Fields are removed, so no pulsing needed here
    }
}


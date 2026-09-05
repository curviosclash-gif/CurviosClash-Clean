import * as THREE from 'three';
import {
    isMapHazardActive,
    normalizeMapHazards,
    resolveMapHazardCycleTime,
} from '../../shared/contracts/MapHazardContract.js';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

export class MapHazardVisualController {
    constructor(renderer) {
        this.renderer = renderer;
        this.group = null;
        this.hazards = [];
        this.visuals = [];
        this.elapsedSeconds = 0;
        this.scale = 1;
    }

    build(map, mapScale = 1) {
        this.clear();
        this.hazards = normalizeMapHazards(map?.mapHazards);
        if (this.hazards.length === 0) return null;
        this.scale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(mapScale) || 1)
            : 1;
        this.group = new THREE.Group();
        this.group.name = 'map-hazard-visuals';
        const geometry = new THREE.SphereGeometry(1, 16, 10);
        for (let index = 0; index < this.hazards.length; index += 1) {
            const hazard = this.hazards[index];
            const material = new THREE.MeshBasicMaterial({
                color: hazard.warningColor,
                transparent: true,
                opacity: 0.12,
                depthWrite: false,
                wireframe: true,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `map-hazard-${hazard.id}`;
            mesh.position.fromArray(hazard.position).multiplyScalar(this.scale);
            mesh.scale.setScalar(hazard.radius * this.scale);
            mesh.renderOrder = 5;
            mesh.userData.authoredHazardId = hazard.id;
            this.group.add(mesh);
            this.visuals.push({ hazard, mesh, material });
        }
        this.renderer?.addToScene?.(this.group);
        this.update(0);
        return this.group;
    }

    update(elapsedSeconds) {
        const numeric = Number(elapsedSeconds);
        this.elapsedSeconds = Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
        for (let index = 0; index < this.visuals.length; index += 1) {
            const visual = this.visuals[index];
            const cycleTime = resolveMapHazardCycleTime(visual.hazard, this.elapsedSeconds);
            const active = isMapHazardActive(visual.hazard, this.elapsedSeconds);
            const telegraph = cycleTime < visual.hazard.telegraphSeconds;
            visual.mesh.visible = telegraph || active;
            if (!visual.mesh.visible) continue;
            if (active) {
                const activeTime = cycleTime - visual.hazard.telegraphSeconds;
                visual.material.color.setHex(visual.hazard.activeColor);
                visual.material.opacity = 0.34 + Math.sin(activeTime * 18) * 0.08;
                visual.mesh.scale.setScalar(visual.hazard.radius * this.scale * 1.04);
                continue;
            }
            const progress = cycleTime / visual.hazard.telegraphSeconds;
            const pulse = 0.92 + Math.sin(progress * Math.PI * 8) * 0.04;
            visual.material.color.setHex(visual.hazard.warningColor);
            visual.material.opacity = 0.08 + progress * 0.18;
            visual.mesh.scale.setScalar(visual.hazard.radius * this.scale * pulse);
        }
    }

    clear() {
        if (this.group) {
            this.renderer?.removeFromScene?.(this.group);
            disposeObject3DResources(this.group);
        }
        this.group = null;
        this.hazards = [];
        this.visuals = [];
        this.elapsedSeconds = 0;
        this.scale = 1;
    }

    dispose() {
        this.clear();
    }
}

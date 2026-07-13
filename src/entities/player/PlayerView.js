import * as THREE from 'three';
import { disposeObject3DResources } from '../../core/three-disposal.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { createVehicleMesh } from '../vehicle-registry.js';
import { syncPlayerHitboxFromVehicleMesh } from './PlayerMotionOps.js';

const SHARED_GEO = {};

function markSharedGeometry(geometry) {
    if (!geometry) return;
    geometry.userData = geometry.userData || {};
    geometry.userData.__sharedNoDispose = true;
}

function ensureSharedGeo() {
    if (SHARED_GEO.body) return;

    SHARED_GEO.body = new THREE.ConeGeometry(0.35, 3.2, 8);
    SHARED_GEO.body.rotateX(Math.PI / 2);
    SHARED_GEO.cockpit = new THREE.SphereGeometry(0.28, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    SHARED_GEO.nozzle = new THREE.CylinderGeometry(0.2, 0.25, 0.4, 8);
    SHARED_GEO.nozzle.rotateX(Math.PI / 2);
    SHARED_GEO.flameInner = new THREE.ConeGeometry(0.15, 1.0, 8);
    SHARED_GEO.flameInner.rotateX(-Math.PI / 2);
    SHARED_GEO.flameMid = new THREE.ConeGeometry(0.22, 1.4, 8);
    SHARED_GEO.flameMid.rotateX(-Math.PI / 2);
    SHARED_GEO.flameOuter = new THREE.ConeGeometry(0.28, 1.8, 8);
    SHARED_GEO.flameOuter.rotateX(-Math.PI / 2);
    SHARED_GEO.shield = new THREE.SphereGeometry(1.5, 8, 8);
    SHARED_GEO.shieldBox = new THREE.BoxGeometry(1, 1, 1);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(-1.8, 0.6);
    wingShape.lineTo(-0.3, 0.8);
    wingShape.lineTo(0, 0);
    SHARED_GEO.wingL = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: false });

    const wingShapeR = new THREE.Shape();
    wingShapeR.moveTo(0, 0);
    wingShapeR.lineTo(1.8, 0.6);
    wingShapeR.lineTo(0.3, 0.8);
    wingShapeR.lineTo(0, 0);
    SHARED_GEO.wingR = new THREE.ExtrudeGeometry(wingShapeR, { depth: 0.06, bevelEnabled: false });

    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0, 0.8);
    finShape.lineTo(0.4, 0.1);
    finShape.lineTo(0, 0);
    SHARED_GEO.fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.04, bevelEnabled: false });

    for (const geo of Object.values(SHARED_GEO)) {
        markSharedGeometry(geo);
    }
}

export class PlayerView {
    constructor(player, renderer) {
        this.player = player;
        this.renderer = renderer;
        this.viewType = 'player';

        this.group = null;
        this.vehicleMesh = null;
        this.shieldMesh = null;
        this.innerShield = null;
        this.firstPersonAnchor = null;
        this.flames = [];

        this._onVehicleLoaded = null;
        this._vehicleLoadedTarget = null;
        this._renderPosition = new THREE.Vector3();
        this._renderQuaternion = new THREE.Quaternion();
        this._exhaustAccumulator = 0;
        this._tmpExhaustOrigin = new THREE.Vector3();
        this._tmpExhaustSample = new THREE.Vector3();
        this._tmpExhaustDirection = new THREE.Vector3();
    }

    createModel() {
        const playerConfig = resolveGameplayConfig(this.player).PLAYER;
        this.group = new THREE.Group();
        this.vehicleMesh = createVehicleMesh(this.player.vehicleId, this.player.color);
        this.group.add(this.vehicleMesh);

        this._attachVehicleLoadedHandler(this.vehicleMesh);

        this.firstPersonAnchor = new THREE.Object3D();
        if (this.vehicleMesh?.firstPersonAnchor) {
            this.firstPersonAnchor = this.vehicleMesh.firstPersonAnchor;
        } else {
            this.firstPersonAnchor.position.set(
                playerConfig.NOSE_CAMERA_LOCAL_X || 0,
                playerConfig.NOSE_CAMERA_LOCAL_Y || 0,
                playerConfig.NOSE_CAMERA_LOCAL_Z || -2
            );
            this.group.add(this.firstPersonAnchor);
        }

        ensureSharedGeo();
        const shieldMaterial = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0,
            wireframe: true,
            side: THREE.BackSide,
            depthWrite: false,
        });
        this.shieldMesh = new THREE.Mesh(SHARED_GEO.shieldBox, shieldMaterial);
        this.innerShield = new THREE.Mesh(
            SHARED_GEO.shieldBox,
            new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0,
                wireframe: false,
                depthWrite: false,
            })
        );
        this.innerShield.name = 'innerShield';
        this.innerShield.scale.set(0.98, 0.98, 0.98);
        this.shieldMesh.add(this.innerShield);
        this.group.add(this.shieldMesh);

        this._collectFlames();

        if (this.renderer?.addToScene) {
            this.renderer.addToScene(this.group);
        }

        this.group.userData = this.group.userData || {};
        this.group.userData.entityViewType = this.viewType;

        this.applyModelScale();
        this._syncShieldBaseScaleToHitbox();
        this.syncFromState();
        this._syncPlayerRefs();
    }

    _syncPlayerRefs() {
        this.player.group = this.group;
        this.player.vehicleMesh = this.vehicleMesh;
        this.player.shieldMesh = this.shieldMesh;
        this.player.firstPersonAnchor = this.firstPersonAnchor;
        this.player.flames = this.flames;
    }

    _attachVehicleLoadedHandler(mesh) {
        const updateBounds = () => {
            const currentMesh = this.vehicleMesh;
            if (!currentMesh || currentMesh !== mesh || !this.group) return;
            syncPlayerHitboxFromVehicleMesh(this.player, currentMesh);
            this._syncShieldBaseScaleToHitbox();
        };

        if (mesh?.addEventListener) {
            this._onVehicleLoaded = updateBounds;
            this._vehicleLoadedTarget = mesh;
            mesh.addEventListener('loaded', updateBounds);
        }

        updateBounds();
    }

    _collectFlames() {
        this.flames = [];
        this.vehicleMesh?.traverse((child) => {
            if (child.name === 'flame' || (child.material && child.material.name === 'flame')) {
                this.flames.push(child);
            }
        });
    }

    _syncShieldBaseScaleToHitbox() {
        const size = this.player?.hitboxSize;
        const center = this.player?.hitboxCenter;
        if (!size || !center || !this.player?._shieldBaseScale) return;

        this.player._shieldBaseScale.set(
            Math.max(0.12, size.x * 1.15),
            Math.max(0.12, size.y * 1.15),
            Math.max(0.12, size.z * 1.15)
        );

        if (this.shieldMesh) {
            this.shieldMesh.scale.copy(this.player._shieldBaseScale);
            this.shieldMesh.position.copy(center);
        }
    }

    applyModelScale() {
        if (this.group) {
            this.group.scale.setScalar(this.player.modelScale || 1);
        }
    }

    setVisible(visible) {
        if (this.group) {
            this.group.visible = !!visible;
        }
    }

    syncRotation() {
        if (this.group?.quaternion) {
            this.group.quaternion.copy(this.player.quaternion);
        }
    }

    applyRenderTransform(renderAlpha = 1) {
        if (!this.group) return;
        this.player.resolveRenderTransform(renderAlpha, this._renderPosition, this._renderQuaternion);
        this.group.position.copy(this._renderPosition);
        this.group.quaternion.copy(this._renderQuaternion);
    }

    copyRenderTransform(outPosition = null, outQuaternion = null) {
        if (!this.group) return false;
        if (outPosition) {
            outPosition.copy(this._renderPosition);
        }
        if (outQuaternion) {
            outQuaternion.copy(this._renderQuaternion);
        }
        return true;
    }

    syncFromState() {
        if (!this.group) return;
        this.group.position.copy(this.player.position);
        this.group.quaternion.copy(this.player.quaternion);
        this._renderPosition.copy(this.player.position);
        this._renderQuaternion.copy(this.player.quaternion);
    }

    _resolveExhaustOrigin(out) {
        if (!this.group) {
            return out.copy(this.player.position);
        }

        if (this.flames.length > 0) {
            this.group.updateWorldMatrix(true, false);
            out.set(0, 0, 0);
            let samples = 0;
            for (let i = 0; i < this.flames.length; i++) {
                const flame = this.flames[i];
                if (!flame?.getWorldPosition) continue;
                flame.getWorldPosition(this._tmpExhaustSample);
                out.add(this._tmpExhaustSample);
                samples += 1;
            }
            if (samples > 0) {
                return out.multiplyScalar(1 / samples);
            }
        }

        this.player.getDirection(this._tmpExhaustDirection);
        return out.copy(this.player.position).addScaledVector(this._tmpExhaustDirection, -0.9 * (this.player.modelScale || 1));
    }

    _emitThrusterExhaust(dt) {
        const particleSystem = this.player?.particleSystem;
        if (!particleSystem?.spawnDirectional || !this.group || this.group.visible !== true) return;
        const perspectiveSettings = this.renderer?.getCameraPerspectiveSettings?.() || null;
        const thrusterExhaustEnabled = perspectiveSettings?.thrusterExhaustEnabled !== false;
        const thrusterExhaustIntensity = Math.max(0, Number(perspectiveSettings?.thrusterExhaustIntensity) || 0);
        if (!thrusterExhaustEnabled || thrusterExhaustIntensity <= 0) return;

        const gameplayConfig = resolveGameplayConfig(this.player);
        const playerConfig = gameplayConfig?.PLAYER || {};
        const baseSpeed = Math.max(1, Number(this.player.baseSpeed) || Number(playerConfig.SPEED) || 35);
        const boostMultiplier = Math.max(1.05, Number(playerConfig.BOOST_MULTIPLIER) || 1.8);
        const boostSpeed = Math.max(baseSpeed + 1, baseSpeed * boostMultiplier);
        const speedBlend = THREE.MathUtils.clamp(
            (Math.max(0, Number(this.player.speed) || 0) - baseSpeed) / Math.max(1, boostSpeed - baseSpeed),
            0,
            1.2
        );
        const reduceMotion = perspectiveSettings?.reduceMotion === true;
        const emissionIntensity = thrusterExhaustIntensity * (reduceMotion ? 0.72 : 1);
        const emissionRate = THREE.MathUtils.lerp(10, 32, speedBlend) * (this.player.isBoosting ? 1.15 : 1) * emissionIntensity;
        this._exhaustAccumulator += Math.max(0, Number(dt) || 0) * emissionRate;

        const burstCount = Math.min(4, Math.floor(this._exhaustAccumulator));
        if (burstCount <= 0) return;
        this._exhaustAccumulator -= burstCount;

        this.player.getDirection(this._tmpExhaustDirection).multiplyScalar(-1);
        this._resolveExhaustOrigin(this._tmpExhaustOrigin);

        const color = this.player.isBoosting ? 0xfff0b3 : 0xff9a3c;
        const speed = THREE.MathUtils.lerp(2.4, 6.8, speedBlend);
        const size = THREE.MathUtils.lerp(0.16, 0.3, speedBlend) * Math.max(0.6, Math.sqrt(emissionIntensity));
        const life = THREE.MathUtils.lerp(0.16, 0.28, speedBlend) * THREE.MathUtils.clamp(0.8 + emissionIntensity * 0.2, 0.65, 1.15);
        const jitter = 0.08 * (this.player.modelScale || 1);

        for (let i = 0; i < burstCount; i++) {
            this._tmpExhaustSample.copy(this._tmpExhaustOrigin);
            this._tmpExhaustSample.addScaledVector(this._tmpExhaustDirection, Math.random() * jitter);
            this._tmpExhaustSample.x += (Math.random() - 0.5) * jitter;
            this._tmpExhaustSample.y += (Math.random() - 0.5) * jitter;
            this._tmpExhaustSample.z += (Math.random() - 0.5) * jitter;
            particleSystem.spawnDirectional(
                this._tmpExhaustSample,
                this._tmpExhaustDirection,
                this.player.isBoosting ? 2 : 1,
                color,
                speed,
                size,
                life,
                {
                    gravity: 0,
                    spread: this.player.isBoosting ? 0.38 : 0.26,
                    drift: 0.22,
                    type: 'thruster-exhaust',
                }
            );
        }
    }

    update(dt) {
        if (!this.group) return;

        if (this.vehicleMesh && typeof this.vehicleMesh.tick === 'function') {
            this.vehicleMesh.tick(dt);
        }

        const time = performance.now() * 0.001;
        if (this.flames.length > 0) {
            const boostFactor = this.player.isBoosting ? 3.0 : 1.0;
            const flicker = Math.sin(time * 25) * 0.15 + Math.sin(time * 37) * 0.1;

            for (let i = 0; i < this.flames.length; i++) {
                const flame = this.flames[i];
                if (!flame) continue;

                const depthOffset = i * 0.05;
                const scaleZ = (0.4 - depthOffset + flicker * (0.3 - depthOffset)) * boostFactor;
                flame.scale.set(1, 1, Math.max(0.1, scaleZ));

                if (flame.material) {
                    flame.material.opacity = this.player.isBoosting ? 1.0 : 0.7;
                    if (this.player.isBoosting) {
                        flame.material.color.setHex(i % 2 === 0 ? 0xffffff : 0xffaa33);
                    } else {
                        flame.material.color.setHex(i % 2 === 0 ? 0xffffaa : 0xff8800);
                    }
                }
            }
        }

        this._emitThrusterExhaust(dt);

        if (this.shieldMesh) {
            this.shieldMesh.visible = this.player.hasShield;
            if (this.player.hasShield) {
                const shieldRatio = Math.max(0, Math.min(1, this.player.shieldHP / Math.max(1, this.player.maxShieldHp || 1)));
                const hitPulse = Math.max(0, Math.min(1, this.player.shieldHitFeedback || 0));
                const flicker = Math.sin(time * 6) * 0.12;
                this.shieldMesh.material.opacity = Math.max(0.08, 0.18 + shieldRatio * 0.24 + hitPulse * 0.32 + flicker);
                this.shieldMesh.scale.copy(this.player._shieldBaseScale).multiplyScalar(
                    Math.max(0.68, 0.9 + shieldRatio * 0.12 - hitPulse * 0.18)
                );
                if (this.innerShield?.material) {
                    this.innerShield.material.opacity = Math.max(
                        0.04,
                        0.08 + shieldRatio * 0.14 + hitPulse * 0.18 + Math.sin(time * 9 + 1.5) * 0.05
                    );
                }
            }
        }
    }

    getFirstPersonCameraAnchor(out = null) {
        const target = out || new THREE.Vector3();
        if (this.firstPersonAnchor) {
            this.firstPersonAnchor.updateWorldMatrix(true, false);
            this.firstPersonAnchor.getWorldPosition(target);
            return target;
        }

        this.player.getDirection(this.player._tmpDir);
        return target.copy(this.player.position).add(this.player._tmpDir);
    }

    dispose() {
        if (this._vehicleLoadedTarget?.removeEventListener && this._onVehicleLoaded) {
            this._vehicleLoadedTarget.removeEventListener('loaded', this._onVehicleLoaded);
        }
        this._onVehicleLoaded = null;
        this._vehicleLoadedTarget = null;

        if (this.group) {
            if (this.renderer?.removeFromScene) {
                this.renderer.removeFromScene(this.group);
            }
            disposeObject3DResources(this.group);
        }

        this.vehicleMesh = null;
        this.shieldMesh = null;
        this.innerShield = null;
        this.firstPersonAnchor = null;
        this.flames = [];
        this.group = null;

        this.player.group = null;
        this.player.vehicleMesh = null;
        this.player.shieldMesh = null;
        this.player.firstPersonAnchor = null;
        this.player.flames = [];
    }
}

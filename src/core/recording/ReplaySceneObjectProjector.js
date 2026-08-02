import * as THREE from 'three';

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class ReplaySceneObjectProjector {
    constructor({
        root,
        particles = null,
        presentationKind = 'replay',
    } = {}) {
        this.root = root || null;
        this.particles = particles || null;
        this.presentationKind = String(presentationKind || 'replay');
        this.projectileProxies = [];
        this.powerupProxies = [];
        this.turretProxies = [];
        this.lastParticleFrame = null;
        this._tmpPosition = new THREE.Vector3();
        this._tmpDirection = new THREE.Vector3();
    }

    setParticles(particles) {
        this.particles = particles || null;
    }

    clear() {
        for (let index = 0; index < this.projectileProxies.length; index++) {
            this._disposeProxy(this.projectileProxies[index]);
        }
        for (let index = 0; index < this.powerupProxies.length; index++) {
            this._disposeProxy(this.powerupProxies[index]);
        }
        for (let index = 0; index < this.turretProxies.length; index++) {
            this._disposeProxy(this.turretProxies[index]);
        }
        this.projectileProxies.length = 0;
        this.powerupProxies.length = 0;
        this.turretProxies.length = 0;
        this.lastParticleFrame = null;
        this.particles?.clear?.();
    }

    _disposeProxy(proxy) {
        if (proxy?.parent) proxy.parent.remove(proxy);
        proxy?.geometry?.dispose?.();
        proxy?.material?.dispose?.();
        for (const geometry of proxy?.userData?.disposableGeometries || []) geometry?.dispose?.();
        for (const material of proxy?.userData?.disposableMaterials || []) material?.dispose?.();
    }

    _ensureProjectileProxy(index) {
        while (this.projectileProxies.length <= index) {
            const geometry = new THREE.CapsuleGeometry(0.15, 0.7, 3, 8);
            geometry.rotateX(Math.PI / 2);
            const material = new THREE.MeshStandardMaterial({
                color: 0xffaa33,
                emissive: 0xff6611,
                emissiveIntensity: 0.65,
                roughness: 0.3,
                metalness: 0.45,
            });
            const proxy = new THREE.Mesh(geometry, material);
            proxy.name = `${this.presentationKind}-projectile-${this.projectileProxies.length}`;
            proxy.visible = false;
            this.root?.add?.(proxy);
            this.projectileProxies.push(proxy);
        }
        return this.projectileProxies[index];
    }

    _ensurePowerupProxy(index) {
        while (this.powerupProxies.length <= index) {
            const geometry = new THREE.OctahedronGeometry(0.7, 0);
            const material = new THREE.MeshStandardMaterial({
                color: 0x66ddff,
                emissive: 0x2288aa,
                emissiveIntensity: 0.55,
                roughness: 0.25,
                metalness: 0.55,
                transparent: true,
                opacity: 0.9,
            });
            const proxy = new THREE.Mesh(geometry, material);
            proxy.name = `${this.presentationKind}-powerup-${this.powerupProxies.length}`;
            proxy.visible = false;
            this.root?.add?.(proxy);
            this.powerupProxies.push(proxy);
        }
        return this.powerupProxies[index];
    }

    _ensureTurretProxy(index) {
        while (this.turretProxies.length <= index) {
            const root = new THREE.Group();
            const baseGeometry = new THREE.CylinderGeometry(1.2, 1.6, 1.5, 10);
            const headGeometry = new THREE.SphereGeometry(0.9, 10, 8);
            const barrelGeometry = new THREE.CylinderGeometry(0.14, 0.2, 2.6, 8);
            barrelGeometry.rotateX(Math.PI / 2);
            const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x263746, metalness: 0.6, roughness: 0.55 });
            const weaponMaterial = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffb347, emissiveIntensity: 0.25 });
            const base = new THREE.Mesh(baseGeometry, baseMaterial);
            base.position.y = -0.75;
            root.add(base);
            const head = new THREE.Group();
            head.add(new THREE.Mesh(headGeometry, weaponMaterial));
            const barrel = new THREE.Mesh(barrelGeometry, weaponMaterial);
            barrel.position.z = 1.45;
            head.add(barrel);
            root.add(head);
            root.userData.head = head;
            root.userData.weaponMaterial = weaponMaterial;
            root.userData.disposableGeometries = [baseGeometry, headGeometry, barrelGeometry];
            root.userData.disposableMaterials = [baseMaterial, weaponMaterial];
            root.name = `${this.presentationKind}-turret-${this.turretProxies.length}`;
            root.visible = false;
            this.root?.add?.(root);
            this.turretProxies.push(root);
        }
        return this.turretProxies[index];
    }

    apply(previousFrame, nextFrame, alpha, elapsed) {
        this._applyProjectileFrames(previousFrame, nextFrame, alpha);
        this._applyPowerupFrames(previousFrame, nextFrame, alpha, elapsed);
        this._applyTurretFrames(previousFrame, nextFrame, alpha);
        const particleFrame = alpha < 0.5 ? previousFrame : nextFrame;
        if (particleFrame === this.lastParticleFrame) return;
        this.lastParticleFrame = particleFrame;
        this._applyParticleSnapshot(particleFrame?.particles);
    }

    _applyProjectileFrames(previousFrame, nextFrame, alpha) {
        const sourceFrame = alpha < 0.5 ? previousFrame : nextFrame;
        const sourceProjectiles = Array.isArray(sourceFrame?.projectiles)
            ? sourceFrame.projectiles
            : [];
        for (let index = 0; index < this.projectileProxies.length; index++) {
            this.projectileProxies[index].visible = false;
        }
        for (let index = 0; index < sourceProjectiles.length; index++) {
            const source = sourceProjectiles[index];
            const id = String(source?.id ?? index);
            const left = previousFrame?.projectileLookup?.[id] || source;
            const right = nextFrame?.projectileLookup?.[id] || source;
            const proxy = this._ensureProjectileProxy(index);
            proxy.visible = true;
            proxy.position.set(
                THREE.MathUtils.lerp(toFiniteNumber(left?.x), toFiniteNumber(right?.x), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.y), toFiniteNumber(right?.y), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.z), toFiniteNumber(right?.z), alpha)
            );
            this._tmpDirection.set(
                THREE.MathUtils.lerp(toFiniteNumber(left?.vx), toFiniteNumber(right?.vx), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.vy), toFiniteNumber(right?.vy), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.vz), toFiniteNumber(right?.vz), alpha)
            );
            if (this._tmpDirection.lengthSq() > 0.000001) {
                this._tmpPosition.copy(proxy.position).add(this._tmpDirection);
                proxy.lookAt(this._tmpPosition);
            }
            const radius = Math.max(0.08, toFiniteNumber(source?.radius, 0.18));
            proxy.scale.setScalar(Math.max(0.5, radius / 0.18));
            const color = Number.isFinite(Number(source?.color))
                ? Number(source.color)
                : (String(source?.type || '').toUpperCase().includes('ROCKET')
                    ? 0xff6633
                    : 0xffdd66);
            proxy.material.color.setHex(color);
            proxy.material.emissive.setHex(color);
        }
    }

    _applyPowerupFrames(previousFrame, nextFrame, alpha, elapsed) {
        const sourceFrame = alpha < 0.5 ? previousFrame : nextFrame;
        const sourcePowerups = Array.isArray(sourceFrame?.powerups) ? sourceFrame.powerups : [];
        for (let index = 0; index < this.powerupProxies.length; index++) {
            this.powerupProxies[index].visible = false;
        }
        for (let index = 0; index < sourcePowerups.length; index++) {
            const source = sourcePowerups[index];
            const id = String(source?.id ?? index);
            const left = previousFrame?.powerupLookup?.[id] || source;
            const right = nextFrame?.powerupLookup?.[id] || source;
            const proxy = this._ensurePowerupProxy(index);
            proxy.visible = source?.visible !== false;
            proxy.position.set(
                THREE.MathUtils.lerp(toFiniteNumber(left?.x), toFiniteNumber(right?.x), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.y), toFiniteNumber(right?.y), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.z), toFiniteNumber(right?.z), alpha)
            );
            proxy.rotation.y = Math.max(0, Number(elapsed) || 0) * 1.8 + index;
            const color = Number.isFinite(Number(source?.color)) ? Number(source.color) : 0x66ddff;
            proxy.material.color.setHex(color);
            proxy.material.emissive.setHex(color);
        }
    }

    _applyTurretFrames(previousFrame, nextFrame, alpha) {
        const sourceFrame = alpha < 0.5 ? previousFrame : nextFrame;
        const sourceTurrets = Array.isArray(sourceFrame?.turrets) ? sourceFrame.turrets : [];
        for (const proxy of this.turretProxies) proxy.visible = false;
        for (let index = 0; index < sourceTurrets.length; index++) {
            const source = sourceTurrets[index];
            const id = String(source?.id ?? index);
            const left = previousFrame?.turretLookup?.[id] || source;
            const right = nextFrame?.turretLookup?.[id] || source;
            const proxy = this._ensureTurretProxy(index);
            proxy.visible = true;
            proxy.position.set(
                THREE.MathUtils.lerp(toFiniteNumber(left?.x), toFiniteNumber(right?.x), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.y), toFiniteNumber(right?.y), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.z), toFiniteNumber(right?.z), alpha)
            );
            this._tmpDirection.set(
                THREE.MathUtils.lerp(toFiniteNumber(left?.ax, 1), toFiniteNumber(right?.ax, 1), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.ay), toFiniteNumber(right?.ay), alpha),
                THREE.MathUtils.lerp(toFiniteNumber(left?.az), toFiniteNumber(right?.az), alpha)
            );
            if (this._tmpDirection.lengthSq() > 0.000001) {
                this._tmpPosition.copy(proxy.position).add(this._tmpDirection);
                proxy.userData.head?.lookAt?.(this._tmpPosition);
            }
            const color = Math.trunc(toFiniteNumber(source?.color, source?.weapon === 'rocket' ? 0xff4d6d : 0xffb347));
            proxy.userData.weaponMaterial.color.setHex(color);
            proxy.userData.weaponMaterial.emissive.setHex(color);
        }
    }

    _applyParticleSnapshot(state) {
        const particles = this.particles;
        if (!particles || !state) return;
        const values = Array.isArray(state?.values) ? state.values : [];
        const count = Math.max(0, Math.min(
            Math.trunc(toFiniteNumber(state?.count, 0)),
            Math.trunc((particles.positions?.length || 0) / 3),
            Math.trunc(values.length / 13)
        ));
        particles.clear?.();
        particles.count = count;
        for (let index = 0; index < count; index++) {
            const dst3 = index * 3;
            const src = index * 13;
            particles.positions[dst3] = toFiniteNumber(values[src]);
            particles.positions[dst3 + 1] = toFiniteNumber(values[src + 1]);
            particles.positions[dst3 + 2] = toFiniteNumber(values[src + 2]);
            particles.velocities[dst3] = toFiniteNumber(values[src + 3]);
            particles.velocities[dst3 + 1] = toFiniteNumber(values[src + 4]);
            particles.velocities[dst3 + 2] = toFiniteNumber(values[src + 5]);
            particles.lifetimes[index] = Math.max(0.0001, toFiniteNumber(values[src + 6], 0.0001));
            particles.maxLifetimes[index] = Math.max(
                particles.lifetimes[index],
                toFiniteNumber(values[src + 7], particles.lifetimes[index])
            );
            particles.gravities[index] = toFiniteNumber(values[src + 8], -5);
            particles.scales[index] = Math.max(0.001, toFiniteNumber(values[src + 9], 0.1));
            particles.colors[dst3] = toFiniteNumber(values[src + 10], 1);
            particles.colors[dst3 + 1] = toFiniteNumber(values[src + 11], 1);
            particles.colors[dst3 + 2] = toFiniteNumber(values[src + 12], 1);
            if (particles.mesh?.setColorAt && particles._tmpColor?.setRGB) {
                particles._tmpColor.setRGB(
                    particles.colors[dst3],
                    particles.colors[dst3 + 1],
                    particles.colors[dst3 + 2]
                );
                particles.mesh.setColorAt(index, particles._tmpColor);
            }
        }
        particles.update?.(0);
        if (particles.mesh?.instanceColor) particles.mesh.instanceColor.needsUpdate = true;
    }

    getState() {
        return {
            projectileCount: this.projectileProxies.reduce(
                (count, proxy) => count + (proxy?.visible === true ? 1 : 0),
                0
            ),
            powerupCount: this.powerupProxies.reduce(
                (count, proxy) => count + (proxy?.visible === true ? 1 : 0),
                0
            ),
            turretCount: this.turretProxies.reduce(
                (count, proxy) => count + (proxy?.visible === true ? 1 : 0),
                0
            ),
            particleCount: Math.max(0, Number(this.particles?.count) || 0),
        };
    }
}

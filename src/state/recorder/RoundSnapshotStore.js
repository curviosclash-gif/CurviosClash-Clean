function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const MAX_REPLAY_PARTICLES = 192;
const PARTICLE_VALUE_STRIDE = 13;
const MAX_PARTICLE_VALUES = MAX_REPLAY_PARTICLES * PARTICLE_VALUE_STRIDE;

// capture() runs 20x per second for the whole round, so every allocation in it lands in the
// young generation and buys a GC pause. Shared for the "source has no such list" branches,
// which used to hand out a fresh [] on every call.
const EMPTY_LIST = Object.freeze([]);

function toCaptureList(value) {
    return Array.isArray(value) ? value : EMPTY_LIST;
}

export class RoundSnapshotStore {
    constructor({ maxSnapshots = 900, timeProvider = null } = {}) {
        this.maxSnapshots = Math.max(1, Number(maxSnapshots) || 900);
        this.timeProvider = typeof timeProvider === 'function' ? timeProvider : (() => 0);
        this.snapshots = new Array(this.maxSnapshots);
        for (let i = 0; i < this.maxSnapshots; i++) {
            this.snapshots[i] = {
                time: 0,
                playerCount: 0,
                players: [],
                projectileCount: 0,
                projectiles: [],
                powerupCount: 0,
                powerups: [],
                turretCount: 0,
                turrets: [],
                particleCount: 0,
                // Grown to its final size on first use and never shrunk again - see capture().
                particleValues: new Float32Array(0),
            };
        }
        this.snapshotIndex = 0;
        this.snapshotCount = 0;

        /** @internal Pre-allocated output buffer for getOrderedSnapshots() */
        this._orderedBuf = [];
        /** @internal Reusable view array returned by getOrderedSnapshots() (avoids .slice() alloc) */
        this._viewBuf = [];
    }

    reset() {
        this.snapshotIndex = 0;
        this.snapshotCount = 0;
    }

    capture(source) {
        const entityManager = Array.isArray(source) ? null : source;
        const players = Array.isArray(source)
            ? source
            : (Array.isArray(entityManager?.players) ? entityManager.players : []);
        const snap = this.snapshots[this.snapshotIndex];
        snap.time = this.timeProvider();
        snap.playerCount = players.length;

        while (snap.players.length < players.length) {
            snap.players.push({
                idx: 0,
                alive: false,
                x: 0,
                y: 0,
                z: 0,
                qx: 0,
                qy: 0,
                qz: 0,
                qw: 1,
                bot: false,
                trailWidth: 0.6,
                trailInGap: false,
            });
        }

        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            const s = snap.players[i];
            s.idx = p.index;
            s.alive = p.alive;
            s.x = Math.round(p.position.x * 10) / 10;
            s.y = Math.round(p.position.y * 10) / 10;
            s.z = Math.round(p.position.z * 10) / 10;
            s.qx = Math.round(p.quaternion.x * 10000) / 10000;
            s.qy = Math.round(p.quaternion.y * 10000) / 10000;
            s.qz = Math.round(p.quaternion.z * 10000) / 10000;
            s.qw = Math.round(p.quaternion.w * 10000) / 10000;
            s.bot = p.isBot;
            s.trailWidth = Math.max(0.01, toFiniteNumber(p?.trail?.width, 0.6));
            s.trailInGap = p?.trail?.inGap === true;
        }

        const projectiles = toCaptureList(entityManager?.projectiles);
        snap.projectileCount = 0;
        for (let i = 0; i < projectiles.length; i++) {
            const projectile = projectiles[i];
            if (!projectile || projectile.active === false) continue;
            while (snap.projectiles.length <= snap.projectileCount) {
                snap.projectiles.push({
                    id: '', type: '', owner: -1, color: 0xffffff,
                    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0,
                });
            }
            const out = snap.projectiles[snap.projectileCount++];
            out.id = String(projectile.id || projectile.networkId || projectile.traversalId || `projectile:${i}`);
            out.type = String(projectile.type || 'mg');
            out.owner = Number.isInteger(projectile.ownerIndex)
                ? projectile.ownerIndex
                : (Number.isInteger(projectile.owner?.index) ? projectile.owner.index : -1);
            out.color = Math.trunc(toFiniteNumber(
                projectile.color
                ?? projectile.owner?.color
                ?? entityManager?.entityRuntimeConfig?.POWERUP?.TYPES?.[projectile.type]?.color,
                0xffffff
            ));
            out.x = toFiniteNumber(projectile.position?.x);
            out.y = toFiniteNumber(projectile.position?.y);
            out.z = toFiniteNumber(projectile.position?.z);
            out.vx = toFiniteNumber(projectile.velocity?.x);
            out.vy = toFiniteNumber(projectile.velocity?.y);
            out.vz = toFiniteNumber(projectile.velocity?.z);
            out.radius = Math.max(0, toFiniteNumber(projectile.radius));
        }

        const powerups = toCaptureList(entityManager?.powerupManager?.items);
        snap.powerupCount = 0;
        for (let i = 0; i < powerups.length; i++) {
            const powerup = powerups[i];
            if (!powerup || powerup.active === false) continue;
            while (snap.powerups.length <= snap.powerupCount) {
                snap.powerups.push({
                    id: '', type: '', color: 0xffffff,
                    x: 0, y: 0, z: 0, visible: true,
                });
            }
            const out = snap.powerups[snap.powerupCount++];
            out.id = String(powerup.id || powerup.networkId || `powerup:${i}`);
            out.type = String(powerup.type || '');
            out.color = Math.trunc(toFiniteNumber(
                entityManager?.entityRuntimeConfig?.POWERUP?.TYPES?.[powerup.type]?.color,
                0xffffff
            ));
            out.x = toFiniteNumber(powerup.position?.x ?? powerup.mesh?.position?.x);
            out.y = toFiniteNumber(powerup.baseY ?? powerup.position?.y ?? powerup.mesh?.position?.y);
            out.z = toFiniteNumber(powerup.position?.z ?? powerup.mesh?.position?.z);
            out.visible = powerup.mesh?.visible !== false;
        }

        const turrets = toCaptureList(entityManager?._staticTurretSystem?.turrets);
        snap.turretCount = 0;
        for (let i = 0; i < turrets.length; i++) {
            const turret = turrets[i];
            if (!turret || turret.hp <= 0) continue;
            while (snap.turrets.length <= snap.turretCount) snap.turrets.push({});
            const out = snap.turrets[snap.turretCount++];
            out.id = String(turret.id || `turret:${i}`);
            out.weapon = String(turret.weapon || 'mg');
            out.rocketType = String(turret.rocketType || 'ROCKET_WEAK');
            out.owner = Number.isInteger(turret.ownerIndex) ? turret.ownerIndex : -1;
            out.deployed = turret.deployed === true;
            out.x = toFiniteNumber(turret.position?.x);
            out.y = toFiniteNumber(turret.position?.y);
            out.z = toFiniteNumber(turret.position?.z);
            out.ax = toFiniteNumber(turret.aimDirection?.x, 1);
            out.ay = toFiniteNumber(turret.aimDirection?.y);
            out.az = toFiniteNumber(turret.aimDirection?.z);
            out.hp = toFiniteNumber(turret.hp, -1);
            out.maxHp = toFiniteNumber(turret.maxHp, -1);
            out.ttl = Number.isFinite(turret.expiresRemaining) ? Math.max(0, turret.expiresRemaining) : -1;
            out.color = Math.trunc(toFiniteNumber(turret.ownerPlayer?.color, 0xffb347));
        }

        const particles = entityManager?.particles;
        snap.particleCount = Math.min(
            MAX_REPLAY_PARTICLES,
            Math.max(0, Math.trunc(toFiniteNumber(particles?.count)))
        );
        const particleValueCount = snap.particleCount * PARTICLE_VALUE_STRIDE;
        // The previous plain array was grown with push() and then truncated via .length on
        // every single capture. With the particle count swinging between 0 and the cap that
        // reallocated the backing store 20 times a second, per ring slot - the dominant
        // source of the GC pauses measured in fight mode. A typed array of the maximum size
        // is allocated once per slot and then only ever written into. Float32 is well beyond
        // what a replay needs; positions are already rounded elsewhere.
        if (!ArrayBuffer.isView(snap.particleValues) || snap.particleValues.length < particleValueCount) {
            snap.particleValues = new Float32Array(MAX_PARTICLE_VALUES);
        }
        for (let i = 0; i < snap.particleCount; i++) {
            const src3 = i * 3;
            const dst = i * PARTICLE_VALUE_STRIDE;
            snap.particleValues[dst] = toFiniteNumber(particles?.positions?.[src3]);
            snap.particleValues[dst + 1] = toFiniteNumber(particles?.positions?.[src3 + 1]);
            snap.particleValues[dst + 2] = toFiniteNumber(particles?.positions?.[src3 + 2]);
            snap.particleValues[dst + 3] = toFiniteNumber(particles?.velocities?.[src3]);
            snap.particleValues[dst + 4] = toFiniteNumber(particles?.velocities?.[src3 + 1]);
            snap.particleValues[dst + 5] = toFiniteNumber(particles?.velocities?.[src3 + 2]);
            snap.particleValues[dst + 6] = Math.max(0, toFiniteNumber(particles?.lifetimes?.[i]));
            snap.particleValues[dst + 7] = Math.max(
                snap.particleValues[dst + 6],
                toFiniteNumber(particles?.maxLifetimes?.[i], snap.particleValues[dst + 6])
            );
            snap.particleValues[dst + 8] = toFiniteNumber(particles?.gravities?.[i], -5);
            snap.particleValues[dst + 9] = Math.max(0, toFiniteNumber(particles?.scales?.[i]));
            snap.particleValues[dst + 10] = toFiniteNumber(particles?.colors?.[src3], 1);
            snap.particleValues[dst + 11] = toFiniteNumber(particles?.colors?.[src3 + 1], 1);
            snap.particleValues[dst + 12] = toFiniteNumber(particles?.colors?.[src3 + 2], 1);
        }

        this.snapshotIndex = (this.snapshotIndex + 1) % this.maxSnapshots;
        if (this.snapshotCount < this.maxSnapshots) this.snapshotCount++;
    }

    getOrderedSnapshots(limit = null) {
        const totalCount = limit == null
            ? this.snapshotCount
            : Math.min(this.snapshotCount, Math.max(1, Number(limit) || 1));
        const snapStart = this.snapshotCount >= this.maxSnapshots ? this.snapshotIndex : 0;
        const offset = Math.max(0, this.snapshotCount - totalCount);

        // Grow output buffer on demand (never shrink — avoids GC)
        while (this._orderedBuf.length < totalCount) {
            this._orderedBuf.push({
                time: 0,
                players: [],
                projectiles: [],
                powerups: [],
                turrets: [],
                particles: { count: 0, values: [] },
            });
        }

        for (let i = 0; i < totalCount; i++) {
            const idx = (snapStart + offset + i) % this.maxSnapshots;
            const snapshot = this.snapshots[idx];
            const playerCount = Math.max(0, Number(snapshot?.playerCount) || 0);
            const out = this._orderedBuf[i];
            out.time = Number(snapshot?.time) || 0;

            // Grow player slots on demand
            while (out.players.length < playerCount) {
                out.players.push({ idx: 0, alive: false, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, bot: false });
            }
            out.players.length = playerCount;

            for (let j = 0; j < playerCount; j++) {
                const player = snapshot.players[j];
                const op = out.players[j];
                op.idx = Number(player?.idx) || 0;
                op.alive = !!player?.alive;
                op.x = Number(player?.x) || 0;
                op.y = Number(player?.y) || 0;
                op.z = Number(player?.z) || 0;
                op.qx = Number(player?.qx) || 0;
                op.qy = Number(player?.qy) || 0;
                op.qz = Number(player?.qz) || 0;
                op.qw = toFiniteNumber(player?.qw, 1);
                op.bot = !!player?.bot;
                op.trailWidth = Math.max(0.01, toFiniteNumber(player?.trailWidth, 0.6));
                op.trailInGap = player?.trailInGap === true;
            }

            const projectileCount = Math.max(0, Number(snapshot?.projectileCount) || 0);
            while (out.projectiles.length < projectileCount) out.projectiles.push({});
            out.projectiles.length = projectileCount;
            for (let j = 0; j < projectileCount; j++) {
                Object.assign(out.projectiles[j], snapshot.projectiles[j]);
            }

            const powerupCount = Math.max(0, Number(snapshot?.powerupCount) || 0);
            while (out.powerups.length < powerupCount) out.powerups.push({});
            out.powerups.length = powerupCount;
            for (let j = 0; j < powerupCount; j++) {
                Object.assign(out.powerups[j], snapshot.powerups[j]);
            }

            const turretCount = Math.max(0, Number(snapshot?.turretCount) || 0);
            while (out.turrets.length < turretCount) out.turrets.push({});
            out.turrets.length = turretCount;
            for (let j = 0; j < turretCount; j++) {
                Object.assign(out.turrets[j], snapshot.turrets[j]);
            }

            const particleCount = Math.max(0, Number(snapshot?.particleCount) || 0);
            const particleValueCount = particleCount * PARTICLE_VALUE_STRIDE;
            out.particles.count = particleCount;
            while (out.particles.values.length < particleValueCount) out.particles.values.push(0);
            out.particles.values.length = particleValueCount;
            for (let j = 0; j < particleValueCount; j++) {
                out.particles.values[j] = toFiniteNumber(snapshot?.particleValues?.[j]);
            }
        }

        // Reuse view buffer instead of .slice() to avoid per-call allocation
        for (let i = 0; i < totalCount; i++) {
            this._viewBuf[i] = this._orderedBuf[i];
        }
        this._viewBuf.length = totalCount;
        return this._viewBuf;
    }

    getRecentSnapshotTable(limit = 20) {
        const snapList = [];
        const snapshots = this.getOrderedSnapshots(limit);
        for (let i = 0; i < snapshots.length; i++) {
            const s = snapshots[i];
            const playerStr = s.players
                .filter((p) => p.idx !== undefined)
                .map((p) => `${p.bot ? 'Bot' : 'P'}${p.idx}:${p.alive ? 'alive' : 'dead'}(${p.x},${p.y},${p.z})`)
                .join(' | ');
            snapList.push({ time: `${Math.round(s.time * 100) / 100}s`, players: playerStr });
        }
        return snapList;
    }
}

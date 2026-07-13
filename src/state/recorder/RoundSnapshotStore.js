function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class RoundSnapshotStore {
    constructor({ maxSnapshots = 900, timeProvider = null } = {}) {
        this.maxSnapshots = Math.max(1, Number(maxSnapshots) || 900);
        this.timeProvider = typeof timeProvider === 'function' ? timeProvider : (() => 0);
        this.snapshots = new Array(this.maxSnapshots);
        for (let i = 0; i < this.maxSnapshots; i++) {
            this.snapshots[i] = { time: 0, playerCount: 0, players: [] };
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

    capture(players) {
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
            this._orderedBuf.push({ time: 0, players: [] });
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

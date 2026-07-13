export class ParcoursMinimapRenderer {
    constructor() {
        this._canvas = null;
        this._ctx = null;
        this._visible = true;
        this._onKeyDown = null;
        this._lastRouteId = null;
        this._cpById = null;
    }

    _ensureCanvas() {
        if (this._canvas) return;
        const canvas = document.createElement('canvas');
        canvas.id = 'parcours-minimap';
        canvas.width = 200;
        canvas.height = 200;
        document.body.appendChild(canvas);
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');

        this._onKeyDown = (e) => {
            if (e.code === 'KeyM' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                this._visible = !this._visible;
                this._canvas.style.display = this._visible ? 'block' : 'none';
            }
        };
        window.addEventListener('keydown', this._onKeyDown);
    }

    _hide() {
        if (this._canvas) this._canvas.style.display = 'none';
    }

    update(routeSnapshot, nextCheckpointIndex, passedCheckpointIds = [], playerPos, playerQuat) {
        if (!routeSnapshot?.enabled) {
            this._hide();
            return;
        }

        this._ensureCanvas();
        if (!this._visible) return;
        this._canvas.style.display = 'block';

        const ctx = this._ctx;
        const W = 200;
        const H = 200;
        const PAD = 16;
        const innerW = W - PAD * 2;
        const innerH = H - PAD * 2;

        if (this._lastRouteId !== routeSnapshot.routeId) {
            this._lastRouteId = routeSnapshot.routeId;
            this._cpById = new Map();
            for (const cp of routeSnapshot.checkpoints) {
                this._cpById.set(cp.id, cp);
            }
            if (routeSnapshot.finish) {
                this._cpById.set(routeSnapshot.finish.id, routeSnapshot.finish);
            }
        }

        const allPositions = [];
        for (const cp of routeSnapshot.checkpoints) {
            allPositions.push([cp.pos[0], cp.pos[2]]);
        }
        if (routeSnapshot.finish) {
            allPositions.push([routeSnapshot.finish.pos[0], routeSnapshot.finish.pos[2]]);
        }
        if (playerPos) {
            allPositions.push([playerPos.x, playerPos.z]);
        }

        if (allPositions.length === 0) return;

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [x, z] of allPositions) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        const rangeX = Math.max(1, maxX - minX);
        const rangeZ = Math.max(1, maxZ - minZ);
        const scale = Math.min(innerW / rangeX, innerH / rangeZ);
        const offsetX = PAD + (innerW - rangeX * scale) / 2;
        const offsetZ = PAD + (innerH - rangeZ * scale) / 2;

        const toCanvas = (wx, wz) => [
            offsetX + (wx - minX) * scale,
            offsetZ + (wz - minZ) * scale,
        ];

        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(0, 0, W, H, 8);
        } else {
            ctx.rect(0, 0, W, H);
        }
        ctx.fill();

        const nextIdx = Math.max(0, nextCheckpointIndex || 0);
        const passedCheckpointIdSet = new Set(
            Array.isArray(passedCheckpointIds)
                ? passedCheckpointIds.map((checkpointId) => String(checkpointId || '').trim()).filter(Boolean)
                : []
        );

        // Connection lines between checkpoints
        for (const cp of routeSnapshot.checkpoints) {
            const [x1, z1] = toCanvas(cp.pos[0], cp.pos[2]);
            const isBranchLine = cp.isBranchOption === true;
            ctx.strokeStyle = isBranchLine ? 'rgba(0,200,255,0.4)' : 'rgba(180,180,180,0.5)';
            ctx.lineWidth = 1.5;
            for (const nextId of (cp.nextCheckpointIds || [])) {
                const next = this._cpById?.get(nextId);
                if (!next) continue;
                const [x2, z2] = toCanvas(next.pos[0], next.pos[2]);
                ctx.beginPath();
                ctx.moveTo(x1, z1);
                ctx.lineTo(x2, z2);
                ctx.stroke();
            }
        }

        // Line from last checkpoint to finish
        if (routeSnapshot.finish && routeSnapshot.checkpoints.length > 0) {
            const lastCp = routeSnapshot.checkpoints[routeSnapshot.checkpoints.length - 1];
            const [x1, z1] = toCanvas(lastCp.pos[0], lastCp.pos[2]);
            const [x2, z2] = toCanvas(routeSnapshot.finish.pos[0], routeSnapshot.finish.pos[2]);
            ctx.strokeStyle = 'rgba(255,215,0,0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x1, z1);
            ctx.lineTo(x2, z2);
            ctx.stroke();
        }

        // Checkpoint dots
        for (const cp of routeSnapshot.checkpoints) {
            const [cx, cz] = toCanvas(cp.pos[0], cp.pos[2]);
            const isPassed = passedCheckpointIdSet.has(cp.id);
            const isNext = cp.routeIndex === nextIdx;
            const isBranch = cp.isBranchOption === true;

            let color;
            if (isPassed) {
                color = '#00cc00';
            } else if (isBranch) {
                color = '#00e5ff';
            } else if (isNext) {
                color = '#aaff00';
            } else {
                color = '#666666';
            }

            const r = isNext ? 5 : 4;
            ctx.beginPath();
            ctx.arc(cx, cz, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            if (isNext) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Finish ring
        if (routeSnapshot.finish) {
            const [fx, fz] = toCanvas(routeSnapshot.finish.pos[0], routeSnapshot.finish.pos[2]);
            const isFinished = nextIdx >= routeSnapshot.totalCheckpoints;
            ctx.beginPath();
            ctx.arc(fx, fz, 5, 0, Math.PI * 2);
            ctx.fillStyle = isFinished ? '#ffd700' : '#bb8800';
            ctx.fill();
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Player arrow
        if (playerPos) {
            const [px, pz] = toCanvas(playerPos.x, playerPos.z);
            ctx.save();
            ctx.translate(px, pz);

            let yaw = 0;
            if (playerQuat) {
                yaw = Math.atan2(
                    2 * (playerQuat.y * playerQuat.w + playerQuat.x * playerQuat.z),
                    1 - 2 * (playerQuat.y * playerQuat.y + playerQuat.z * playerQuat.z)
                );
            }
            ctx.rotate(yaw);

            ctx.beginPath();
            ctx.moveTo(0, -7);
            ctx.lineTo(-4, 5);
            ctx.lineTo(0, 2);
            ctx.lineTo(4, 5);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            ctx.restore();
        }
    }

    dispose() {
        if (this._onKeyDown) {
            window.removeEventListener('keydown', this._onKeyDown);
            this._onKeyDown = null;
        }
        if (this._canvas?.parentElement) {
            this._canvas.parentElement.removeChild(this._canvas);
        }
        this._canvas = null;
        this._ctx = null;
        this._cpById = null;
        this._lastRouteId = null;
    }
}

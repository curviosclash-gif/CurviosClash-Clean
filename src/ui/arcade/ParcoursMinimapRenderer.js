// Der Minimap-Hotkey hoert global mit. Wer gerade in ein Eingabefeld tippt, meint den
// Buchstaben und nicht den Schalter - solche Tastendruecke gehoeren dem Feld.
function isTextEntryEventTarget(target) {
    if (!target || typeof target !== 'object') return false;
    if (target.isContentEditable === true) return true;
    const tagName = String(target.tagName || '').toUpperCase();
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export class ParcoursMinimapRenderer {
    constructor() {
        this._canvas = null;
        this._ctx = null;
        this._visible = true;
        // Der Keydown-Listener ueberlebt das Match. Nur solange eine Route gezeichnet wird,
        // darf M die Karte umschalten - im Menue gehoert der Buchstabe der Menuesteuerung.
        this._routeActive = false;
        this._onKeyDown = null;
        this._lastRouteId = null;
        this._cpById = null;
        this._cpByRouteIndex = null;
        this._routeBounds = null;
        this._passedCheckpointIds = new Set();
        this._transformMinX = 0;
        this._transformMinZ = 0;
        this._transformScale = 1;
        this._transformOffsetX = 0;
        this._transformOffsetZ = 0;
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
            if (e.code !== 'KeyM' || e.ctrlKey || e.altKey || e.metaKey) return;
            if (!this._routeActive) return;
            if (isTextEntryEventTarget(e.target)) return;
            this._visible = !this._visible;
            this._canvas.style.display = this._visible ? 'block' : 'none';
        };
        window.addEventListener('keydown', this._onKeyDown);
    }

    _hide() {
        this._routeActive = false;
        if (this._canvas) this._canvas.style.display = 'none';
    }

    _refreshRouteCache(routeSnapshot) {
        this._lastRouteId = routeSnapshot.routeId;
        this._cpById = new Map();
        this._cpByRouteIndex = new Map();
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        const include = (entry) => {
            const x = Number(entry?.pos?.[0]) || 0;
            const z = Number(entry?.pos?.[2]) || 0;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        };
        for (const cp of routeSnapshot.checkpoints) {
            this._cpById.set(cp.id, cp);
            this._cpByRouteIndex.set(cp.routeIndex, cp);
            include(cp);
        }
        if (routeSnapshot.finish) {
            this._cpById.set(routeSnapshot.finish.id, routeSnapshot.finish);
            include(routeSnapshot.finish);
        }
        this._routeBounds = Number.isFinite(minX)
            ? { minX, maxX, minZ, maxZ }
            : null;
    }

    _toCanvasX(worldX) {
        return this._transformOffsetX + (worldX - this._transformMinX) * this._transformScale;
    }

    _toCanvasZ(worldZ) {
        return this._transformOffsetZ + (worldZ - this._transformMinZ) * this._transformScale;
    }

    update(routeSnapshot, nextCheckpointIndex, passedCheckpointIds = [], playerPos, playerQuat) {
        if (!routeSnapshot?.enabled) {
            this._hide();
            return;
        }

        this._ensureCanvas();
        this._routeActive = true;
        if (!this._visible) return;
        this._canvas.style.display = 'block';

        const ctx = this._ctx;
        const W = 200;
        const H = 200;
        const PAD = 16;
        const innerW = W - PAD * 2;
        const innerH = H - PAD * 2;

        if (this._lastRouteId !== routeSnapshot.routeId) {
            this._refreshRouteCache(routeSnapshot);
        }

        if (!this._routeBounds) return;
        let { minX, maxX, minZ, maxZ } = this._routeBounds;
        if (playerPos) {
            minX = Math.min(minX, playerPos.x);
            maxX = Math.max(maxX, playerPos.x);
            minZ = Math.min(minZ, playerPos.z);
            maxZ = Math.max(maxZ, playerPos.z);
        }

        const rangeX = Math.max(1, maxX - minX);
        const rangeZ = Math.max(1, maxZ - minZ);
        const scale = Math.min(innerW / rangeX, innerH / rangeZ);
        const offsetX = PAD + (innerW - rangeX * scale) / 2;
        const offsetZ = PAD + (innerH - rangeZ * scale) / 2;

        this._transformMinX = minX;
        this._transformMinZ = minZ;
        this._transformScale = scale;
        this._transformOffsetX = offsetX;
        this._transformOffsetZ = offsetZ;

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
        const passedCheckpointIdSet = this._passedCheckpointIds;
        passedCheckpointIdSet.clear();
        if (Array.isArray(passedCheckpointIds)) {
            for (const checkpointId of passedCheckpointIds) {
                const normalizedId = String(checkpointId || '').trim();
                if (normalizedId) passedCheckpointIdSet.add(normalizedId);
            }
        }

        // Connection lines between checkpoints
        for (const cp of routeSnapshot.checkpoints) {
            const x1 = this._toCanvasX(cp.pos[0]);
            const z1 = this._toCanvasZ(cp.pos[2]);
            const isBranchLine = cp.isBranchOption === true;
            ctx.strokeStyle = isBranchLine ? 'rgba(0,200,255,0.4)' : 'rgba(180,180,180,0.5)';
            ctx.lineWidth = 1.5;
            for (const nextId of (cp.nextCheckpointIds || [])) {
                const next = this._cpById?.get(nextId);
                if (!next) continue;
                const x2 = this._toCanvasX(next.pos[0]);
                const z2 = this._toCanvasZ(next.pos[2]);
                ctx.beginPath();
                ctx.moveTo(x1, z1);
                ctx.lineTo(x2, z2);
                ctx.stroke();
            }
        }

        // Line from last checkpoint to finish
        if (routeSnapshot.finish && routeSnapshot.checkpoints.length > 0) {
            const lastCp = routeSnapshot.checkpoints[routeSnapshot.checkpoints.length - 1];
            const x1 = this._toCanvasX(lastCp.pos[0]);
            const z1 = this._toCanvasZ(lastCp.pos[2]);
            const x2 = this._toCanvasX(routeSnapshot.finish.pos[0]);
            const z2 = this._toCanvasZ(routeSnapshot.finish.pos[2]);
            ctx.strokeStyle = 'rgba(255,215,0,0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x1, z1);
            ctx.lineTo(x2, z2);
            ctx.stroke();
        }

        // Checkpoint dots
        for (const cp of routeSnapshot.checkpoints) {
            const cx = this._toCanvasX(cp.pos[0]);
            const cz = this._toCanvasZ(cp.pos[2]);
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
            const fx = this._toCanvasX(routeSnapshot.finish.pos[0]);
            const fz = this._toCanvasZ(routeSnapshot.finish.pos[2]);
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
            const px = this._toCanvasX(playerPos.x);
            const pz = this._toCanvasZ(playerPos.z);
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

        const nextTarget = this._cpByRouteIndex?.get(nextIdx)
            || (nextIdx >= routeSnapshot.totalCheckpoints ? routeSnapshot.finish : null);
        if (playerPos && nextTarget?.pos) {
            const heightDelta = Math.round((Number(nextTarget.pos[1]) || 0) - (Number(playerPos.y) || 0));
            if (Math.abs(heightDelta) >= 1) {
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(`${heightDelta > 0 ? '\u2191' : '\u2193'} ${Math.abs(heightDelta)} m`, W - 8, H - 7);
            }
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
        this._routeActive = false;
        this._canvas = null;
        this._ctx = null;
        this._cpById = null;
        this._cpByRouteIndex = null;
        this._routeBounds = null;
        this._passedCheckpointIds.clear();
        this._lastRouteId = null;
    }
}

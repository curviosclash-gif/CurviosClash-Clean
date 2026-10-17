import { resolveEndlessCourseCenter } from './EndlessParcoursConnectors.js';
import { ENDLESS_COURSE_SHELL as SHELL } from './EndlessParcoursShell.js';

/** Optional arena source, owned by one runtime. Querying it creates no per-tick objects. */
export class EndlessParcoursExclusionZone {
    constructor(runtime) {
        this.runtime = runtime;
        this.graceSeconds = 3;
        this._center = { x: 0, y: 0 };
    }

    getPlayerSpeed(player) { return player?.baseSpeed; }

    isOutside(player, hysteresis = 0) {
        if (this.runtime._disposed || this.runtime._finalized) return false;
        const p = player?.position;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
        const radius = Math.max(0, Number(player.hitboxRadius) || 0);
        const halfWidth = SHELL.halfWidth + SHELL.wallThickness * 0.5;
        const minY = Math.min(SHELL.floorY - SHELL.floorThickness * 0.5, SHELL.wallBottom);
        const maxY = SHELL.wallBottom + SHELL.wallHeight;
        // The shell consists of overlapping boxes. Use their union, including seam overlaps,
        // instead of treating the smoother mathematical centreline as the visible wall.
        for (const { module } of this.runtime.activeModules.values()) {
            const segmentLength = module.length / SHELL.segments;
            const halfLength = segmentLength * SHELL.segmentOverlap * 0.5;
            for (let segment = 0; segment < SHELL.segments; segment++) {
                const t = (segment + 0.5) / SHELL.segments;
                const z = module.originZ + module.length * t;
                if (p.z + radius < z - halfLength + hysteresis || p.z - radius > z + halfLength - hysteresis) continue;
                const center = resolveEndlessCourseCenter(module.entryDrift, module.exitDrift, t, this._center);
                if (p.x + radius < center.x - halfWidth + hysteresis
                    || p.x - radius > center.x + halfWidth - hysteresis
                    || p.y + radius < center.y + minY + hysteresis
                    || p.y - radius > center.y + maxY - hysteresis) continue;
                return false;
            }
        }
        return true;
    }
}

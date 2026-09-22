import * as THREE from 'three';
import { resolveMapLighting } from '../../shared/contracts/MapLightingContract.js';
import { resolveMapFireProgress } from '../../shared/contracts/MapFireProgressionContract.js';
import { resolveGlbModelRoot } from './GlbModelVisibilityOps.js';

// Reuses one resolved profile and its colour scratch objects throughout the round.
export class MapFireEvolutionController {
    constructor(arena) {
        this.arena = arena;
        this.clear();
    }
    build(map) {
        this.clear();
        if (!map?.fireProgression) return;
        this.definition = map.fireProgression;
        this.day = resolveMapLighting(map.lighting);
        this.fire = resolveMapLighting(this.definition.lighting);
        this.profile = structuredClone(this.day);
        this.channels = [];
        const collect = (out, from, to) => {
            for (const key of Object.keys(from)) {
                if (typeof from[key] === 'number' && typeof to[key] === 'number') {
                    this.channels.push({ out, key, from: from[key], to: to[key],
                        colorA: /color/i.test(key) ? new THREE.Color(from[key]) : null,
                        colorB: /color/i.test(key) ? new THREE.Color(to[key]) : null });
                } else if (from[key] && typeof from[key] === 'object') collect(out[key], from[key], to[key] || from[key]);
            }
        };
        collect(this.profile, this.day, this.fire);
        this.color = new THREE.Color();
    }
    setState(state) { this.state = state; }
    update(elapsed) {
        if (!this.definition) return;
        const progress = resolveMapFireProgress(this.definition, this.state);
        this.arena.mapFireProgress = progress;
        const builder = this.arena._builder;
        builder.fireFxController.setIntensity(progress);
        const lastFire = this.state?.segments.find((entry) => entry.id === 'transept');
        const fireAt = lastFire?.brokenAt ?? -1;
        const hazardTime = fireAt >= 0 ? Math.max(0, elapsed - fireAt) : -1;
        this.arena.mapFireHazardTime = hazardTime;
        if (builder.mapHazardVisualController.group) builder.mapHazardVisualController.group.visible = hazardTime >= 0;
        if (hazardTime >= 0) builder.mapHazardVisualController.update(hazardTime);
        const skyProgress = this.state?.skyProgress || 0;
        if (skyProgress !== this.lastProgress) {
            for (const channel of this.channels) {
                channel.out[channel.key] = channel.colorA
                    ? this.color.copy(channel.colorA).lerp(channel.colorB, skyProgress).getHex()
                    : channel.from + (channel.to - channel.from) * skyProgress;
            }
            this.arena.renderer?.updateMapFireLighting?.(this.profile);
            this.lastProgress = skyProgress;
        }
        // Keep authored machinery brace colliders in the same state as its visible models.
        const roof = this.state?.segments[0];
        const removeFrames = roof?.brokenAt >= 0;
        const obstacles = this.arena._staticStreamingSnapshot?.obstacles || this.arena.obstacles;
        if (obstacles && removeFrames !== this.framesRemoved) {
            if (removeFrames) {
                const ids = this.definition.siteFrameIds;
                this.frames = obstacles.filter((item) => ids.includes(item.id) || ids.includes(item.sourceId));
                const removed = new Set(this.frames);
                let write = 0;
                for (const item of obstacles) if (!removed.has(item)) obstacles[write++] = item;
                obstacles.length = write;
            } else for (const frame of this.frames) if (!obstacles.includes(frame)) obstacles.push(frame);
            this.framesRemoved = removeFrames;
            this.arena.staticCollisionRevision = (this.arena.staticCollisionRevision || 0) + 1;
        }
        for (let i = 0; i < (this.state?.segments.length || 0); i += 1) {
            const segment = this.state.segments[i];
            const modelId = this.arena.currentMapDefinition.destructibles.breakScenes[i].hideModelIds[0];
            const root = resolveGlbModelRoot(this.arena, modelId);
            if (!root) continue;
            if (!this.restPositions.has(root)) this.restPositions.set(root, root.position.x);
            root.position.x = this.restPositions.get(root);
            if (segment.warningAt >= 0 && segment.brokenAt < 0) root.position.x += Math.sin(elapsed * 35) * 0.06;
        }
    }
    clear() {
        const obstacles = this.arena._staticStreamingSnapshot?.obstacles || this.arena.obstacles;
        if (obstacles && this.framesRemoved) {
            for (const frame of this.frames) if (!obstacles.includes(frame)) obstacles.push(frame);
            this.arena.staticCollisionRevision = (this.arena.staticCollisionRevision || 0) + 1;
        }
        if (this.restPositions) for (const [root, x] of this.restPositions) root.position.x = x;
        this.definition = null;
        this.state = null;
        this.channels = [];
        this.frames = [];
        this.framesRemoved = false;
        this.restPositions = new Map();
        this.lastProgress = -1;
        this.arena.mapFireProgress = null;
        this.arena.mapFireHazardTime = null;
    }
}

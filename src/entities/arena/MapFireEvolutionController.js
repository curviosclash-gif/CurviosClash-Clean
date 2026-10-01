import * as THREE from 'three';
import { resolveMapLighting } from '../../shared/contracts/MapLightingContract.js';
import { resolveMapFireProgress } from '../../shared/contracts/MapFireProgressionContract.js';
import { resolveGlbModelRoot } from './GlbModelVisibilityOps.js';

const FIRE_LIGHTING_STEPS = 20;

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
        const lightingStep = Math.round(skyProgress * FIRE_LIGHTING_STEPS);
        if (lightingStep !== this.lastLightingStep) {
            const lightingProgress = lightingStep / FIRE_LIGHTING_STEPS;
            for (const channel of this.channels) {
                channel.out[channel.key] = lightingStep === 0
                    ? channel.from
                    : lightingStep === FIRE_LIGHTING_STEPS
                        ? channel.to
                        : channel.colorA
                            ? this.color.copy(channel.colorA).lerp(channel.colorB, lightingProgress).getHex()
                            : channel.from + (channel.to - channel.from) * lightingProgress;
            }
            this.arena.renderer?.updateMapFireLighting?.(this.profile);
            this.lastLightingStep = lightingStep;
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
        if (this.restPositions) for (const [root, x] of this.restPositions) root.position.x = x;
        this.definition = null;
        this.state = null;
        this.channels = [];
        this.restPositions = new Map();
        this.lastLightingStep = -1;
        this.arena.mapFireProgress = null;
        this.arena.mapFireHazardTime = null;
    }
}

import * as THREE from 'three';
import { CONFIG } from '../Config.js';
import {
    DEFAULT_SHADOW_QUALITY,
    normalizeShadowQuality,
    resolveShadowQualityPreset,
    SHADOW_QUALITY_LEVELS,
} from './ShadowQuality.js';
import {
    BLOOM_QUALITY_LEVELS,
    DEFAULT_BLOOM_QUALITY,
    normalizeBloomQuality,
    resolveBloomQualityPreset,
} from '../../shared/contracts/BloomQualityContract.js';
import {
    GRAPHICS_QUALITY_LEVELS,
    normalizeGraphicsQualityLevel,
} from '../../shared/contracts/GraphicsQualityContract.js';
import { GpuFrameTimer } from './GpuFrameTimer.js';
import { readGpuCapabilities } from './GpuCapabilityProbe.js';

const { LOW, MEDIUM, HIGH, ULTRA } = GRAPHICS_QUALITY_LEVELS;
// One shadow map covers the whole arena, so its texels are spread thin; doubling the edge is the
// most visible gain of ULTRA. It only replaces the player's highest shadow setting.
export const ULTRA_SHADOW_MAP_SIZE = 2048;
export const ULTRA_MAX_PIXEL_RATIO = 2;
// Rendering 1.25x the screen and filtering down calms shimmer on glossy hulls at pixel ratio 1.
export const ULTRA_SUPERSAMPLE_PIXEL_RATIO = 1.25;

export class RenderQualityController {
    constructor(renderer, scene, postProcessingPipeline = null) {
        this.renderer = renderer;
        this.scene = scene;
        this.requestedQuality = HIGH;
        this.quality = HIGH;
        this.ultraSupersample = false;
        this.shadowQuality = DEFAULT_SHADOW_QUALITY;
        this.bloomQuality = DEFAULT_BLOOM_QUALITY;
        this.bloomAutoFloor = false;
        this.postProcessingPipeline = postProcessingPipeline;
        this.qualityLockReason = null;
        this.highQualityEnvironment = scene?.environment || null;
        const gl = renderer?.getContext?.() || null;
        this.gpuFrameTimer = new GpuFrameTimer(gl);
        this.gpuCapabilities = readGpuCapabilities(gl, this.gpuFrameTimer.available);
        this._publishQuality();
        this._applyShadowQuality();
        this._applyBloomQuality();
    }

    /**
     * @param {string} quality LOW, MEDIUM, HIGH or ULTRA
     * @param {{supersample?: boolean}} [options] supersample only matters for ULTRA
     */
    setQuality(quality, options = {}) {
        this.requestedQuality = this._normalizeQuality(quality);
        const supersample = options?.supersample === true;
        const supersampleChanged = supersample !== this.ultraSupersample;
        this.ultraSupersample = supersample;
        this._applyEffectiveQuality(supersampleChanged && this.quality === ULTRA);
    }

    setQualityLock(active, reason = null) {
        const shouldLock = active === true;
        const normalizedReason = shouldLock
            ? (String(reason || 'quality-lock').trim() || 'quality-lock')
            : null;
        if (this.qualityLockReason === normalizedReason) {
            return this.getQualityState();
        }
        this.qualityLockReason = normalizedReason;
        this._applyEffectiveQuality();
        return this.getQualityState();
    }

    getQualityState() {
        return Object.freeze({
            requestedQuality: this.requestedQuality,
            effectiveQuality: this.quality,
            qualityLockActive: !!this.qualityLockReason,
            qualityLockReason: this.qualityLockReason,
        });
    }

    _normalizeQuality(quality) {
        return normalizeGraphicsQualityLevel(quality, HIGH);
    }

    _resolveEffectiveQuality() {
        if (this.qualityLockReason) {
            // A cinematic recording never runs below HIGH, but keeps ULTRA where the machine has it.
            return this.requestedQuality === ULTRA ? ULTRA : HIGH;
        }
        return this.requestedQuality;
    }

    _applyEffectiveQuality(force = false) {
        const nextQuality = this._resolveEffectiveQuality();
        if (this.quality === nextQuality && !force) {
            return;
        }
        this.quality = nextQuality;
        this._publishQuality();
        // Qualitaetsstufen regeln nur Aufloesung und Schatten. Tone-Mapping, Environment-IBL
        // und Fog bleiben konstant, sonst kippt die Szenenhelligkeit bei jedem Stufenwechsel
        // sichtbar zwischen hell und dunkel. Fog gehoert dem Grafikstil (Renderer.setGraphicsStyle).
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.scene.environment = this.highQualityEnvironment;
        this.renderer.setPixelRatio(this._resolvePixelRatio(window.devicePixelRatio));

        this._applyShadowQuality();
        this._applyBloomQuality();
        this.postProcessingPipeline?.setPixelRatio?.(this.renderer.getPixelRatio());
        this._refreshMaterials();
    }

    _resolvePixelRatio(devicePixelRatio) {
        const dpr = Number(devicePixelRatio) || 1;
        if (this.quality === LOW) return Math.min(dpr, 0.8);
        if (this.quality === MEDIUM) return Math.min(dpr, 1);
        if (this.quality === ULTRA) {
            const native = Math.min(dpr, ULTRA_MAX_PIXEL_RATIO);
            return this.ultraSupersample ? Math.max(native, ULTRA_SUPERSAMPLE_PIXEL_RATIO) : native;
        }
        return Math.min(dpr, CONFIG.RENDER.MAX_PIXEL_RATIO);
    }

    /**
     * Effektive Stufe an der Szene hinterlegen. Effekte mit eigener Sparfassung
     * (der Reaktor-Atompilz reduziert auf LOW die Volumen-Abtastung) lesen sie dort beim
     * Zeichnen, ohne dass entities den Renderer importieren muss.
     */
    _publishQuality() {
        if (this.scene?.userData) this.scene.userData.graphicsQuality = this.quality;
    }

    setShadowQuality(level) {
        const nextShadowQuality = normalizeShadowQuality(level);
        if (this.shadowQuality === nextShadowQuality) {
            return;
        }
        this.shadowQuality = nextShadowQuality;
        this._applyShadowQuality();
        this._refreshMaterials();
    }

    getShadowQuality() {
        return this.shadowQuality;
    }

    setBloomQuality(level) {
        const nextBloomQuality = normalizeBloomQuality(level);
        if (this.bloomQuality === nextBloomQuality) return;
        this.bloomQuality = nextBloomQuality;
        this._applyBloomQuality();
    }

    getBloomQuality() {
        return this.bloomQuality;
    }

    /**
     * While the player never picked a bloom level, ULTRA lifts "off" to a soft glow. Once they
     * move the slider their choice stands at every level.
     */
    setBloomAutoFloor(enabled) {
        const next = enabled === true;
        if (this.bloomAutoFloor === next) return;
        this.bloomAutoFloor = next;
        this._applyBloomQuality();
    }

    _applyBloomQuality() {
        let effectiveBloomQuality = BLOOM_QUALITY_LEVELS.OFF;
        if (this.quality === HIGH) {
            effectiveBloomQuality = this.bloomQuality;
        } else if (this.quality === ULTRA) {
            effectiveBloomQuality = this.bloomAutoFloor
                ? Math.max(this.bloomQuality, BLOOM_QUALITY_LEVELS.LOW)
                : this.bloomQuality;
        }
        this.postProcessingPipeline?.setQualityPreset?.(
            resolveBloomQualityPreset(effectiveBloomQuality)
        );
    }

    _applyShadowQuality() {
        const effectiveShadowQuality = this.quality === LOW
            ? SHADOW_QUALITY_LEVELS.OFF
            : (this.quality === MEDIUM
                ? Math.min(this.shadowQuality, SHADOW_QUALITY_LEVELS.MEDIUM)
                : this.shadowQuality);
        const preset = resolveShadowQualityPreset(effectiveShadowQuality);
        const mapSize = this.quality === ULTRA && effectiveShadowQuality === SHADOW_QUALITY_LEVELS.HIGH
            ? ULTRA_SHADOW_MAP_SIZE
            : preset.mapSize;
        this.renderer.shadowMap.enabled = preset.enabled;

        if (preset.enabled && mapSize > 0) {
            this.scene.traverse((child) => {
                if (!child?.isDirectionalLight || !child.castShadow || !child.shadow?.mapSize) {
                    return;
                }
                if (child.shadow.mapSize.width !== mapSize || child.shadow.mapSize.height !== mapSize) {
                    child.shadow.mapSize.set(mapSize, mapSize);
                    if (child.shadow.map) {
                        child.shadow.map.dispose();
                        child.shadow.map = null;
                    }
                }
            });
        }

        this.renderer.shadowMap.needsUpdate = true;
    }

    _refreshMaterials() {
        this.scene.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.needsUpdate = true;
            }
        });
    }

    dispose() {
        this.gpuFrameTimer.dispose();
    }
}

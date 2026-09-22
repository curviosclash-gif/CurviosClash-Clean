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

export class RenderQualityController {
    constructor(renderer, scene, postProcessingPipeline = null) {
        this.renderer = renderer;
        this.scene = scene;
        this.requestedQuality = 'HIGH';
        this.quality = 'HIGH';
        this.shadowQuality = DEFAULT_SHADOW_QUALITY;
        this.bloomQuality = DEFAULT_BLOOM_QUALITY;
        this.postProcessingPipeline = postProcessingPipeline;
        this.qualityLockReason = null;
        this.highQualityEnvironment = scene?.environment || null;
        this._publishQuality();
        this._applyShadowQuality();
        this._applyBloomQuality();
    }

    setQuality(quality) {
        this.requestedQuality = this._normalizeQuality(quality);
        this._applyEffectiveQuality();
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
        if (quality === 'LOW' || quality === 'MEDIUM') return quality;
        return 'HIGH';
    }

    _resolveEffectiveQuality() {
        if (this.qualityLockReason) {
            return 'HIGH';
        }
        return this.requestedQuality;
    }

    _applyEffectiveQuality() {
        const nextQuality = this._resolveEffectiveQuality();
        if (this.quality === nextQuality) {
            return;
        }
        this.quality = nextQuality;
        this._publishQuality();
        // Qualitaetsstufen regeln nur Aufloesung und Schatten. Tone-Mapping, Environment-IBL
        // und Fog bleiben konstant, sonst kippt die Szenenhelligkeit bei jedem Stufenwechsel
        // sichtbar zwischen hell und dunkel. Fog gehoert dem Grafikstil (Renderer.setGraphicsStyle).
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.scene.environment = this.highQualityEnvironment;
        if (this.quality === 'LOW') {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.8));
        } else if (this.quality === 'MEDIUM') {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
        } else {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.RENDER.MAX_PIXEL_RATIO));
        }

        this._applyShadowQuality();
        this._applyBloomQuality();
        this.postProcessingPipeline?.setPixelRatio?.(this.renderer.getPixelRatio());
        this._refreshMaterials();
    }

    /**
     * Effektive Stufe an der Szene hinterlegen. Effekte, die ihre eigene Sparfassung mitbringen
     * (der Reaktor-Atompilz zeichnet auf LOW Karten statt Volumenrauch), lesen sie dort beim
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

    _applyBloomQuality() {
        const effectiveBloomQuality = this.quality === 'HIGH'
            ? this.bloomQuality
            : BLOOM_QUALITY_LEVELS.OFF;
        this.postProcessingPipeline?.setQualityPreset?.(
            resolveBloomQualityPreset(effectiveBloomQuality)
        );
    }

    _applyShadowQuality() {
        const effectiveShadowQuality = this.quality === 'LOW'
            ? SHADOW_QUALITY_LEVELS.OFF
            : (this.quality === 'MEDIUM'
                ? Math.min(this.shadowQuality, SHADOW_QUALITY_LEVELS.MEDIUM)
                : this.shadowQuality);
        const preset = resolveShadowQualityPreset(effectiveShadowQuality);
        this.renderer.shadowMap.enabled = preset.enabled;

        if (preset.enabled && preset.mapSize > 0) {
            this.scene.traverse((child) => {
                if (!child?.isDirectionalLight || !child.castShadow || !child.shadow?.mapSize) {
                    return;
                }
                if (child.shadow.mapSize.width !== preset.mapSize || child.shadow.mapSize.height !== preset.mapSize) {
                    child.shadow.mapSize.set(preset.mapSize, preset.mapSize);
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
}

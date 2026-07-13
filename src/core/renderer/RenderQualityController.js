import * as THREE from 'three';
import { CONFIG } from '../Config.js';
import {
    DEFAULT_SHADOW_QUALITY,
    normalizeShadowQuality,
    resolveShadowQualityPreset,
    SHADOW_QUALITY_LEVELS,
} from './ShadowQuality.js';

export class RenderQualityController {
    constructor(renderer, scene) {
        this.renderer = renderer;
        this.scene = scene;
        this.requestedQuality = 'HIGH';
        this.quality = 'HIGH';
        this.shadowQuality = DEFAULT_SHADOW_QUALITY;
        this.qualityLockReason = null;
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
        return quality === 'LOW' ? 'LOW' : 'HIGH';
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
        if (this.quality === 'LOW') {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.8));
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.scene.fog.near = 30;
            this.scene.fog.far = 120;
        } else {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.RENDER.MAX_PIXEL_RATIO));
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.scene.fog.near = 50;
            this.scene.fog.far = 200;
        }

        this._applyShadowQuality();
        this._refreshMaterials();
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

    _applyShadowQuality() {
        const effectiveShadowQuality = this.quality === 'LOW'
            ? SHADOW_QUALITY_LEVELS.OFF
            : this.shadowQuality;
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

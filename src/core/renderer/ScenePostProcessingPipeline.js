import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class ScenePostProcessingPipeline {
    constructor(renderer, options = {}) {
        this.renderer = renderer;
        this.width = Math.max(1, Number(options.width) || 1);
        this.height = Math.max(1, Number(options.height) || 1);
        this.pixelRatio = renderer.getPixelRatio();
        this.enabled = false;
        this.preset = null;
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.smaaPass = null;
        this.outputPass = null;
        this._unavailable = false;
    }

    setQualityPreset(preset) {
        const wasEnabled = this.enabled;
        this.preset = preset || null;
        this.enabled = preset?.enabled === true;
        if (this.enabled && !wasEnabled) this._unavailable = false;
        if (this.bloomPass) this._applyPreset();
    }

    setSize(width, height) {
        this.width = Math.max(1, Number(width) || 1);
        this.height = Math.max(1, Number(height) || 1);
        if (!this.composer) return;
        this.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(this.width, this.height);
    }

    setPixelRatio(pixelRatio) {
        const normalized = Math.max(0.1, Number(pixelRatio) || 1);
        if (this.pixelRatio === normalized) return;
        this.pixelRatio = normalized;
        this.composer?.setPixelRatio(normalized);
    }

    render(scene, camera) {
        if (!this.enabled || !scene || !camera || !this._ensureComposer()) return false;
        this.setPixelRatio(this.renderer.getPixelRatio());
        this.renderPass.scene = scene;
        this.renderPass.camera = camera;
        this.composer.render(0);
        return true;
    }

    _ensureComposer() {
        if (this.composer) return true;
        if (this._unavailable) return false;
        try {
            this.composer = new EffectComposer(this.renderer);
            this.composer.setPixelRatio(this.pixelRatio);
            this.composer.setSize(this.width, this.height);
            this.renderPass = new RenderPass(null, null);
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0, 1);
            this.smaaPass = new SMAAPass(1, 1);
            this.outputPass = new OutputPass();
            this.composer.addPass(this.renderPass);
            this.composer.addPass(this.bloomPass);
            this.composer.addPass(this.smaaPass);
            this.composer.addPass(this.outputPass);
            this._applyPreset();
            return true;
        } catch {
            this.dispose();
            this._unavailable = true;
            return false;
        }
    }

    _applyPreset() {
        if (!this.bloomPass || !this.preset) return;
        this.bloomPass.strength = Number(this.preset.strength) || 0;
        this.bloomPass.radius = Number(this.preset.radius) || 0;
        this.bloomPass.threshold = Number(this.preset.threshold) || 0;
    }

    dispose() {
        this.renderPass?.dispose?.();
        this.bloomPass?.dispose?.();
        this.smaaPass?.dispose?.();
        this.outputPass?.dispose?.();
        this.composer?.dispose?.();
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.smaaPass = null;
        this.outputPass = null;
    }
}

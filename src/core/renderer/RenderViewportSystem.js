import {
    VIEWPORT_LAYOUTS,
    normalizeViewportLayout,
} from '../../shared/contracts/ViewportLayoutContract.js';

export class RenderViewportSystem {
    constructor(renderer, options = {}) {
        this.renderer = renderer;
        this.width = Number(options.width) || window.innerWidth;
        this.height = Number(options.height) || window.innerHeight;
        this.layout = normalizeViewportLayout(
            options.layout,
            options.splitScreen ? VIEWPORT_LAYOUTS.TWO_COLUMNS : VIEWPORT_LAYOUTS.SINGLE
        );
        this.splitScreen = this.layout !== VIEWPORT_LAYOUTS.SINGLE;
        /** When true, forces fullscreen single-camera rendering (network mode). */
        this.networkEnabled = !!options.networkEnabled;
        /** Index of the local player whose camera to follow in network mode. */
        this.localPlayerIndex = options.localPlayerIndex || 0;
        this.postProcessingPipeline = options.postProcessingPipeline || null;
        this.renderer.setSize(this.width, this.height);
        this.postProcessingPipeline?.setSize?.(this.width, this.height);
    }

    getAspect() {
        if (this.networkEnabled) {
            return this.width / this.height;
        }
        if (this.layout === VIEWPORT_LAYOUTS.TWO_COLUMNS) {
            return (this.width / 2) / this.height;
        }
        if (this.layout === VIEWPORT_LAYOUTS.FOUR_GRID) {
            return (this.width / 2) / (this.height / 2);
        }
        if (this.layout === VIEWPORT_LAYOUTS.THREE_COLUMNS) {
            return (this.width / 3) / this.height;
        }
        return this.width / this.height;
    }

    updateCameraAspects(cameras) {
        const aspect = this.getAspect();
        for (const cam of cameras) {
            cam.aspect = aspect;
            cam.updateProjectionMatrix();
        }
    }

    setSplitScreen(enabled, cameras) {
        this.setViewportLayout(
            enabled ? VIEWPORT_LAYOUTS.TWO_COLUMNS : VIEWPORT_LAYOUTS.SINGLE,
            cameras
        );
    }

    setViewportLayout(layout, cameras) {
        this.layout = normalizeViewportLayout(layout);
        this.splitScreen = this.layout !== VIEWPORT_LAYOUTS.SINGLE;
        this.updateCameraAspects(cameras);
    }

    /**
     * Configures viewport for a network session.
     * @param {boolean} enabled
     * @param {number} localPlayerIndex
     * @param {Array} cameras
     */
    setNetworkMode(enabled, localPlayerIndex, cameras) {
        this.networkEnabled = !!enabled;
        this.localPlayerIndex = localPlayerIndex || 0;
        if (enabled) {
            this.layout = VIEWPORT_LAYOUTS.SINGLE;
            this.splitScreen = false;
        }
        this.updateCameraAspects(cameras);
    }

    onResize(cameras) {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.renderer.setSize(this.width, this.height);
        this.postProcessingPipeline?.setSize?.(this.width, this.height);
        this.updateCameraAspects(cameras);
    }

    _renderSingle(scene, camera, width, height) {
        if (!camera) return;
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, width, height);
        this.renderer.setScissor(0, 0, width, height);
        if (!this.postProcessingPipeline?.render?.(scene, camera)) {
            this.renderer.render(scene, camera);
        }
    }

    render(scene, cameras) {
        const w = this.width;
        const h = this.height;

        // Network mode: fullscreen, follow local player's camera only
        if (this.networkEnabled) {
            const camIdx = Math.min(this.localPlayerIndex, cameras.length - 1);
            const cam = cameras[Math.max(0, camIdx)] || cameras[0];
            this._renderSingle(scene, cam, w, h);
            return;
        }

        if (this.layout === VIEWPORT_LAYOUTS.FOUR_GRID && cameras.length >= 4) {
            const leftWidth = Math.floor(w / 2);
            const rightWidth = w - leftWidth;
            const bottomHeight = Math.floor(h / 2);
            const topHeight = h - bottomHeight;
            this.renderer.setScissorTest(true);
            const quadrants = [
                [0, bottomHeight, leftWidth, topHeight, cameras[0]],
                [leftWidth, bottomHeight, rightWidth, topHeight, cameras[1]],
                [0, 0, leftWidth, bottomHeight, cameras[2]],
                [leftWidth, 0, rightWidth, bottomHeight, cameras[3]],
            ];
            for (const [x, y, width, height, camera] of quadrants) {
                this.renderer.setViewport(x, y, width, height);
                this.renderer.setScissor(x, y, width, height);
                this.renderer.render(scene, camera);
            }
            this.renderer.setScissorTest(false);
            this.renderer.setViewport(0, 0, w, h);
            this.renderer.setScissor(0, 0, w, h);
            return;
        }

        if (this.layout === VIEWPORT_LAYOUTS.THREE_COLUMNS && cameras.length >= 3) {
            const columnWidth = Math.floor(w / 3);
            const lastColumnWidth = w - columnWidth * 2;
            const columns = [
                [0, 0, columnWidth, h, cameras[0]],
                [columnWidth, 0, columnWidth, h, cameras[1]],
                [columnWidth * 2, 0, lastColumnWidth, h, cameras[2]],
            ];
            this.renderer.setScissorTest(true);
            for (const [x, y, width, height, camera] of columns) {
                this.renderer.setViewport(x, y, width, height);
                this.renderer.setScissor(x, y, width, height);
                this.renderer.render(scene, camera);
            }
            this.renderer.setScissorTest(false);
            this.renderer.setViewport(0, 0, w, h);
            this.renderer.setScissor(0, 0, w, h);
            return;
        }

        // Compatibility layout for the existing local 2P adapter.
        if (this.layout === VIEWPORT_LAYOUTS.TWO_COLUMNS && cameras.length >= 2) {
            const leftWidth = Math.floor(w / 2);
            const rightWidth = w - leftWidth;
            this.renderer.setViewport(0, 0, leftWidth, h);
            this.renderer.setScissor(0, 0, leftWidth, h);
            this.renderer.setScissorTest(true);
            this.renderer.render(scene, cameras[0]);

            this.renderer.setViewport(leftWidth, 0, rightWidth, h);
            this.renderer.setScissor(leftWidth, 0, rightWidth, h);
            this.renderer.render(scene, cameras[1]);

            this.renderer.setScissorTest(false);
            this.renderer.setViewport(0, 0, w, h);
            this.renderer.setScissor(0, 0, w, h);
            return;
        }

        if (cameras.length > 0) {
            this._renderSingle(scene, cameras[0], w, h);
        }
    }
}

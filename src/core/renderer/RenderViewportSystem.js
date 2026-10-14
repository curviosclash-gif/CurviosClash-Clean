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
        /** When true, renders only the local machine's camera set. */
        this.networkEnabled = !!options.networkEnabled;
        /** Index of the local player whose camera to follow in network mode. */
        this.localPlayerIndex = options.localPlayerIndex || 0;
        this.localHumanCount = Math.max(1, Math.floor(Number(options.localHumanCount) || 1));
        this.postProcessingPipeline = options.postProcessingPipeline || null;
        this.beforeCameraRender = typeof options.beforeCameraRender === 'function'
            ? options.beforeCameraRender : null;
        this.afterCameraRender = typeof options.afterCameraRender === 'function'
            ? options.afterCameraRender : null;
        this._fourGridViewports = [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ];
        this._threeColumnViewports = [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ];
        this._threeRowViewports = [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ];
        // Brackets the whole logical frame, so split screen and post-processing count as one frame.
        this.frameTimer = options.frameTimer || null;
        // A logical frame may render several cameras and post-processing passes. three.js resets
        // renderer.info before every render() by default, which made split-screen diagnostics show
        // only the last camera instead of the complete frame.
        if (this.renderer.info) this.renderer.info.autoReset = false;
        this.renderer.setSize(this.width, this.height);
        this.postProcessingPipeline?.setSize?.(this.width, this.height);
    }

    getAspect() {
        if (this.networkEnabled && this.localHumanCount <= 1) {
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
        if (this.layout === VIEWPORT_LAYOUTS.THREE_ROWS) {
            return this.width / (this.height / 3);
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
     * @param {number} localHumanCount
     * @param {string} layout
     */
    setNetworkMode(enabled, localPlayerIndex, cameras, localHumanCount = 1, layout = VIEWPORT_LAYOUTS.SINGLE) {
        this.networkEnabled = !!enabled;
        this.localPlayerIndex = localPlayerIndex || 0;
        this.localHumanCount = Math.max(1, Math.floor(Number(localHumanCount) || 1));
        if (enabled) {
            this.layout = this.localHumanCount >= 2
                ? normalizeViewportLayout(layout, VIEWPORT_LAYOUTS.TWO_COLUMNS)
                : VIEWPORT_LAYOUTS.SINGLE;
            this.splitScreen = this.localHumanCount >= 2;
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
        this.beforeCameraRender?.(scene, camera);
        try {
            if (!this.postProcessingPipeline?.render?.(scene, camera)) {
                this.renderer.render(scene, camera);
            }
        } finally {
            this.afterCameraRender?.(scene, camera);
        }
    }

    _renderCamera(scene, camera) {
        this.beforeCameraRender?.(scene, camera);
        try {
            this.renderer.render(scene, camera);
        } finally {
            this.afterCameraRender?.(scene, camera);
        }
    }

    render(scene, cameras) {
        this.frameTimer?.begin();
        try {
            this._renderLayout(scene, cameras);
        } finally {
            this.frameTimer?.end();
        }
    }

    _renderLayout(scene, cameras) {
        this.renderer.info?.reset?.();
        const w = this.width;
        const h = this.height;

        // Network mode: render only this machine's local camera set.
        if (this.networkEnabled) {
            if (this.localHumanCount >= 2) {
                const leftWidth = Math.floor(w / 2);
                const rightWidth = w - leftWidth;
                const firstCamera = cameras[Math.max(0, this.localPlayerIndex)] || cameras[0];
                const secondCamera = cameras[Math.max(0, this.localPlayerIndex + 1)] || firstCamera;
                this.renderer.setScissorTest(true);
                this.renderer.setViewport(0, 0, leftWidth, h);
                this.renderer.setScissor(0, 0, leftWidth, h);
                this._renderCamera(scene, firstCamera);
                this.renderer.setViewport(leftWidth, 0, rightWidth, h);
                this.renderer.setScissor(leftWidth, 0, rightWidth, h);
                this._renderCamera(scene, secondCamera);
                this.renderer.setScissorTest(false);
                this.renderer.setViewport(0, 0, w, h);
                this.renderer.setScissor(0, 0, w, h);
                return;
            }
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
            const quadrants = this._fourGridViewports;
            quadrants[0][0] = 0;
            quadrants[0][1] = bottomHeight;
            quadrants[0][2] = leftWidth;
            quadrants[0][3] = topHeight;
            quadrants[1][0] = leftWidth;
            quadrants[1][1] = bottomHeight;
            quadrants[1][2] = rightWidth;
            quadrants[1][3] = topHeight;
            quadrants[2][0] = 0;
            quadrants[2][1] = 0;
            quadrants[2][2] = leftWidth;
            quadrants[2][3] = bottomHeight;
            quadrants[3][0] = leftWidth;
            quadrants[3][1] = 0;
            quadrants[3][2] = rightWidth;
            quadrants[3][3] = bottomHeight;
            for (let index = 0; index < quadrants.length; index += 1) {
                const pane = quadrants[index];
                this.renderer.setViewport(pane[0], pane[1], pane[2], pane[3]);
                this.renderer.setScissor(pane[0], pane[1], pane[2], pane[3]);
                this._renderCamera(scene, cameras[index]);
            }
            this.renderer.setScissorTest(false);
            this.renderer.setViewport(0, 0, w, h);
            this.renderer.setScissor(0, 0, w, h);
            return;
        }

        if (this.layout === VIEWPORT_LAYOUTS.THREE_COLUMNS && cameras.length >= 3) {
            const columnWidth = Math.floor(w / 3);
            const lastColumnWidth = w - columnWidth * 2;
            const columns = this._threeColumnViewports;
            columns[0][0] = 0;
            columns[0][1] = 0;
            columns[0][2] = columnWidth;
            columns[0][3] = h;
            columns[1][0] = columnWidth;
            columns[1][1] = 0;
            columns[1][2] = columnWidth;
            columns[1][3] = h;
            columns[2][0] = columnWidth * 2;
            columns[2][1] = 0;
            columns[2][2] = lastColumnWidth;
            columns[2][3] = h;
            this.renderer.setScissorTest(true);
            for (let index = 0; index < columns.length; index += 1) {
                const pane = columns[index];
                this.renderer.setViewport(pane[0], pane[1], pane[2], pane[3]);
                this.renderer.setScissor(pane[0], pane[1], pane[2], pane[3]);
                this._renderCamera(scene, cameras[index]);
            }
            this.renderer.setScissorTest(false);
            this.renderer.setViewport(0, 0, w, h);
            this.renderer.setScissor(0, 0, w, h);
            return;
        }

        if (this.layout === VIEWPORT_LAYOUTS.THREE_ROWS && cameras.length >= 3) {
            const rowHeight = Math.floor(h / 3);
            const topRowHeight = h - rowHeight * 2;
            const rows = this._threeRowViewports;
            rows[0][0] = 0;
            rows[0][1] = rowHeight * 2;
            rows[0][2] = w;
            rows[0][3] = topRowHeight;
            rows[1][0] = 0;
            rows[1][1] = rowHeight;
            rows[1][2] = w;
            rows[1][3] = rowHeight;
            rows[2][0] = 0;
            rows[2][1] = 0;
            rows[2][2] = w;
            rows[2][3] = rowHeight;
            this.renderer.setScissorTest(true);
            for (let index = 0; index < rows.length; index += 1) {
                const pane = rows[index];
                this.renderer.setViewport(pane[0], pane[1], pane[2], pane[3]);
                this.renderer.setScissor(pane[0], pane[1], pane[2], pane[3]);
                this._renderCamera(scene, cameras[index]);
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
            this._renderCamera(scene, cameras[0]);

            this.renderer.setViewport(leftWidth, 0, rightWidth, h);
            this.renderer.setScissor(leftWidth, 0, rightWidth, h);
            this._renderCamera(scene, cameras[1]);

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

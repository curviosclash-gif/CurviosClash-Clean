export class RenderViewportSystem {
    constructor(renderer, options = {}) {
        this.renderer = renderer;
        this.width = Number(options.width) || window.innerWidth;
        this.height = Number(options.height) || window.innerHeight;
        this.splitScreen = !!options.splitScreen;
        /** When true, forces fullscreen single-camera rendering (network mode). */
        this.networkEnabled = !!options.networkEnabled;
        /** Index of the local player whose camera to follow in network mode. */
        this.localPlayerIndex = options.localPlayerIndex || 0;
        this.renderer.setSize(this.width, this.height);
    }

    getAspect() {
        if (this.networkEnabled) {
            return this.width / this.height;
        }
        if (this.splitScreen) {
            return (this.width / 2) / this.height;
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
        this.splitScreen = !!enabled;
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
            this.splitScreen = false;
        }
        this.updateCameraAspects(cameras);
    }

    onResize(cameras) {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.renderer.setSize(this.width, this.height);
        this.updateCameraAspects(cameras);
    }

    render(scene, cameras) {
        const w = this.width;
        const h = this.height;

        // Network mode: fullscreen, follow local player's camera only
        if (this.networkEnabled) {
            const camIdx = Math.min(this.localPlayerIndex, cameras.length - 1);
            const cam = cameras[Math.max(0, camIdx)] || cameras[0];
            if (cam) {
                this.renderer.setViewport(0, 0, w, h);
                this.renderer.render(scene, cam);
            }
            return;
        }

        // Splitscreen: only for local 2P (sessionType='splitscreen')
        if (this.splitScreen && cameras.length >= 2) {
            this.renderer.setViewport(0, 0, w / 2, h);
            this.renderer.setScissor(0, 0, w / 2, h);
            this.renderer.setScissorTest(true);
            this.renderer.render(scene, cameras[0]);

            this.renderer.setViewport(w / 2, 0, w / 2, h);
            this.renderer.setScissor(w / 2, 0, w / 2, h);
            this.renderer.render(scene, cameras[1]);

            this.renderer.setScissorTest(false);
            return;
        }

        if (cameras.length > 0) {
            this.renderer.setViewport(0, 0, w, h);
            this.renderer.render(scene, cameras[0]);
        }
    }
}

import * as THREE from 'three';

export class VehicleLabCore {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0f172a);

        const aspect = canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
        this.camera.position.set(5, 5, 10);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        this.keys = {
            w: false, a: false, s: false, d: false, q: false, e: false, x: false, y: false, shift: false,
            i: false, k: false, j: false, l: false, u: false, o: false,
            arrowup: false, arrowdown: false, arrowleft: false, arrowright: false,
            pageup: false, pagedown: false,
            m: false, n: false
        };
        this.initKeys();

        this.clock = new THREE.Clock();
        this.setupLights();
        this.setupGrid();
        this.resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => this.onResize())
            : null;
        this.resizeObserver?.observe(this.canvas);
    }

    initKeys() {
        this.onKeyDown = (e) => {
            if (this.isEditingTarget(e.target)) return;
            const key = e.key.toLowerCase();
            if (this.keys.hasOwnProperty(key)) this.keys[key] = true;
            if (e.key === 'Shift') this.keys.shift = true;
        };
        this.onKeyUp = (e) => {
            const key = e.key.toLowerCase();
            if (this.keys.hasOwnProperty(key)) this.keys[key] = false;
            if (e.key === 'Shift') this.keys.shift = false;
        };
        this.onBlur = () => this.resetKeys();
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);
    }

    isEditingTarget(target) {
        if (!target || typeof target.closest !== 'function') return false;
        return !!target.closest('input, select, textarea, [contenteditable="true"]');
    }

    resetKeys() {
        Object.keys(this.keys).forEach((key) => { this.keys[key] = false; });
    }

    setupLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(10, 20, 10);
        this.scene.add(sun);
    }

    setupGrid() {
        const grid = new THREE.GridHelper(10, 10, 0x1f2937, 0x111827);
        this.scene.add(grid);
    }

    onResize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w <= 0 || h <= 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
    }

    dispose() {
        this.resizeObserver?.disconnect();
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        this.renderer.dispose();
    }
}

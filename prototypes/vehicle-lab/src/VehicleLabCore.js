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
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

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
    }

    initKeys() {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (this.keys.hasOwnProperty(key)) this.keys[key] = true;
            if (e.key === 'Shift') this.keys.shift = true;
        });
        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (this.keys.hasOwnProperty(key)) this.keys[key] = false;
            if (e.key === 'Shift') this.keys.shift = false;
        });
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
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }
}

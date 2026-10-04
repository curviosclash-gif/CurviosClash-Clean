import * as THREE from 'three';
import { createVehicleMeshFromConfig } from '../../entities/vehicle-registry.js';

export function createArcadeLabPreview(mount) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x081524);
    scene.add(new THREE.HemisphereLight(0xd8eeff, 0x203048, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(4, 7, 5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    let renderer = null;
    let mesh = null;
    let raf = 0;
    let visible = false;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
        mount.appendChild(renderer.domElement);
    } catch { mount.textContent = '3D-Vorschau nicht verfügbar'; }

    function render() {
        raf = 0;
        if (!visible || !renderer) return;
        const width = Math.max(1, mount.clientWidth);
        const height = Math.max(1, mount.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (mesh) mesh.rotation.y += 0.003;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(render);
    }
    function show(value) {
        visible = value === true;
        if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
        if (visible && !raf) raf = requestAnimationFrame(render);
    }
    function setConfig(config) {
        if (mesh) { scene.remove(mesh); mesh.dispose?.(); mesh = null; }
        if (!config || !renderer) return;
        mesh = createVehicleMeshFromConfig(config, 0x66b6ff);
        scene.add(mesh);
        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(0.1, box.getBoundingSphere(new THREE.Sphere()).radius);
        mesh.position.sub(center);
        camera.position.set(radius * 1.8, radius * 1.25, radius * 2.5);
        camera.lookAt(0, 0, 0);
    }
    return { show, setConfig, dispose() { show(false); setConfig(null); renderer?.dispose(); renderer?.domElement?.remove(); } };
}

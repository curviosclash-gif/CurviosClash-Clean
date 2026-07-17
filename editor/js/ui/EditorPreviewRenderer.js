import * as THREE from 'three';
import { resolveEditorBuildEntryAssetId } from './EditorBuildCatalog.js';

function createFallbackPreviewObject(entry) {
    if (entry.tool === 'hard' || entry.tool === 'foam') {
        return new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 1, 1.2),
            new THREE.MeshLambertMaterial({ color: entry.tool === 'hard' ? 0xf97373 : 0x34d399 }),
        );
    }
    if (entry.tool === 'portal' || entry.tool === 'checkpoint') {
        return new THREE.Mesh(
            new THREE.TorusGeometry(0.8, entry.tool === 'portal' ? 0.16 : 0.09, 12, 30),
            new THREE.MeshLambertMaterial({ color: entry.tool === 'portal' ? 0xc084fc : 0xaaff00 }),
        );
    }
    if (entry.tool === 'spawn') {
        return new THREE.Mesh(
            new THREE.ConeGeometry(0.65, 1.5, 12),
            new THREE.MeshLambertMaterial({ color: entry.subType === 'player' ? 0xeab308 : 0xef4444 }),
        );
    }
    if (entry.tool === 'tunnel') {
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.65, 0.65, 1.8, 18, 1, true),
            new THREE.MeshLambertMaterial({ color: 0x60a5fa, side: THREE.DoubleSide }),
        );
        mesh.rotation.z = Math.PI / 2;
        return mesh;
    }
    return new THREE.Mesh(
        new THREE.OctahedronGeometry(0.85),
        new THREE.MeshLambertMaterial({ color: entry.tool === 'aircraft' ? 0x34d399 : 0xfbbf24 }),
    );
}

function hasFinitePreviewGeometry(object) {
    let valid = true;
    object?.traverse?.((node) => {
        const transforms = [node?.position, node?.rotation, node?.scale];
        if (transforms.some((value) => value && Object.values(value).some((entry) => typeof entry === 'number' && !Number.isFinite(entry)))) {
            valid = false;
            return;
        }
        const values = node?.geometry?.attributes?.position?.array;
        if (!values || !valid) return;
        for (let index = 0; index < values.length; index += 1) {
            if (!Number.isFinite(values[index])) {
                valid = false;
                break;
            }
        }
    });
    return valid;
}

function disposePreviewObject(object) {
    object?.traverse?.((node) => {
        node.geometry?.dispose?.();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

export function createEditorBuildPreviewRenderer(assetLoader) {
    let renderer = null;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setSize(192, 108, false);
        renderer.setPixelRatio(1);
        renderer.setClearColor(0x06101f, 1);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.01, 100);
        camera.position.set(3.1, 2.2, 3.5);
        camera.lookAt(0, 0, 0);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x18233a, 2.2));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
        keyLight.position.set(4, 5, 3);
        scene.add(keyLight);

        const box = new THREE.Box3();
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();

        return {
            render(entries) {
                const cache = new Map();
                if (!Array.isArray(entries) || entries.length === 0) return cache;
                for (const entry of entries) {
                    let object = null;
                    try {
                        const assetId = resolveEditorBuildEntryAssetId(entry);
                        const assetStatus = assetId ? assetLoader?.getLoadStatus?.(assetId) : null;
                        object = assetId && assetStatus?.state === 'loaded' ? assetLoader?.getClone?.(assetId) : null;
                        if (object && !hasFinitePreviewGeometry(object)) {
                            disposePreviewObject(object);
                            object = null;
                        }
                        if (!object) object = createFallbackPreviewObject(entry);
                        box.setFromObject(object);
                        box.getSize(size);
                        box.getCenter(center);
                        object.position.sub(center);
                        const largest = Math.max(size.x, size.y, size.z, 0.001);
                        object.scale.multiplyScalar(1.8 / largest);
                        object.rotation.y += 0.55;
                        scene.add(object);
                        renderer.render(scene, camera);
                        cache.set(entry.id, renderer.domElement.toDataURL('image/webp', 0.82));
                    } catch (error) {
                        console.warn(`[EditorPreviewRenderer] Preview for "${entry.id}" unavailable:`, error);
                    } finally {
                        if (object) {
                            scene.remove(object);
                            disposePreviewObject(object);
                        }
                    }
                }
                return cache;
            },
            dispose() {
                renderer?.dispose?.();
                renderer = null;
            },
        };
    } catch (error) {
        console.warn('[EditorPreviewRenderer] 3D preview cache unavailable:', error);
        renderer?.dispose?.();
        return {
            render() { return new Map(); },
            dispose() {},
        };
    }
}

export function createEditorBuildPreviewCache(entries, assetLoader) {
    if (typeof document === 'undefined') return new Map();
    const previewRenderer = createEditorBuildPreviewRenderer(assetLoader);
    try {
        return previewRenderer.render(entries);
    } finally {
        previewRenderer.dispose();
    }
}

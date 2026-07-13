import * as THREE from 'three';
import { disposeObject3DResources } from '../three-disposal.js';

export class SceneRootManager {
    constructor(scene) {
        this.scene = scene;
        this.persistentRoot = new THREE.Group();
        this.persistentRoot.name = 'persistentRoot';
        this.scene.add(this.persistentRoot);

        this.matchRoot = new THREE.Group();
        this.matchRoot.name = 'matchRoot';
        this.scene.add(this.matchRoot);

        this.debugRoot = new THREE.Group();
        this.debugRoot.name = 'debugRoot';
        this.scene.add(this.debugRoot);
    }

    addToScene(obj) {
        this.matchRoot.add(obj);
    }

    addToPersistentScene(obj) {
        this.persistentRoot.add(obj);
    }

    addToDebugScene(obj) {
        this.debugRoot.add(obj);
    }

    removeFromScene(obj) {
        if (obj?.parent) {
            obj.parent.remove(obj);
        }
    }

    clearRoot(root) {
        if (!root) return;
        disposeObject3DResources(root);
        while (root.children.length > 0) {
            root.remove(root.children[root.children.length - 1]);
        }
    }

    clearMatchScene() {
        this.clearRoot(this.matchRoot);
    }

    clearScene() {
        this.clearRoot(this.matchRoot);
        this.clearRoot(this.debugRoot);
    }
}

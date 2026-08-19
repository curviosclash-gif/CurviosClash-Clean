import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createSceneEnvironment(renderer, scene) {
    const environment = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    try {
        const renderTarget = pmremGenerator.fromScene(environment, 0.04);
        scene.environment = renderTarget.texture;
        return renderTarget;
    } finally {
        environment.dispose();
        pmremGenerator.dispose();
    }
}

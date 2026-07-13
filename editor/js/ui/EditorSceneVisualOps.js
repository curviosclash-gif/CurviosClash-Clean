import * as THREE from 'three';

export function setupEditorSceneVisuals(editor) {
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const wallMat = new THREE.MeshBasicMaterial({
        color: 0x334155,
        wireframe: true,
        transparent: true,
        opacity: 0.1
    });
    editor.arenaBoxWall = new THREE.Mesh(wallGeo, wallMat);
    editor.core.scene.add(editor.arenaBoxWall);

    editor.arenaBox = new THREE.BoxHelper(editor.arenaBoxWall, 0x3b82f6);
    editor.core.scene.add(editor.arenaBox);

    editor.matTunnelLine = new THREE.LineBasicMaterial({
        color: 0x60a5fa,
        linewidth: 2,
        transparent: true,
        opacity: 0.5
    });

    updateArenaBoundsVisual(editor);
}

export function updateArenaBoundsVisual(editor) {
    editor.arenaBox.matrixAutoUpdate = false;
    const matrix = new THREE.Matrix4().makeScale(editor.ARENA_W, editor.ARENA_H, editor.ARENA_D);
    matrix.setPosition(0, editor.ARENA_H / 2, 0);
    editor.arenaBox.matrix.copy(matrix);
    editor.arenaBox.update();
}

export function updateTunnelSegmentLineVisuals(editor) {
    while (editor.core.tunnelLines.children.length > 0) {
        const line = editor.core.tunnelLines.children[0];
        editor.core.tunnelLines.remove(line);
        line.geometry?.dispose?.();
    }

    editor.core.objectsContainer.children.forEach((obj) => {
        if (obj.userData.type !== 'tunnel') return;
        if (!obj.userData.pointA || !obj.userData.pointB) return;
        const geometry = new THREE.BufferGeometry().setFromPoints([obj.userData.pointA, obj.userData.pointB]);
        const line = new THREE.Line(geometry, editor.matTunnelLine);
        editor.core.tunnelLines.add(line);
    });
}

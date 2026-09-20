export function createHudObjectiveMarker(container) {
    const doc = container?.ownerDocument || globalThis.document;
    const objectiveReticle = doc.createElement('div');
    objectiveReticle.className = 'hud-objective-reticle hidden';
    const objectiveBox = doc.createElement('div');
    objectiveBox.className = 'hud-objective-box';
    const objectiveArrow = doc.createElement('div');
    objectiveArrow.className = 'hud-objective-arrow hidden';
    const objectiveLabel = doc.createElement('div');
    objectiveLabel.className = 'hud-objective-label';
    const objectiveDistance = doc.createElement('div');
    objectiveDistance.className = 'hud-objective-distance';
    objectiveReticle.appendChild(objectiveBox);
    objectiveReticle.appendChild(objectiveArrow);
    objectiveReticle.appendChild(objectiveLabel);
    objectiveReticle.appendChild(objectiveDistance);
    container.appendChild(objectiveReticle);
    return { objectiveReticle, objectiveBox, objectiveArrow, objectiveLabel, objectiveDistance };
}

export function updateHudObjectiveMarker(hud, player, context = {}) {
    const objective = context?.objectiveTarget || null;
    if (!objective?.active || objective.phase === 'GOAL' || objective.phase === 'DESTROYED') {
        hud._setClassFlag(hud.objectiveReticle, 'hidden', true);
        return;
    }
    const camera = typeof context?.getCamera === 'function'
        ? context.getCamera(hud.playerIndex) : hud._getCamera(hud.playerIndex);
    if (!camera) {
        hud._setClassFlag(hud.objectiveReticle, 'hidden', true);
        return;
    }
    hud._playerPosition.set(Number(player?.position?.x) || 0, Number(player?.position?.y) || 0, Number(player?.position?.z) || 0);
    hud._targetPosition.set(
        Number(objective?.position?.x) || 0,
        (Number(objective?.position?.y) || 0) + 3,
        Number(objective?.position?.z) || 0,
    );
    hud._setText(hud.objectiveLabel, player?.teamId === 'BRAVO' ? 'ZERSTÖREN' : 'SCHÜTZEN');
    hud._setText(hud.objectiveDistance, `${Math.round(hud._playerPosition.distanceTo(hud._targetPosition))}m`);
    hud._vec.copy(hud._targetPosition).project(camera);
    const width = hud.container.clientWidth;
    const height = hud.container.clientHeight;
    let x = (hud._vec.x * 0.5 + 0.5) * width;
    let y = (-(hud._vec.y * 0.5) + 0.5) * height;
    const behindCamera = hud._vec.z >= 1;
    if (behindCamera) { x = width - x; y = height - y; }
    const margin = 42;
    const offscreen = behindCamera || x < margin || x > width - margin || y < margin || y > height - margin;
    if (offscreen) {
        const centerX = width * 0.5;
        const centerY = height * 0.5;
        const dx = x - centerX;
        const dy = y - centerY;
        let edgeX = centerX;
        let edgeY = margin;
        let arrowDeg = 0;
        if (dx !== 0 || dy !== 0) {
            let t = Infinity;
            if (dx > 0) t = Math.min(t, (width - margin - centerX) / dx);
            else if (dx < 0) t = Math.min(t, (margin - centerX) / dx);
            if (dy > 0) t = Math.min(t, (height - margin - centerY) / dy);
            else if (dy < 0) t = Math.min(t, (margin - centerY) / dy);
            if (Number.isFinite(t)) { edgeX = centerX + dx * t; edgeY = centerY + dy * t; }
            arrowDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        }
        hud._setStyle(hud.objectiveReticle, 'transform', `translate(${edgeX}px, ${edgeY}px) translate(-50%, -50%) scale(var(--hud-scale, 1))`);
        hud._setStyle(hud.objectiveArrow, 'transform', `translate(-50%, -50%) rotate(${arrowDeg}deg)`);
        hud._setClassFlag(hud.objectiveBox, 'hidden', true);
        hud._setClassFlag(hud.objectiveArrow, 'hidden', false);
    } else {
        hud._setStyle(hud.objectiveReticle, 'transform', `translate(${x}px, ${y}px) translate(-50%, -50%) scale(var(--hud-scale, 1))`);
        hud._setClassFlag(hud.objectiveBox, 'hidden', false);
        hud._setClassFlag(hud.objectiveArrow, 'hidden', true);
    }
    hud._setClassFlag(hud.objectiveReticle, 'hidden', false);
}

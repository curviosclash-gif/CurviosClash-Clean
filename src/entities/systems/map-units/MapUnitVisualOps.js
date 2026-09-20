import * as THREE from 'three';

/**
 * Box-built tank (E78 spirit: simple shapes first, a Blender model is its own later package).
 * The model faces +Z. `headPivot` carries the turret and barrel and is what the aiming code turns,
 * exactly like the head of a static turret; the root carries hull, tracks and the health bar.
 */

const HULL_COLOR = 0x4b5a3a;
const TRACK_COLOR = 0x1d2126;
const TURRET_COLOR = 0x5d6e46;
const HEALTH_COLOR = 0x9be15d;
const LOW_HEALTH_COLOR = 0xff5533;

export const TANK_TURRET_HEIGHT = 2.1;

export function createMapUnitAssets() {
    const barrel = new THREE.CylinderGeometry(0.22, 0.28, 4.2, 8);
    barrel.rotateX(Math.PI / 2);
    barrel.translate(0, 0, 2.4);
    return {
        hullGeometry: new THREE.BoxGeometry(4.6, 1.5, 6.8),
        trackGeometry: new THREE.BoxGeometry(1.1, 1.3, 7.2),
        turretGeometry: new THREE.BoxGeometry(2.8, 1.1, 3.2),
        barrelGeometry: barrel,
        flashGeometry: new THREE.SphereGeometry(0.42, 8, 6),
        healthBackGeometry: new THREE.BoxGeometry(4.2, 0.34, 0.12),
        healthFillGeometry: new THREE.BoxGeometry(4, 0.22, 0.14),
        teamAccentGeometry: new THREE.BoxGeometry(4, 0.18, 2.2),
        hullMaterial: new THREE.MeshStandardMaterial({ color: HULL_COLOR, roughness: 0.8, metalness: 0.35 }),
        trackMaterial: new THREE.MeshStandardMaterial({ color: TRACK_COLOR, roughness: 0.95, metalness: 0.2 }),
        turretMaterial: new THREE.MeshStandardMaterial({ color: TURRET_COLOR, roughness: 0.7, metalness: 0.4 }),
        flashMaterial: new THREE.MeshBasicMaterial({ color: 0xffe2a8 }),
        healthBackMaterial: new THREE.MeshBasicMaterial({ color: 0x101820, transparent: true, opacity: 0.78 }),
    };
}

export function disposeMapUnitAssets(assets) {
    for (const value of Object.values(assets || {})) value?.dispose?.();
}

export function createMapUnitVisual(renderer, assets, scale = 1, teamColor = null) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.scale.setScalar(Math.max(0.001, Number(scale) || 1));

    const hull = new THREE.Mesh(assets.hullGeometry, assets.hullMaterial);
    hull.position.y = 0.95;
    root.add(hull);
    const normalizedTeamColor = Number.isFinite(Number(teamColor)) ? Number(teamColor) : null;
    if (normalizedTeamColor !== null) {
        const teamAccentMaterial = new THREE.MeshBasicMaterial({ color: normalizedTeamColor });
        const teamAccent = new THREE.Mesh(assets.teamAccentGeometry, teamAccentMaterial);
        teamAccent.position.set(0, 1.76, -0.45);
        root.add(teamAccent);
        root.userData.teamAccent = teamAccent;
        root.userData.disposableMaterials = [teamAccentMaterial];
    }
    for (const side of [-1, 1]) {
        const track = new THREE.Mesh(assets.trackGeometry, assets.trackMaterial);
        track.position.set(side * 2.75, 0.65, 0);
        root.add(track);
    }

    const headPivot = new THREE.Group();
    headPivot.position.y = TANK_TURRET_HEIGHT;
    root.add(headPivot);
    headPivot.add(new THREE.Mesh(assets.turretGeometry, assets.turretMaterial));
    headPivot.add(new THREE.Mesh(assets.barrelGeometry, assets.turretMaterial));
    const flash = new THREE.Mesh(assets.flashGeometry, assets.flashMaterial);
    flash.position.z = 4.6;
    flash.visible = false;
    headPivot.add(flash);

    const healthMaterial = new THREE.MeshBasicMaterial({ color: normalizedTeamColor ?? HEALTH_COLOR });
    const healthBack = new THREE.Mesh(assets.healthBackGeometry, assets.healthBackMaterial);
    healthBack.position.y = 3.7;
    root.add(healthBack);
    const healthFill = new THREE.Mesh(assets.healthFillGeometry, healthMaterial);
    healthFill.position.set(0, 3.7, 0.08);
    root.add(healthFill);

    root.userData.headPivot = headPivot;
    root.userData.muzzleFlash = flash;
    root.userData.healthFill = healthFill;
    root.userData.teamColor = normalizedTeamColor;
    root.userData.disposableMaterials = [...(root.userData.disposableMaterials || []), healthMaterial];
    renderer.addToScene(root);
    return root;
}

/** Places the model on the ground point and shows the remaining hit points. */
export function updateMapUnitVisual(unit) {
    const root = unit?.root;
    if (!root) return;
    root.position.copy(unit.groundPosition);
    root.rotation.y = unit.yaw;
    const healthFill = root.userData.healthFill;
    if (!healthFill) return;
    const ratio = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    healthFill.scale.x = Math.max(0.001, ratio);
    healthFill.position.x = -2 * (1 - ratio);
    healthFill.material.color.setHex(ratio <= 0.3 ? LOW_HEALTH_COLOR : (root.userData.teamColor ?? HEALTH_COLOR));
}

export function removeMapUnitVisual(renderer, unit) {
    const root = unit?.root;
    if (!root) return;
    renderer?.removeFromScene?.(root);
    for (const material of root.userData.disposableMaterials || []) material?.dispose?.();
    unit.root = null;
}

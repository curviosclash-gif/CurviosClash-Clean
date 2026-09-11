import * as THREE from 'three';

const TURRET_MG_COLOR = 0xffb347;
const TURRET_ROCKET_COLOR = 0xff4d6d;
const TURRET_LOW_HP_COLOR = 0xff5533;

function resolveAccentColor(definition) {
    const ownerColor = Number(definition?.ownerColor);
    if (Number.isFinite(ownerColor)) return ownerColor;
    return definition?.weapon === 'rocket' ? TURRET_ROCKET_COLOR : TURRET_MG_COLOR;
}

export function createStaticTurretVisual(system, definition, position, authoredScale = 1) {
    const renderer = system.entityManager?.renderer;
    if (!renderer) return null;
    const root = new THREE.Group();
    root.position.copy(position);
    root.scale.setScalar(Math.max(0.001, Number(authoredScale) || 1));
    const base = new THREE.Mesh(system._baseGeometry, system._baseMaterial);
    base.position.y = -1.1;
    root.add(base);

    const accentColor = resolveAccentColor(definition);
    const accentMaterial = new THREE.MeshBasicMaterial({
        color: accentColor,
        transparent: true,
        opacity: 0.9,
    });
    const accent = new THREE.Mesh(system._accentGeometry, accentMaterial);
    accent.rotation.x = Math.PI / 2;
    accent.position.y = -0.95;
    root.add(accent);

    const headPivot = new THREE.Group();
    root.add(headPivot);
    const weaponMaterial = definition.weapon === 'rocket' ? system._rocketMaterial : system._mgMaterial;
    headPivot.add(new THREE.Mesh(system._headGeometry, weaponMaterial));
    const barrel = new THREE.Mesh(system._barrelGeometry, weaponMaterial);
    if (definition.weapon === 'rocket') barrel.scale.set(3.2, 3.2, 1);
    barrel.position.z = 2.1;
    headPivot.add(barrel);
    const flash = new THREE.Mesh(system._flashGeometry, system._flashMaterial);
    flash.position.z = 4.1;
    flash.visible = false;
    headPivot.add(flash);

    const disposableMaterials = [accentMaterial];
    let healthFill = null;
    if (definition.destructible === true || definition.deployed === true) {
        const healthBack = new THREE.Mesh(system._healthBarGeometry, system._healthBackMaterial);
        healthBack.position.set(0, 2.65, 0);
        root.add(healthBack);
        const healthMaterial = new THREE.MeshBasicMaterial({ color: accentColor });
        healthFill = new THREE.Mesh(system._healthBarFillGeometry, healthMaterial);
        healthFill.position.set(0, 2.65, 0.08);
        root.add(healthFill);
        disposableMaterials.push(healthMaterial);
    }

    root.userData.muzzleFlash = flash;
    root.userData.headPivot = headPivot;
    root.userData.accent = accent;
    root.userData.accentColor = accentColor;
    root.userData.healthFill = healthFill;
    root.userData.disposableMaterials = disposableMaterials;
    renderer.addToScene(root);
    return root;
}

function updateStatusVisual(turret, dt) {
    const root = turret.root;
    if (!root) return;
    const hpRatio = Number.isFinite(turret.maxHp)
        ? Math.max(0, Math.min(1, turret.hp / Math.max(1, turret.maxHp)))
        : 1;
    const healthFill = root.userData.healthFill;
    if (healthFill) {
        healthFill.scale.x = Math.max(0.001, hpRatio);
        healthFill.position.x = -1.5 * (1 - hpRatio);
        healthFill.material.color.setHex(hpRatio <= 0.3 ? TURRET_LOW_HP_COLOR : root.userData.accentColor);
    }
    const accent = root.userData.accent;
    if (!accent) return;
    const expiring = Number.isFinite(turret.expiresRemaining) && turret.expiresRemaining <= 3;
    const acquiring = turret.acquireRemaining > 0;
    const pulseTime = Math.max(0, Number(turret.visualTime) || 0) + dt;
    turret.visualTime = pulseTime;
    const pulse = acquiring || expiring ? 1 + Math.sin(pulseTime * (acquiring ? 24 : 14)) * 0.12 : 1;
    accent.scale.setScalar(pulse);
    accent.material.opacity = acquiring ? 0.45 + Math.abs(Math.sin(pulseTime * 24)) * 0.5 : 0.9;
}

export function updateStaticTurretVisual(system, turret, target, dt) {
    updateStatusVisual(turret, dt);
    turret.acquireRemaining = Math.max(0, (Number(turret.acquireRemaining) || 0) - dt);
    if (!target?.position) return 1;
    system._tmpAim.subVectors(target.position, turret.position);
    if (system._tmpAim.lengthSq() <= 0.000001) return 1;
    system._tmpAim.normalize();
    const angle = turret.aimDirection.angleTo(system._tmpAim);
    if (angle > 0.000001) {
        const blend = Math.min(1, (turret.turnRateRadians * dt) / angle);
        turret.aimDirection.lerp(system._tmpAim, blend).normalize();
    } else {
        turret.aimDirection.copy(system._tmpAim);
    }
    system._tmpPoint.copy(turret.position).add(turret.aimDirection);
    turret.root?.userData?.headPivot?.lookAt?.(system._tmpPoint);
    return turret.aimDirection.dot(system._tmpAim);
}

export function playReplicatedStaticTurretShot(system, turret) {
    if (!turret?.position || turret.aimDirection.lengthSq() <= 0.000001) return;
    system._tmpAim.copy(turret.aimDirection).normalize();
    system._tmpMuzzle.copy(turret.position).addScaledVector(system._tmpAim, 4.2 * turret.authoredScale);
    if (turret.weapon !== 'rocket') {
        system._tmpPoint.copy(system._tmpMuzzle).addScaledVector(system._tmpAim, turret.range);
        system._tracerFx.spawnTracer(system._tmpMuzzle, system._tmpPoint, false, {
            TRACER_COLOR: Number(turret.ownerPlayer?.color) || TURRET_MG_COLOR,
            TRACER_BEAM_RADIUS: 0.11,
            TRACER_BULLET_RADIUS: 0.28,
        });
    }
    turret.flashRemaining = Math.max(turret.flashRemaining, 0.09);
    if (turret.root?.userData?.muzzleFlash) turret.root.userData.muzzleFlash.visible = true;
    if (system._shouldPlayTurretAudio(turret)) {
        system.entityManager?.audio?.play?.(turret.weapon === 'rocket' ? 'ROCKET_SHOOT' : 'MG_SHOOT', {
            intensity: 0.35,
        });
    }
}

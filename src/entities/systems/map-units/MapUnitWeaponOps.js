import * as THREE from 'three';
import {
    hasStaticTurretLineOfSight,
    resolveStaticTurretTarget,
} from '../static-turret/StaticTurretTargetingOps.js';
import { updateStaticTurretVisual } from '../static-turret/StaticTurretVisualOps.js';
import { triggerMapUnitRecoil } from './MapUnitMotionFxOps.js';

/**
 * The tank turret is "a static turret on wheels" (idea 4). Each weapon of a tank is therefore a
 * turret-shaped mount that shares the tank's position, and the static turret code does the rest:
 * target choice, line of sight, turning the head and firing (tracers, rockets, audio, kill credit).
 * Only the first mount turns the visible turret; a second weapon aims on its own, unseen.
 *
 * The mounts are not static turrets: they are in no turret list, have no hit points and cannot be
 * shot. What gets shot is the tank itself.
 */

const MOUNT_TURN_RATE = 3;

function createMount(unit, weapon, settings, source, proxyRoot, position = unit.position) {
    const aimDirection = new THREE.Vector3(Math.sin(unit.yaw), 0, Math.cos(unit.yaw));
    return {
        id: `${unit.id}:${weapon}`,
        weapon,
        rocketType: settings.rocketType || null,
        damage: Number(settings.damage) || 0,
        cooldown: settings.cooldown,
        range: settings.range * unit.scale,
        authoredScale: unit.scale,
        position,
        aimDirection,
        root: proxyRoot,
        source,
        ownerIndex: -1,
        deployed: false,
        destructible: false,
        targetPlayers: unit.definition.targetPlayers,
        targetTrails: false,
        cooldownRemaining: settings.cooldown * 0.5,
        flashRemaining: 0,
        shotsFired: 0,
        target: null,
        targetHoldRemaining: 0,
        targetReacquireRemaining: 0,
        targetHoldSeconds: 0.3,
        targetReacquireSeconds: 0.12,
        losSampleStep: 0.5,
        acquireDelaySeconds: 0.22,
        acquireRemaining: 0,
        turnRateRadians: MOUNT_TURN_RATE,
        fireDotMin: 0.985,
        audioRange: 80,
        visualTime: 0,
    };
}

/**
 * The shooter every tank bullet and rocket is credited to. Its `staticTurret` flag makes the
 * projectile and kill code treat it like any other emplacement.
 */
export function createUnitSource(unit) {
    return {
        index: -1,
        isBot: true,
        staticTurret: true,
        mapUnit: true,
        turretId: unit.id,
        targetPlayers: unit.definition.targetPlayers,
        alive: true,
        combatLabel: unit.kind === 'swarm' ? 'Drohne' : 'Panzer',
        position: unit.position,
        getAimDirection: (out) => out.copy(unit.mounts?.[0]?.aimDirection || out.set(0, 0, 1)),
    };
}

export function createUnitMounts(unit) {
    const weapons = unit.definition.weapons;
    const userData = unit.root?.userData || {};
    const mounts = [];
    if (unit.kind === 'swarm' && weapons.mg) {
        for (const member of unit.members || []) {
            const mount = createMount(unit, 'mg', weapons.mg, unit.source, { userData: {} }, member.position);
            mount.id = `${unit.id}:drone_${member.index + 1}:mg`;
            mount.memberIndex = member.index;
            mounts.push(mount);
        }
        return mounts;
    }
    const entries = [['mg', weapons.mg], ['rocket', weapons.rocket]].filter(([, settings]) => settings);
    for (const [weapon, settings] of entries) {
        // Only the first mount gets the head pivot, so two weapons never fight over the turret.
        const proxyRoot = {
            userData: mounts.length === 0
                ? { headPivot: userData.headPivot || null, muzzleFlash: userData.muzzleFlash || null }
                : { muzzleFlash: userData.muzzleFlash || null },
        };
        mounts.push(createMount(unit, weapon, settings, unit.source, proxyRoot));
    }
    return mounts;
}

/**
 * One tick of the tank weapons. `canFire` is false on a network replica: it still turns the turret
 * the way the host snapshot says, but only the host decides who gets shot.
 */
export function updateUnitWeapons(system, unit, dt, canFire) {
    const turrets = system.entityManager?._staticTurretSystem;
    let flashing = false;
    for (const mount of unit.mounts) {
        if (Number.isInteger(mount.memberIndex) && unit.members?.[mount.memberIndex]?.alive !== true) continue;
        mount.cooldownRemaining = Math.max(0, mount.cooldownRemaining - dt);
        mount.flashRemaining = Math.max(0, mount.flashRemaining - dt);
        flashing = flashing || mount.flashRemaining > 0;
        const target = canFire ? resolveStaticTurretTarget(system, mount, dt) : null;
        const aimDot = updateStaticTurretVisual(system, mount, target, dt);
        if (
            target
            && mount.acquireRemaining <= 0
            && aimDot >= mount.fireDotMin
            && mount.cooldownRemaining <= 0
            && typeof turrets?.fire === 'function'
            && hasStaticTurretLineOfSight(system, mount, target)
        ) {
            turrets.fire(mount, target);
            triggerMapUnitRecoil(unit);
            flashing = true;
        }
    }
    const flash = unit.root?.userData?.muzzleFlash;
    if (flash) flash.visible = flashing;
}

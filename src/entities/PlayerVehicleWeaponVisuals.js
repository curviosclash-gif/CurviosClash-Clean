import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeArcadeMachineGunId, resolveAnyMachineGunModel } from '../shared/contracts/ArcadeMachineGunContract.js';
import { ROCKET_PICKUP_DEFINITIONS } from '../shared/contracts/RocketPickupDefinitionsContract.js';

const MAX_ROCKETS = 5;
const GUN_PROFILES = Object.freeze({
    vector_m7: { length: 1, radius: 1, barrels: 1, muzzle: 1.15 },
    raptor_r9: { length: 0.82, radius: 0.67, barrels: 2, muzzle: 0.9 },
    bastion_h3: { length: 0.88, radius: 1.55, barrels: 1, muzzle: 1.35 },
    lance_p4: { length: 1.28, radius: 0.62, barrels: 1, muzzle: 0.72 },
    swarm_s2: { length: 0.78, radius: 0.55, barrels: 3, muzzle: 0.78 },
    ember_g5: { length: 0.94, radius: 1.2, barrels: 1, muzzle: 1.5 },
    pulse_p3: { length: 1.02, radius: 0.82, barrels: 3, muzzle: 1.1 },
});
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _identity = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();

function getWeaponLayout(vehicle) {
    const box = vehicle.localBox;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const width = size.x;
    const floorY = box.min.y + size.y * 0.2;
    const id = String(vehicle.config?.id || '');
    let slots;
    let guns;
    if (id === 'manta') {
        slots = [
            [-4.9, floorY, -6.8], [4.9, floorY, -6.8],
            [-8.1, floorY, -5.6], [8.1, floorY, -5.6],
            [0, floorY, 1.2],
        ];
        guns = [[-2.1, box.max.y - 0.55, -7.4], [2.1, box.max.y - 0.55, -7.4]];
    } else if (id === 'arrow') {
        slots = [
            [-0.55, floorY, 2.55], [0.55, floorY, 2.55],
            [-1.05, floorY, 2.8], [1.05, floorY, 2.8],
            [0, floorY, 2.3],
        ];
        guns = [[-0.35, box.max.y - 0.25, -0.85], [0.35, box.max.y - 0.25, -0.85]];
    } else if (id === 'drone') {
        slots = [
            [-1.15, floorY, -0.35], [1.15, floorY, -0.35],
            [-1.4, floorY, 0.8], [1.4, floorY, 0.8],
            [0, floorY, 0.95],
        ];
        guns = [[-0.38, box.min.y - 0.05, -1.0], [0.38, box.min.y - 0.05, -1.0]];
    } else {
        const xOuter = Math.max(0.18, width * 0.37);
        const xInner = Math.max(0.12, width * 0.23);
        slots = [
            [-xInner, floorY, 0.05], [xInner, floorY, 0.05],
            [-xOuter, floorY, 0.3], [xOuter, floorY, 0.3],
            [0, floorY, center.z + size.z * 0.18],
        ];
        guns = [[-width * 0.16, box.max.y - size.y * 0.18, box.min.z + size.z * 0.3],
            [width * 0.16, box.max.y - size.y * 0.18, box.min.z + size.z * 0.3]];
    }
    const length = size.z;
    const gunLength = THREE.MathUtils.clamp(length * 0.3, 0.5, 1.8);
    const rocketLength = THREE.MathUtils.clamp(length * 0.18, 0.65, 1.8);
    const gunRadius = THREE.MathUtils.clamp(width * 0.028, 0.035, 0.16);
    const rocketRadius = THREE.MathUtils.clamp(width * 0.035, 0.045, 0.23);
    return { slots, guns, gunLength, rocketLength, gunRadius, rocketRadius };
}

function transformedGeometry(geometry, position, rotation, scale) {
    const copy = geometry.clone();
    _matrix.compose(position, rotation, scale);
    copy.applyMatrix4(_matrix);
    return copy;
}

function mergeAndDispose(geometries) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    return merged;
}

function buildRackGeometry(layout) {
    const geometries = [];
    const add = (geometry, x, y, z, sx = 1, sy = 1, sz = 1, rotation = _identity) => {
        geometries.push(transformedGeometry(geometry, _position.set(x, y, z), rotation, _scale.set(sx, sy, sz)));
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const [x, y, z] of layout.slots) {
        add(box, x, y - layout.rocketRadius * 0.55, z, layout.rocketRadius * 1.25, layout.rocketRadius * 0.55, layout.rocketLength * 0.7);
        add(box, x, y - layout.rocketRadius * 1.2, z, layout.rocketRadius * 1.8, layout.rocketRadius * 0.35, layout.rocketRadius * 0.22);
    }
    box.dispose();
    return mergeAndDispose(geometries);
}

function buildGunGeometry(layout, modelId) {
    const profile = GUN_PROFILES[modelId] || GUN_PROFILES.vector_m7;
    const length = layout.gunLength * profile.length;
    const radius = layout.gunRadius * profile.radius;
    const geometries = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
    const forward = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const add = (geometry, x, y, z, sx, sy, sz, rotation = _identity) => {
        geometries.push(transformedGeometry(geometry, _position.set(x, y, z), rotation, _scale.set(sx, sy, sz)));
    };
    add(box, 0, 0, length * 0.08, radius * 2.8, radius * 2.3, radius * 3.2);
    const barrelOffset = profile.barrels === 2 ? radius * 0.75 : 0;
    for (let index = 0; index < profile.barrels; index += 1) {
        const x = profile.barrels === 2 ? (index === 0 ? -barrelOffset : barrelOffset) : 0;
        add(cylinder, x, 0, -length * 0.4, radius / profile.barrels, length * 0.9, radius / profile.barrels, forward);
        add(cylinder, x, 0, -length * 0.9, radius * profile.muzzle / profile.barrels,
            radius * 0.16, radius * profile.muzzle / profile.barrels, forward);
    }
    if (modelId === 'bastion_h3') {
        add(box, 0, radius * 0.65, -length * 0.27, radius * 3.1, radius * 1.05, length * 0.55);
    } else if (modelId === 'lance_p4') {
        add(box, 0, radius * 0.7, -length * 0.45, radius * 1.3, radius * 0.55, length * 0.8);
    }
    box.dispose();
    cylinder.dispose();
    return mergeAndDispose(geometries);
}

function buildHardpointGeometry(layout, modelId) {
    const geometries = [buildRackGeometry(layout)];
    for (const [x, y, z] of layout.guns) {
        const gun = buildGunGeometry(layout, modelId);
        gun.translate(x, y, z);
        geometries.push(gun);
    }
    const merged = mergeGeometries(geometries, true);
    geometries.forEach((geometry) => geometry.dispose());
    return merged;
}

export function attachPlayerVehicleWeaponVisuals(vehicle) {
    if (!vehicle?.isModularVehicle || vehicle.weaponVisuals) return vehicle?.weaponVisuals || null;
    const layout = getWeaponLayout(vehicle);
    const root = new THREE.Group();
    root.name = 'PlayerVehicleWeaponVisuals';
    root.userData.runtimeVisual = true;

    const rackMaterial = new THREE.MeshStandardMaterial({ color: 0x526170, metalness: 0.86, roughness: 0.32 });
    const gunMaterial = new THREE.MeshStandardMaterial({
        color: resolveAnyMachineGunModel('vector_m7').tracerColor, metalness: 0.86, roughness: 0.32,
    });
    const hardpoints = new THREE.Mesh(buildHardpointGeometry(layout, 'vector_m7'),
        [rackMaterial, gunMaterial, gunMaterial]);
    hardpoints.name = 'PlayerWeaponHardpoints';
    hardpoints.userData.runtimeVisual = true;
    root.add(hardpoints);
    const gunMounts = layout.guns.map(([x, y, z], index) => {
        const mount = new THREE.Group();
        mount.name = index === 0 ? 'PlayerMachineGunMountLeft' : 'PlayerMachineGunMountRight';
        mount.position.set(x, y, z);
        mount.userData.runtimeVisual = true;
        root.add(mount);
        return mount;
    });

    const rocketGeometry = new THREE.ConeGeometry(layout.rocketRadius, layout.rocketLength, 8);
    rocketGeometry.rotateX(-Math.PI / 2);
    const rockets = new THREE.InstancedMesh(rocketGeometry, new THREE.MeshStandardMaterial({
        color: 0xffffff, metalness: 0.55, roughness: 0.35, vertexColors: false,
    }), MAX_ROCKETS);
    rockets.name = 'PlayerInventoryRockets';
    rockets.userData.runtimeVisual = true;
    rockets.count = MAX_ROCKETS;
    let maxRocketScale = 1;
    for (const definition of Object.values(ROCKET_PICKUP_DEFINITIONS)) {
        maxRocketScale = Math.max(maxRocketScale, definition.visualScale || 1);
    }
    for (let index = 0; index < MAX_ROCKETS; index += 1) {
        const [x, y, z] = layout.slots[index];
        _matrix.compose(_position.set(x, y, z), _identity,
            _scale.set(maxRocketScale, maxRocketScale, maxRocketScale));
        rockets.setMatrixAt(index, _matrix);
    }
    rockets.computeBoundingBox();
    rockets.computeBoundingSphere();
    for (let index = 0; index < MAX_ROCKETS; index += 1) {
        _matrix.makeScale(0, 0, 0);
        rockets.setMatrixAt(index, _matrix);
    }
    rockets.instanceMatrix.needsUpdate = true;
    root.add(rockets);

    vehicle.weaponVisuals = {
        root,
        hardpoints,
        gunMounts,
        rockets,
        layout,
        _inventory: new Array(MAX_ROCKETS).fill(null),
        _machineGunId: '',
        setMachineGunModel(value) {
            if (value === this._machineGunId) return;
            const id = normalizeArcadeMachineGunId(value);
            if (id === this._machineGunId) return;
            this._machineGunId = id;
            gunMaterial.color.setHex(resolveAnyMachineGunModel(id).tracerColor);
            hardpoints.geometry.dispose();
            hardpoints.geometry = buildHardpointGeometry(layout, id);
        },
        syncRockets(inventory) {
            let dirty = false;
            const source = Array.isArray(inventory) ? inventory : null;
            const length = Math.min(MAX_ROCKETS, source?.length || 0);
            for (let index = 0; index < MAX_ROCKETS; index += 1) {
                const rawType = index < length ? source[index] : null;
                if (rawType === this._inventory[index]) continue;
                this._inventory[index] = rawType;
                dirty = true;
                if (rawType === null || rawType === undefined) {
                    _matrix.makeScale(0, 0, 0);
                    rockets.setMatrixAt(index, _matrix);
                    continue;
                }
                const key = String(rawType).trim().toUpperCase();
                const definition = ROCKET_PICKUP_DEFINITIONS[key] || ROCKET_PICKUP_DEFINITIONS.ROCKET_MEDIUM;
                const color = definition.color;
                const scale = definition.visualScale || 1;
                const [x, y, z] = layout.slots[index];
                _position.set(x, y, z);
                _scale.set(scale, scale, scale);
                _matrix.compose(_position, _identity, _scale);
                rockets.setMatrixAt(index, _matrix);
                rockets.setColorAt(index, new THREE.Color(color));
            }
            if (dirty) {
                rockets.instanceMatrix.needsUpdate = true;
                if (rockets.instanceColor) rockets.instanceColor.needsUpdate = true;
            }
        },
        dispose() {
            root.removeFromParent();
            hardpoints.geometry.dispose();
            rackMaterial.dispose();
            gunMaterial.dispose();
            rockets.geometry.dispose();
            rockets.material.dispose();
        },
    };
    vehicle.add(root);
    vehicle.weaponVisuals.setMachineGunModel('vector_m7');
    return vehicle.weaponVisuals;
}

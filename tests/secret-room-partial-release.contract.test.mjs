import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { SunflowerKernelController } from '../src/entities/arena/SunflowerKernelController.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { SUNFLOWER_MEADOW_HONEY_CHAMBER } from '../src/core/config/maps/presets/sunflower_meadow/SunflowerMeadowHoneyChamber.js';
import { formatDandelionSeedStatus } from '../src/ui/DandelionSeedStatusText.js';

const ROOM = {
    id: 'kernel_room',
    modes: ['HUNT', 'ARCADE'],
    stayLimitSeconds: 20,
    entryPortal: { pos: [10, 100, -5] },
    roomPortal: { pos: [0, -11, 0] },
    bounds: { min: [-20, -30, -20], max: [20, -4, 20] },
    ejectPoint: { pos: [0, 60, 60], yawDeg: 0 },
    items: [],
    unlock: { source: 'sunflowerKernels', when: 'allReleased', requiredReleases: 2, delaySeconds: 0 },
};

function kernelScene(count) {
    const scene = new THREE.Group();
    const head = new THREE.Group();
    head.userData = { role: 'shootable_sunflower_head', kernel_hit_radius: 1 };
    scene.add(head);
    for (let index = 1; index <= count; index += 1) {
        const kernel = new THREE.Group();
        kernel.name = `SunflowerKernel_00${index}_SHOOTABLE_nocol`;
        kernel.position.set(index * 0.2, 0, 0);
        kernel.userData = { role: 'shootable_kernel', kernel_index: index, hit_radius_x: 0.05, hit_radius_y: 0.05, hit_radius_z: 0.05 };
        head.add(kernel);
    }
    scene.updateWorldMatrix(true, true);
    return scene;
}

function createSystem(room, controller, elapsedSeconds) {
    const portal = { secret: true, roomId: room.id, active: false, meshA: { visible: false }, meshB: { visible: false }, cooldowns: new Map() };
    const arena = {
        currentMapDefinition: { secretRooms: [room] },
        portals: [portal],
        glbAnimationElapsedSeconds: elapsedSeconds,
        getSunflowerKernelProgress: () => controller.getProgress(),
        getSunflowerKernelReleaseSecondsAt: (count) => controller.getReleaseSecondsAt(count),
    };
    const system = new SecretRoomSystem({
        arena,
        players: [],
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        config: { ARENA: { MAP_SCALE: 3 } },
    });
    return { system, arena };
}

test('a release unlock keeps a positive whole number of required releases and drops anything else', () => {
    const [room] = normalizeSecretRooms([ROOM]);
    assert.deepEqual(room.unlock, { source: 'sunflowerKernels', when: 'allReleased', requiredReleases: 2, delaySeconds: 0 });
    for (const invalid of [0, -3, 'many', '2', true, [], {}, null, undefined, NaN, Infinity, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
        const [plain] = normalizeSecretRooms([{ ...ROOM, unlock: { ...ROOM.unlock, requiredReleases: invalid } }]);
        assert.equal('requiredReleases' in plain.unlock, false, `${invalid} means: every release`);
    }
});

test('the controller tells the second in which the n-th part was released', () => {
    const controller = new SunflowerKernelController(kernelScene(4));
    controller.releaseByName('SunflowerKernel_003_SHOOTABLE_nocol', 5.25);
    controller.releaseByName('SunflowerKernel_001_SHOOTABLE_nocol', 7.5);
    assert.equal(controller.getReleaseSecondsAt(1), 5.25);
    assert.equal(controller.getReleaseSecondsAt(2), 7.5);
    assert.equal(controller.getReleaseSecondsAt(3), Infinity);
    controller.reset();
    assert.equal(controller.getReleaseSecondsAt(1), Infinity);
});

test('the room opens once the required share is released and the HUD counts to that share', () => {
    const [room] = normalizeSecretRooms([ROOM]);
    const controller = new SunflowerKernelController(kernelScene(4));
    const { system, arena } = createSystem(room, controller, 10);
    system.startRound();
    assert.equal(system.isRoomOpen(room.id), false);
    let objective = system.getSeedObjective();
    assert.equal(objective.total, 2, 'the HUD goal is the required share, not every kernel');
    assert.equal(formatDandelionSeedStatus({ active: true, ...objective }), 'SONNENBLUME · 0/2 KERNE → HONIGKAMMER');

    controller.releaseByName('SunflowerKernel_002_SHOOTABLE_nocol', 4);
    system.update(0);
    assert.equal(system.isRoomOpen(room.id), false);
    controller.releaseByName('SunflowerKernel_004_SHOOTABLE_nocol', 9);
    arena.glbAnimationElapsedSeconds = 9;
    system.update(0);
    assert.equal(system.isRoomOpen(room.id), true, 'the second kernel opens the room at its own second');
    objective = system.getSeedObjective();
    assert.equal(objective.released, 2);
    assert.equal(objective.portalOpen, true);

    controller.releaseByName('SunflowerKernel_001_SHOOTABLE_nocol', 11);
    system.update(0);
    assert.equal(system.getSeedObjective().released, 2, 'the count stops at the goal');
});

test('the honey chamber opens at 40 percent of the 220 kernels', () => {
    const [room] = normalizeSecretRooms([SUNFLOWER_MEADOW_HONEY_CHAMBER]);
    assert.equal(room.unlock.requiredReleases, 88);
});

test('host and replica open the room together on the 88th serialized kernel release and reset next round', () => {
    const [room] = normalizeSecretRooms([{
        ...ROOM,
        unlock: { ...ROOM.unlock, requiredReleases: 88 },
    }]);
    const hostController = new SunflowerKernelController(kernelScene(88));
    const replicaController = new SunflowerKernelController(kernelScene(88));
    const host = createSystem(room, hostController, 5);
    const replica = createSystem(room, replicaController, 5);
    host.system.startRound();
    replica.system.startRound();

    for (let index = 1; index <= 87; index += 1) {
        hostController.releaseByName(`SunflowerKernel_00${index}_SHOOTABLE_nocol`, 5);
    }
    replicaController.applyNetworkState(hostController.serialize());
    host.system.update(0);
    replica.system.update(0);
    assert.equal(host.system.getSeedObjective().released, 87);
    assert.equal(replica.system.getSeedObjective().released, 87);
    assert.equal(host.system.isRoomOpen(room.id), false);
    assert.equal(replica.system.isRoomOpen(room.id), false);

    hostController.releaseByName('SunflowerKernel_0088_SHOOTABLE_nocol', 12);
    replicaController.applyNetworkState(hostController.serialize());
    host.arena.glbAnimationElapsedSeconds = 12;
    replica.arena.glbAnimationElapsedSeconds = 12;
    host.system.update(0);
    replica.system.update(0);

    assert.equal(host.system.getSeedObjective().completedAtSeconds, 12);
    assert.equal(replica.system.getSeedObjective().completedAtSeconds, 12);
    assert.equal(host.system.isRoomOpen(room.id), true);
    assert.equal(replica.system.isRoomOpen(room.id), true);
    assert.equal(host.system.getRooms()[0].unlockSeconds, 12);
    assert.equal(replica.system.getRooms()[0].unlockSeconds, 12);

    hostController.reset();
    replicaController.reset();
    hostController.applyNetworkState(hostController.serialize());
    replicaController.applyNetworkState(hostController.serialize());
    host.system.startRound();
    replica.system.startRound();
    host.system.update(0);
    replica.system.update(0);
    assert.equal(host.system.getSeedObjective().released, 0);
    assert.equal(replica.system.getSeedObjective().released, 0);
    assert.equal(host.system.isRoomOpen(room.id), false);
    assert.equal(replica.system.isRoomOpen(room.id), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { SunflowerKernelController } from '../src/entities/arena/SunflowerKernelController.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import {
    normalizeSecretRooms,
    resolveSecretRoomUnlockSeconds,
} from '../src/shared/contracts/SecretRoomContract.js';
import { updateHudObjectiveMarker } from '../src/ui/HudObjectiveMarker.js';
import { formatDandelionSeedStatus } from '../src/ui/DandelionSeedStatusText.js';

const ROOM_BASE = {
    id: 'kernel_room',
    modes: ['HUNT', 'ARCADE'],
    stayLimitSeconds: 20,
    entryPortal: { pos: [10, 100, -5] },
    roomPortal: { pos: [0, -11, 0] },
    bounds: { min: [-20, -30, -20], max: [20, -4, 20] },
    ejectPoint: { pos: [0, 60, 60], yawDeg: 0 },
    items: [],
};

function roomWith(source) {
    return { ...ROOM_BASE, unlock: { source, when: 'allReleased', delaySeconds: 0 } };
}

function createSystem(room, { modeType = 'HUNT', dandelion = null, sunflower = null } = {}) {
    const portal = {
        secret: true,
        roomId: room.id,
        active: false,
        meshA: { visible: false },
        meshB: { visible: false },
        cooldowns: new Map(),
    };
    const arena = {
        currentMapDefinition: { secretRooms: [room] },
        portals: [portal],
        glbAnimationElapsedSeconds: 50,
        getDandelionSeedProgress: () => dandelion,
        getSunflowerKernelProgress: () => sunflower,
    };
    const system = new SecretRoomSystem({
        arena,
        players: [],
        gameModeStrategy: { modeType, getPickupModeType: () => modeType },
        config: { ARENA: { MAP_SCALE: 3 } },
    });
    return { system, portal };
}

function progress(released, total = 4, completedAtSeconds = 0) {
    return {
        total, released, remaining: total - released,
        allReleased: released === total, completedAtSeconds,
    };
}

test('a sunflower kernel room is a valid unlock and opens only on the last kernel', () => {
    const [room] = normalizeSecretRooms([roomWith('sunflowerKernels')]);
    assert.deepEqual(room.unlock, { source: 'sunflowerKernels', when: 'allReleased', delaySeconds: 0 });
    assert.equal(resolveSecretRoomUnlockSeconds(room, progress(3)), Infinity);
    assert.equal(resolveSecretRoomUnlockSeconds(room, progress(4, 4, 12.5)), 12.5);

    const state = progress(3);
    const { system } = createSystem(room, { sunflower: state });
    system.startRound();
    assert.equal(system.isRoomOpen(room.id), false);
    Object.assign(state, progress(4, 4, 49));
    system.update(0);
    assert.equal(system.isRoomOpen(room.id), true);
});

test('a kernel-locked room survives the map schema round trip', () => {
    const document = normalizeMapSchemaDocument({ secretRooms: [roomWith('sunflowerKernels')] });
    assert.equal(document.secretRooms.length, 1);
    assert.deepEqual(document.secretRooms[0].unlock, {
        source: 'sunflowerKernels', when: 'allReleased', delaySeconds: 0,
    });
});

test('the seed objective belongs to the round only where its room exists in the mode', () => {
    const [room] = normalizeSecretRooms([roomWith('dandelionSeeds')]);
    const classic = createSystem(room, { modeType: 'CLASSIC', dandelion: progress(4, 4, 10) });
    classic.system.startRound();
    assert.equal(classic.system.getSeedObjective(), null,
        'CLASSIC has no chamber, so the flower must not announce a portal');

    const hunt = createSystem(room, { dandelion: progress(1) });
    hunt.system.startRound();
    const objective = hunt.system.getSeedObjective();
    assert.equal(objective.source, 'dandelionSeeds');
    assert.equal(objective.released, 1);
    assert.equal(objective.portalOpen, false);
    assert.equal(formatDandelionSeedStatus({ active: true, ...objective }),
        'PUSTEBLUME · 1/4 SAMEN → WURZELKAMMER');
});

test('an open room hands the HUD its entry portal in world units', () => {
    const [room] = normalizeSecretRooms([roomWith('sunflowerKernels')]);
    const { system } = createSystem(room, { sunflower: progress(4, 4, 20) });
    system.startRound();
    const objective = system.getSeedObjective();
    assert.equal(objective.portalOpen, true);
    assert.deepEqual(objective.portalPosition, { x: 30, y: 300, z: -15 });
    assert.equal(formatDandelionSeedStatus({ active: true, ...objective }), 'PORTAL OFFEN · HONIGKAMMER');
});

test('a plant that never loaded cannot lock its room away for the whole match', () => {
    const [room] = normalizeSecretRooms([roomWith('dandelionSeeds')]);
    const { system } = createSystem(room);
    system.startRound();
    assert.equal(system.isRoomOpen(room.id), true);
});

test('sunflower kernels report release progress in the shared shape and reset it', () => {
    const scene = new THREE.Group();
    const head = new THREE.Group();
    head.userData = { role: 'shootable_sunflower_head', kernel_hit_radius: 1 };
    scene.add(head);
    for (let index = 1; index <= 2; index += 1) {
        const kernel = new THREE.Group();
        kernel.name = `SunflowerKernel_00${index}_SHOOTABLE_nocol`;
        kernel.position.set(index * 0.2, 0, 0);
        kernel.userData = {
            role: 'shootable_kernel', kernel_index: index,
            hit_radius_x: 0.05, hit_radius_y: 0.05, hit_radius_z: 0.05,
        };
        head.add(kernel);
    }
    scene.updateWorldMatrix(true, true);
    const controller = new SunflowerKernelController(scene);
    const state = controller.getProgress();
    assert.deepEqual(state, progress(0, 2));
    controller.releaseByName('SunflowerKernel_002_SHOOTABLE_nocol', 3);
    controller.releaseByName('SunflowerKernel_001_SHOOTABLE_nocol', 2);
    assert.equal(controller.getProgress(), state, 'the progress object is reused');
    assert.deepEqual(state, progress(2, 2, 3));
    controller.reset();
    assert.deepEqual(state, progress(0, 2));
});

function fakeHud() {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000);
    camera.position.set(0, 0, 50);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const texts = new Map();
    const flags = new Map();
    return {
        texts,
        flags,
        playerIndex: 0,
        objectiveReticle: 'reticle',
        objectiveLabel: 'label',
        objectiveDistance: 'distance',
        objectiveBox: 'box',
        objectiveArrow: 'arrow',
        container: { clientWidth: 800, clientHeight: 600 },
        _playerPosition: new THREE.Vector3(),
        _targetPosition: new THREE.Vector3(),
        _vec: new THREE.Vector3(),
        _getCamera: () => camera,
        _setText: (element, text) => texts.set(element, text),
        _setClassFlag: (element, name, value) => flags.set(`${element}.${name}`, value),
        _setStyle: () => {},
    };
}

test('the HUD pointer leads to an opened chamber until the player is inside', () => {
    const hud = fakeHud();
    const seeds = {
        active: true, source: 'dandelionSeeds', portalOpen: true, portalPosition: { x: 0, y: 0, z: 0 },
    };
    updateHudObjectiveMarker(hud, { position: { x: 0, y: 0, z: 40 }, dandelionSeeds: seeds });
    assert.equal(hud.flags.get('reticle.hidden'), false);
    assert.equal(hud.texts.get('label'), 'WURZELKAMMER');

    updateHudObjectiveMarker(hud, {
        position: { x: 0, y: 0, z: 40 }, dandelionSeeds: seeds, secretRoom: { inside: true },
    });
    assert.equal(hud.flags.get('reticle.hidden'), true);

    updateHudObjectiveMarker(hud, {
        position: { x: 0, y: 0, z: 40 }, dandelionSeeds: { ...seeds, portalOpen: false },
    });
    assert.equal(hud.flags.get('reticle.hidden'), true);
});

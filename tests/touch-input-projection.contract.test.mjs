import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMatchRenderProjection } from '../src/shared/runtime/MatchRenderProjectionBuilder.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import { TouchInputSource } from '../src/ui/TouchInputSource.js';
import { TOUCH_CONTROL_MODES } from '../src/ui/touch/TouchControlLayoutOps.js';

function createReadyActionState(overrides = {}) {
    return {
        canShootRocket: true,
        canShootRocketNow: true,
        nextRocketType: 'ROCKET',
        shootCooldownRemaining: 0,
        canUse: true,
        canUseNow: true,
        rawType: 'SHIELD_BUBBLE',
        useCooldownRemaining: 0,
        canCycle: true,
        showMg: false,
        ...overrides,
    };
}

function createFakeButtonEls(ids) {
    const buttonEls = {};
    for (const id of ids) {
        buttonEls[id] = { dataset: { action: id }, style: {}, title: '' };
    }
    return buttonEls;
}

test('TouchInputSource reuses the playing-state projection before requesting a new snapshot', () => {
    const cachedProjection = { contractVersion: 'match-runtime-projection.v1', players: [] };
    let snapshotBuilds = 0;
    const source = new TouchInputSource({
        game: {
            playingStateSystem: {
                getMatchRuntimeProjection: () => cachedProjection,
            },
        },
        getMatchRuntimeProjection() {
            snapshotBuilds += 1;
            return { players: [] };
        },
    });

    assert.equal(source._getMatchRuntimeProjection(), cachedProjection);
    assert.equal(snapshotBuilds, 0);
});

test('TouchInputSource normalizes mobile control settings only when the stored object changes', () => {
    const localSettings = { mobileControls: { tiltSensitivity: 1.2 } };
    const source = new TouchInputSource({ game: { settings: { localSettings } } });
    source._resolveActionState = () => createReadyActionState();

    source.poll();
    const firstNormalized = source._mobileControlSettings;
    for (let frame = 0; frame < 60; frame += 1) {
        source.poll();
    }
    assert.equal(source._mobileControlSettings, firstNormalized);
    assert.equal(firstNormalized.tiltSensitivity, 1.2);

    localSettings.mobileControls = { tiltSensitivity: 0.8 };
    source.poll();
    assert.notEqual(source._mobileControlSettings, firstNormalized);
    assert.equal(source._mobileControlSettings.tiltSensitivity, 0.8);
});

test('TouchInputSource writes touch button visuals only when the button state changes', () => {
    const writes = [];
    const source = new TouchInputSource({
        game: { settings: { localSettings: {} } },
        applyButtonVisualState: (button, state) => {
            writes.push(`${button.dataset.action}:${state.title}`);
        },
    });
    source._buttonEls = createFakeButtonEls(['fire', 'useItem', 'nextItem', 'shootMG']);
    let actionState = createReadyActionState();
    source._resolveActionState = () => actionState;

    for (let frame = 0; frame < 60; frame += 1) {
        source.poll();
    }
    assert.equal(writes.length, 4);

    // A cooldown that stays inside the same tenth of a second must not rewrite the title.
    actionState = createReadyActionState({
        canShootRocketNow: false,
        shootCooldownRemaining: 1.24,
    });
    source.poll();
    const afterCooldownStart = writes.length;
    assert.equal(afterCooldownStart, 5);
    assert.equal(writes[4], 'fire:ROCKET | Shoot-CD 1.2s');

    actionState = createReadyActionState({
        canShootRocketNow: false,
        shootCooldownRemaining: 1.2399,
    });
    source.poll();
    assert.equal(writes.length, afterCooldownStart);
});

test('TouchInputSource clears the button cache when the controls are shown again', () => {
    let writes = 0;
    const source = new TouchInputSource({
        game: { settings: { localSettings: {} } },
        applyButtonVisualState: () => {
            writes += 1;
        },
    });
    source._buttonEls = createFakeButtonEls(['fire', 'useItem', 'nextItem', 'shootMG']);
    source._resolveActionState = () => createReadyActionState();

    source.poll();
    assert.equal(writes, 4);
    source._setUIVisibility(true);
    source.poll();
    assert.equal(writes, 8);
});

test('TouchInputSource maps the camera button as an edge and the roll buttons as held', () => {
    const source = new TouchInputSource({ game: { settings: { localSettings: {} } } });
    source._resolveActionState = () => createReadyActionState();

    source._buttons.camera = true;
    source._pendingButtonPresses.add('camera');
    source._buttons.rollLeft = true;

    const first = source.poll();
    assert.equal(first.cameraSwitch, true);
    assert.equal(first.rollLeft, true);
    assert.equal(first.rollRight, false);
    assert.equal(first.rollAxis, 1);

    const second = source.poll();
    assert.equal(second.cameraSwitch, false);
    assert.equal(second.rollLeft, true);
    assert.equal(second.rollAxis, 1);

    source._buttons.rollLeft = false;
    source._buttons.rollRight = true;
    const third = source.poll();
    assert.equal(third.rollLeft, false);
    assert.equal(third.rollRight, true);
    assert.equal(third.rollAxis, -1);

    source._releaseAllControls();
    const fourth = source.poll();
    assert.equal(fourth.rollAxis, 0);
    assert.equal(fourth.cameraSwitch, false);
});

test('TouchInputSource exposes camera and roll buttons in both touch layouts', () => {
    const source = new TouchInputSource({ controlMode: TOUCH_CONTROL_MODES.JOYSTICK });
    const tiltSource = new TouchInputSource({ controlMode: TOUCH_CONTROL_MODES.TILT });

    for (const definitions of [source._resolveButtonDefinitions(), tiltSource._resolveButtonDefinitions()]) {
        const ids = definitions.map((definition) => definition.id);
        assert.equal(ids.includes('camera'), true);
        assert.equal(ids.includes('rollLeft'), true);
        assert.equal(ids.includes('rollRight'), true);
    }
});

test('TouchInputSource dispose is idempotent', () => {
    const source = new TouchInputSource();

    source.dispose();
    assert.doesNotThrow(() => source.dispose());
    assert.equal(source._disposed, true);
});

test('match projections resolve only needed config sections while preserving fallback precedence', () => {
    const player = {
        index: 0,
        alive: true,
        cameraMode: 0,
        position: { x: 1, y: 2, z: 3 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        activeEffects: [{ type: 'INVERT', remaining: 2.5, sourcePlayerIndex: 3 }],
        entityRuntimeConfig: {
            PLAYER: { BOOST_DURATION: 9 },
            CAMERA: { MODES: ['CUSTOM_CAMERA'] },
            GAMEPLAY: { PLANAR_MODE: true },
        },
        getAimDirection(target) {
            return target.set(0, 0, -1);
        },
        getFirstPersonCameraAnchor(target) {
            return target.set(1, 2, 2);
        },
        view: {
            copyRenderTransform(position, quaternion) {
                position.set(1, 2, 3);
                quaternion.set(0, 0, 0, 1);
                return true;
            },
        },
    };
    const entityManager = {
        players: [player],
        _staticTurretSystem: {
            getHudStateForPlayer: () => ({
                count: 1,
                remainingSeconds: 12.4,
                hp: 31,
                maxHp: 45,
                range: 58,
            }),
        },
    };
    const args = {
        game: { entityManager, huntState: {} },
        runtimeState: {
            entityManager,
            config: { PLAYER: { BOOST_DURATION: 2 } },
        },
        facade: {
            session: { getPlayers: () => [] },
            isNetworkSession: () => false,
        },
        sessionRuntime: { lifecycle: { gameStateId: 'PLAYING' } },
    };

    const runtimePlayer = buildMatchRuntimeProjection(args).players[0];
    const renderPlayer = buildMatchRenderProjection(args).players[0];
    for (const projectedPlayer of [runtimePlayer, renderPlayer]) {
        assert.equal(projectedPlayer.boostCapacity, 2);
        assert.equal(projectedPlayer.cameraModeId, 'CUSTOM_CAMERA');
        assert.equal(projectedPlayer.planarMode, true);
    }
    assert.deepEqual(runtimePlayer.turret, {
        count: 1,
        remainingSeconds: 12.4,
        hp: 31,
        maxHp: 45,
        range: 58,
    });
    assert.deepEqual(runtimePlayer.activeEffects, [{
        type: 'INVERT',
        remaining: 2.5,
        sourcePlayerIndex: 3,
    }]);
});

test('runtime projection reuses scoreboard rows when formatting the Hunt summary', () => {
    const rows = [{ playerIndex: 0, label: 'P1', kills: 2, deaths: 1, assists: 0 }];
    let scoreboardBuilds = 0;
    let summaryRows = null;
    const entityManager = {
        players: [],
        activeGameMode: 'HUNT',
        getHuntScoreboard() {
            scoreboardBuilds += 1;
            return rows;
        },
        getHuntScoreboardSummary(_maxEntries, passedRows) {
            summaryRows = passedRows;
            return 'P1 K2/T1/A0';
        },
    };

    const projection = buildMatchRuntimeProjection({
        game: { entityManager, huntState: {} },
        runtimeState: { entityManager, activeGameMode: 'HUNT' },
        facade: {
            session: { getPlayers: () => [] },
            isNetworkSession: () => false,
        },
        sessionRuntime: { lifecycle: { gameStateId: 'PLAYING' } },
    });

    assert.equal(scoreboardBuilds, 1);
    assert.equal(summaryRows, rows);
    assert.equal(projection.hunt.scoreboardSummary, 'P1 K2/T1/A0');
});

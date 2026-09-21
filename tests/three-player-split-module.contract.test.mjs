import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The module imports its stylesheet like FourPlayerPlanarModule does; Node has no CSS loader.
register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
}
`));

const { ThreePlayerSplitModule } = await import('../src/four-player-planar/ThreePlayerSplitModule.js');
const {
    SPLIT_SCREEN_VARIANTS,
    THREE_PLAYER_SPLIT_PLAYER_COLORS,
} = await import('../src/four-player-planar/FourPlayerPlanarContract.js');
const { VIEWPORT_LAYOUTS } = await import('../src/shared/contracts/ViewportLayoutContract.js');
const { GAME_STATE_IDS } = await import('../src/shared/contracts/GameStateIds.js');
const { getVehicleIds } = await import('../src/entities/vehicle-registry.js');
const { CONFIG } = await import('../src/core/Config.js');

function createModule({ runtimePort, setupView, hudView, getGamepad = () => ({ connected: true }) }) {
    return new ThreePlayerSplitModule({ runtimePort, setupView, hudView, mapDefinitions: CONFIG.MAPS, getGamepad });
}

function createSetupView(controls) {
    const calls = { applySelection: [], applyNormalizedSelection: [], deviceStatus: [], opened: 0, closed: 0 };
    return {
        calls,
        controls,
        isMounted: () => true,
        mount: () => true,
        setEntryVisible() {},
        readControls: () => ({ ...controls, deviceAssignment: [...controls.deviceAssignment] }),
        applySelection: (selection) => calls.applySelection.push(selection),
        applyNormalizedSelection: (selection) => calls.applyNormalizedSelection.push(selection),
        setDeviceStatus: (message) => calls.deviceStatus.push(message),
        setStartAvailability: (availability) => { calls.startAvailability = availability; },
        openSetup: () => { calls.opened += 1; },
        closeSetup: () => { calls.closed += 1; },
        dispose() {},
    };
}

function createHudView() {
    const state = {
        rows: 0,
        colors: null,
        visible: false,
        surfaceActive: false,
        texts: [],
        matchUpdates: [],
        playerUpdates: [],
    };
    return {
        state,
        hasRoot: () => state.rows > 0,
        hasRow: (index) => index < state.rows,
        setRuntimeSurfaceActive: (active) => { state.surfaceActive = active; },
        ensureRows({ playerCount, playerColors }) {
            state.rows = playerCount;
            state.colors = playerColors;
            return true;
        },
        setVisible: (visible) => { state.visible = visible; },
        setRowText: (index, field, text) => state.texts.push([index, field, text]),
        updateMatch: (context) => state.matchUpdates.push(context),
        updatePlayer: (index, player, context) => state.playerUpdates.push([index, player, context]),
        dispose() {},
    };
}

function createRuntime(settings) {
    const runtime = {
        settings,
        runtimeConfig: null,
        players: [],
        gameStateId: GAME_STATE_IDS.PLAYING,
        notified: 0,
        started: 0,
        thirdPersonCounts: [],
        getSettings: () => runtime.settings,
        ensureLocalSettings() {
            if (!runtime.settings.localSettings) runtime.settings.localSettings = {};
            return runtime.settings.localSettings;
        },
        notifySettingsChanged: () => { runtime.notified += 1; },
        startMatch: () => { runtime.started += 1; },
        getRuntimeConfig: () => runtime.runtimeConfig,
        getMatchRuntimeProjection: () => runtime.projection || null,
        getGameplayConfig: () => ({ POWERUP: { MAX_INVENTORY: 5 } }),
        getPlayerKeyBindings: (index) => ({ USE_ITEM: `Use${index + 1}` }),
        getPlayers: () => runtime.players,
        getGameStateId: () => runtime.gameStateId,
        forceThirdPersonCameras: (count) => runtime.thirdPersonCounts.push(count),
    };
    return runtime;
}

test('opening the three player setup reloads desktop maps and lists the current catalog', () => {
    const maps = { standard: CONFIG.MAPS.standard };
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const order = [];
    runtime.refreshLocalMapCatalog = () => {
        order.push('refresh');
        maps.editor_live = { ...CONFIG.MAPS.standard, name: 'Live' };
        return true;
    };
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['keyboard', 'gamepad-1', 'gamepad-2'],
    });
    setupView.setMapOptions = (options) => { order.push('options'); setupView.mapOptions = options; };
    const module = new ThreePlayerSplitModule({
        runtimePort: runtime, setupView, hudView: createHudView(), getMapDefinitions: () => maps,
        getGamepad: () => ({ connected: true }),
    });

    module.openSetup();

    assert.deepEqual(order, ['refresh', 'options']);
    assert.deepEqual(setupView.mapOptions.map((option) => option.value), ['standard', 'editor_live']);
    assert.equal(setupView.calls.opened, 1);

    // Eine im Desktop geloeschte Karte faellt beim naechsten Oeffnen wieder heraus.
    runtime.refreshLocalMapCatalog = () => { delete maps.editor_live; return true; };
    module.openSetup();
    assert.deepEqual(setupView.mapOptions.map((option) => option.value), ['standard']);
});

test('startMatch stores the three-player selection, gives all three slots the shared vehicle and never forces planar mode', () => {
    const vehicleId = getVehicleIds()[0];
    const settings = {
        localSettings: { sessionType: 'splitscreen' },
        mapKey: 'standard',
        vehicles: { PLAYER_1: vehicleId },
        gameplay: { planarMode: false },
    };
    const runtime = createRuntime(settings);
    const setupView = createSetupView({
        mode: 'hunt',
        mapKey: '__not-a-map__',
        vehicleId,
        botCount: '4',
        deviceAssignment: ['keyboard', 'gamepad-1', 'gamepad-2'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView() });

    assert.equal(module.startMatch(), true);

    const local = settings.localSettings;
    assert.equal(local.sessionType, 'splitscreen');
    assert.equal(local.splitScreenVariant, SPLIT_SCREEN_VARIANTS.THREE_PLAYER);
    assert.equal(local.threePlayerSplit.mode, 'hunt');
    assert.equal(local.threePlayerSplit.botCount, 4);
    assert.notEqual(local.threePlayerSplit.mapKey, '__not-a-map__');
    assert.ok(Object.hasOwn(CONFIG.MAPS, local.threePlayerSplit.mapKey), 'falls back to an injected, hunt-eligible map');
    assert.deepEqual(local.threePlayerSplit.deviceAssignment, ['keyboard', 'gamepad-1', 'gamepad-2']);
    assert.equal(local.modePath, 'fight');
    assert.equal(settings.gameMode, 'HUNT');
    assert.deepEqual(
        [settings.vehicles.PLAYER_1, settings.vehicles.PLAYER_2, settings.vehicles.PLAYER_3],
        [vehicleId, vehicleId, vehicleId]
    );
    assert.equal(settings.gameplay.planarMode, false);
    assert.equal(runtime.started, 1);
});

test('an unknown device in one slot falls back to an unused device instead of dropping the whole assignment', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({
        mode: 'classic',
        mapKey: 'standard',
        vehicleId: getVehicleIds()[0],
        botCount: '0',
        deviceAssignment: ['gamepad-2', 'joystick-9', 'keyboard'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView() });

    module._persistSetupSelection();

    const expected = ['gamepad-2', 'gamepad-1', 'keyboard'];
    assert.deepEqual(runtime.settings.localSettings.threePlayerSplit.deviceAssignment, expected);
    assert.deepEqual(setupView.calls.applyNormalizedSelection.at(-1).deviceAssignment, expected);
    assert.equal(runtime.notified, 1);
});

test('duplicate three-player devices are reassigned before the selection is saved', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['gamepad-1', 'gamepad-1', 'keyboard'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView() });

    module._persistSetupSelection();

    const expected = ['gamepad-1', 'gamepad-2', 'keyboard'];
    assert.deepEqual(runtime.settings.localSettings.threePlayerSplit.deviceAssignment, expected);
    assert.deepEqual(setupView.calls.applyNormalizedSelection.at(-1).deviceAssignment, expected);
});

test('changing a device picker swaps its previous owner instead of reverting the choice', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['gamepad-1', 'gamepad-2', 'gamepad-1'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView() });

    module._persistSetupSelection(2);

    const expected = ['keyboard', 'gamepad-2', 'gamepad-1'];
    assert.deepEqual(runtime.settings.localSettings.threePlayerSplit.deviceAssignment, expected);
    assert.deepEqual(setupView.calls.applyNormalizedSelection.at(-1).deviceAssignment, expected);
});

test('keyboard can be selected for every player without swapping another slot away from it', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['keyboard', 'keyboard', 'keyboard'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView() });

    module._persistSetupSelection(2);

    assert.deepEqual(runtime.settings.localSettings.threePlayerSplit.deviceAssignment, ['keyboard', 'keyboard', 'keyboard']);
    assert.deepEqual(setupView.calls.applyNormalizedSelection.at(-1).deviceAssignment, ['keyboard', 'keyboard', 'keyboard']);
});

test('three-player match start explains a missing assigned gamepad and keeps the menu open', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['gamepad-1', 'gamepad-2', 'keyboard'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView(),
        getGamepad: (index) => index === 0 ? { connected: true } : null });

    assert.equal(module.startMatch(), false);
    assert.equal(runtime.started, 0);
    assert.match(setupView.calls.deviceStatus.at(-1), /Gamepad 2 fehlt/);
});

test('three-player match start requires enabled gamepads', () => {
    const runtime = createRuntime({
        controls: { GAMEPAD: { enabled: false } },
        localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {},
    });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['gamepad-1', 'gamepad-2', 'keyboard'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView() });

    assert.equal(module.startMatch(), false);
    assert.equal(runtime.started, 0);
    assert.match(setupView.calls.deviceStatus.at(-1), /Gamepads sind deaktiviert/);
});

test('three-player match start needs no enabled gamepad when every player uses the keyboard', () => {
    const runtime = createRuntime({
        controls: { GAMEPAD: { enabled: false } },
        localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {},
    });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['keyboard', 'keyboard', 'keyboard'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView() });

    assert.equal(module.startMatch(), true);
    assert.equal(runtime.started, 1);
});

test('the third gamepad is validated and can start the match', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['gamepad-1', 'gamepad-2', 'gamepad-3'],
    });
    const module = createModule({
        runtimePort: runtime,
        setupView,
        hudView: createHudView(),
        getGamepad: (index) => index < 3 ? { connected: true } : null,
    });

    assert.equal(module.startMatch(), true);
    assert.deepEqual(
        runtime.settings.localSettings.threePlayerSplit.deviceAssignment,
        ['gamepad-1', 'gamepad-2', 'gamepad-3']
    );
});

test('the start button stays locked with the reason while an assigned gamepad is missing', () => {
    let pads = [null, null];
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({
        mode: 'classic', mapKey: 'standard', vehicleId: getVehicleIds()[0], botCount: '0',
        deviceAssignment: ['gamepad-1', 'gamepad-2', 'keyboard'],
    });
    const module = createModule({ runtimePort: runtime, setupView, hudView: createHudView(), getGamepad: (index) => pads[index] });

    module.syncSetupUi();
    assert.equal(setupView.calls.startAvailability.blocked, true);
    assert.match(setupView.calls.startAvailability.reason, /Gamepad 1 fehlt/);

    pads = [{ connected: true }, { connected: true }];
    module._updateDeviceStatus();
    assert.deepEqual(setupView.calls.startAvailability, { blocked: false, reason: '' });
});

test('the vehicle picker shows catalog names instead of raw ids', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' }, mapKey: 'standard', vehicles: {} });
    const setupView = createSetupView({ mode: 'classic', mapKey: 'standard', vehicleId: 'ship5', botCount: '0', deviceAssignment: [] });
    let mountOptions = null;
    setupView.mount = (options) => { mountOptions = options; return true; };
    createModule({ runtimePort: runtime, setupView, hudView: createHudView() }).mountSetupUi();
    const ship5 = mountOptions.vehicleOptions.find((option) => option.value === 'ship5');
    assert.equal(ship5.label, 'Star-Cruiser (Ship 5)');
});

test('update drives a three-row HUD only while the three-player runtime is active', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' } });
    const hudView = createHudView();
    const module = createModule({ runtimePort: runtime, setupView: createSetupView({ deviceAssignment: [] }), hudView });

    runtime.runtimeConfig = { session: { splitScreenVariant: SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR, viewportLayout: VIEWPORT_LAYOUTS.FOUR_GRID } };
    module.update();
    assert.equal(hudView.state.rows, 0, 'the four-player-planar runtime must not wake the three-player HUD');

    runtime.runtimeConfig = {
        session: {
            splitScreenVariant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER,
            viewportLayout: VIEWPORT_LAYOUTS.THREE_COLUMNS,
            threePlayerSplit: { mode: 'classic' },
        },
    };
    runtime.players = [{ score: 2 }, { score: 0 }, { score: 5 }];
    module.update();
    assert.equal(hudView.state.rows, 3);
    assert.deepEqual(hudView.state.colors, THREE_PLAYER_SPLIT_PLAYER_COLORS);
    assert.equal(hudView.state.visible, true);
    assert.deepEqual(runtime.thirdPersonCounts, [3]);
    assert.deepEqual(
        hudView.state.texts.filter(([, field]) => field === 'stat'),
        [[0, 'stat', '2'], [1, 'stat', '0'], [2, 'stat', '5']]
    );
    assert.equal(hudView.state.matchUpdates.at(-1).huntActive, false);
    assert.deepEqual(hudView.state.playerUpdates.map(([index]) => index), [0, 1, 2]);
    assert.deepEqual(hudView.state.playerUpdates[2][2].keyBindings, { USE_ITEM: 'Use3' });

    const writesBefore = hudView.state.texts.length;
    module.update();
    assert.equal(hudView.state.texts.length, writesBefore, 'unchanged values are not rewritten');

    runtime.gameStateId = GAME_STATE_IDS.MENU;
    module.update();
    assert.equal(hudView.state.visible, false);
    assert.equal(hudView.state.surfaceActive, false);
});

test('three-player Hunt forwards the projected combat HUD state to every compact player panel', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' } });
    const hudView = createHudView();
    const module = createModule({ runtimePort: runtime, setupView: createSetupView({ deviceAssignment: [] }), hudView });
    const players = [0, 1, 2].map((playerIndex) => ({
        playerIndex,
        alive: true,
        hp: 100,
        maxHp: 100,
        boostCharge: 2,
        boostCapacity: 4,
        inventory: [],
        rocketInventory: [],
    }));
    const hunt = {
        active: true,
        scoreboardRows: players.map(({ playerIndex }) => ({ playerIndex, label: `P${playerIndex + 1}`, kills: playerIndex })),
        overheatByPlayer: { 2: 65 },
        respawnRemainingByPlayer: {},
        killFeed: ['P3 trifft P1'],
    };
    runtime.runtimeConfig = {
        session: {
            splitScreenVariant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER,
            viewportLayout: VIEWPORT_LAYOUTS.THREE_COLUMNS,
            threePlayerSplit: { mode: 'hunt' },
        },
    };
    runtime.projection = { players, hunt, globalFog: { active: true, remainingSeconds: 4 } };

    module.update();

    assert.equal(hudView.state.matchUpdates.at(-1).huntActive, true);
    assert.equal(hudView.state.matchUpdates.at(-1).huntProjection, hunt);
    assert.equal(hudView.state.playerUpdates.length, 3);
    assert.equal(hudView.state.playerUpdates[2][2].huntProjection.overheatByPlayer[2], 65);
    assert.equal(hudView.state.playerUpdates[0][2].globalFog.remainingSeconds, 4);
});

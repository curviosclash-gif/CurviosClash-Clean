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

function createModule({ runtimePort, hudView }) {
    return new ThreePlayerSplitModule({ runtimePort, hudView });
}

function createHudView() {
    const state = {
        rows: 0,
        colors: null,
        visible: false,
        surfaceActive: false,
        viewportLayout: null,
        texts: [],
        matchUpdates: [],
        playerUpdates: [],
    };
    return {
        state,
        hasRoot: () => state.rows > 0,
        hasRow: (index) => index < state.rows,
        setRuntimeSurfaceActive: (active) => { state.surfaceActive = active; },
        setViewportLayout: (layout) => { state.viewportLayout = layout; },
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
        thirdPersonCounts: [],
        getSettings: () => runtime.settings,
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

test('the module owns no setup surface any more; three players are chosen in the shared match menu', () => {
    const module = createModule({ runtimePort: createRuntime({}), hudView: createHudView() });
    assert.equal(typeof module.mountSetupUi, 'undefined');
    assert.equal(typeof module.startMatch, 'undefined');
});

test('update drives a three-row HUD only while the three-player runtime is active', () => {
    const runtime = createRuntime({ localSettings: { sessionType: 'splitscreen' } });
    const hudView = createHudView();
    const module = createModule({ runtimePort: runtime, hudView });

    runtime.runtimeConfig = { session: { splitScreenVariant: SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR, viewportLayout: VIEWPORT_LAYOUTS.FOUR_GRID } };
    module.update();
    assert.equal(hudView.state.rows, 0, 'the four-player-planar runtime must not wake the three-player HUD');

    runtime.runtimeConfig = {
        session: {
            splitScreenVariant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER,
            viewportLayout: VIEWPORT_LAYOUTS.THREE_ROWS,
            threePlayerSplit: { mode: 'classic' },
        },
    };
    runtime.players = [{ score: 2 }, { score: 0 }, { score: 5 }];
    module.update();
    assert.equal(hudView.state.rows, 3);
    assert.deepEqual(hudView.state.colors, THREE_PLAYER_SPLIT_PLAYER_COLORS);
    assert.equal(hudView.state.viewportLayout, VIEWPORT_LAYOUTS.THREE_ROWS);
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
    const module = createModule({ runtimePort: runtime, hudView });
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

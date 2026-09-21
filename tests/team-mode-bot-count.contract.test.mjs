import assert from 'node:assert/strict';
import test from 'node:test';

import { Arena } from '../src/entities/Arena.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createMatchSession } from '../src/state/MatchSessionFactory.js';

function createSettings(gameMode) {
    return {
        mode: '1p',
        numBots: 2,
        winsNeeded: 3,
        mapKey: 'standard',
        gameMode,
        hunt: {
            teamMode: true,
            teamObjective: 'HUNT',
            teamSize: 3,
        },
        gameplay: {},
        vehicles: {},
        invertPitch: {},
        cockpitCamera: {},
    };
}

function createSession(settings, runtimeConfig) {
    return createMatchSession({
        renderer: {
            addToScene() {},
            removeFromScene() {},
            getGraphicsStyle: () => 'modern',
        },
        audio: {},
        recorder: {},
        settings,
        runtimeConfig,
        requestedMapKey: settings.mapKey,
    });
}

test('team rosters override the chosen bot count only in team combat modes', async (t) => {
    const originalBuild = Arena.prototype.build;
    const originalSetup = EntityManager.prototype.setup;
    Arena.prototype.build = () => null;
    EntityManager.prototype.setup = function setupWithoutViews() {
        this.players = [];
        this.humanPlayers = [];
        this.bots = [];
    };
    t.after(() => {
        Arena.prototype.build = originalBuild;
        EntityManager.prototype.setup = originalSetup;
    });

    for (const gameMode of ['CLASSIC', 'ARCADE']) {
        await t.test(`${gameMode} keeps the selected bot count`, async () => {
            const settings = createSettings(gameMode);
            const runtimeConfig = createRuntimeConfigSnapshot(settings);

            assert.equal(runtimeConfig.hunt.teamMode, false);
            const session = await createSession(settings, runtimeConfig);
            assert.equal(session.numBots, 2);
        });
    }

    await t.test('HUNT still expands the roster to the configured team size', async () => {
        const settings = createSettings('HUNT');
        const runtimeConfig = createRuntimeConfigSnapshot(settings);

        assert.equal(runtimeConfig.hunt.teamMode, true);
        const session = await createSession(settings, runtimeConfig);
        assert.equal(session.numBots, 5);
    });

    await t.test('the session fallback also rejects stale team settings outside combat modes', async () => {
        const settings = createSettings('CLASSIC');
        const runtimeConfig = createRuntimeConfigSnapshot(settings);
        const session = await createSession(settings, {
            ...runtimeConfig,
            hunt: undefined,
        });

        assert.equal(session.numBots, 2);
    });
});

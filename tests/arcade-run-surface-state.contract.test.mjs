// Der Spieltakt fragt den Arcade-Zustand zweimal pro Bild ab. Die volle Menü-Sicht (Bestenliste,
// Tagesaufgabe, Zwischenstand, Wiederholung) wird dabei jedes Mal neu gebaut. Außerhalb eines
// Arcade-Runs braucht der Takt sie nicht: dort liefert der Laufweg null, ohne etwas anzulegen.
import test from 'node:test';
import assert from 'node:assert/strict';

import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { createArcadePort } from '../src/shared/runtime/GameRuntimeFeaturePorts.js';
import { createPlayingStateRuntimeAccess } from '../src/core/PlayingStateSystem.js';

function supportWith(runtimeConfig) {
    const state = { runtimeConfig, entityManager: null };
    const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => state, nowMs: () => 0 });
    let builds = 0;
    const original = support.arcadeRunRuntime.getMenuSurfaceState.bind(support.arcadeRunRuntime);
    support.arcadeRunRuntime.getMenuSurfaceState = () => { builds += 1; return original(); };
    return { support, builds: () => builds };
}

test('outside an Arcade run the run surface state is null and builds nothing', () => {
    for (const runtimeConfig of [{ arcade: { enabled: false } }, { hunt: { enabled: true } }, null]) {
        const { support, builds } = supportWith(runtimeConfig);
        assert.equal(support.getRunSurfaceState(), null);
        assert.equal(builds(), 0, 'no menu projection is built for a non-Arcade match');
        assert.ok(support.getMenuSurfaceState(), 'the menu keeps its full state');
    }
});

test('inside an Arcade run the match loop still sees the run state', () => {
    const { support, builds } = supportWith({ arcade: { enabled: true, runType: 'gauntlet' } });
    const state = support.getRunSurfaceState();
    assert.equal(state?.runType, 'gauntlet');
    assert.equal(builds(), 1);
});

test('the playing-state access reads the run path of the arcade port, the menu path stays for menus', () => {
    let menuReads = 0;
    let runReads = 0;
    const facade = {
        getArcadeMenuSurfaceState: () => { menuReads += 1; return { runType: 'gauntlet' }; },
        getArcadeRunSurfaceState: () => { runReads += 1; return null; },
    };
    const arcadePort = createArcadePort({ getRuntimeCoordinator: () => null, getRuntimeFacade: () => facade });
    const access = createPlayingStateRuntimeAccess({ runtimeBundle: { ports: { arcadePort } } });
    assert.equal(access.getArcadeMenuSurfaceState(), null);
    assert.equal(runReads, 1);
    assert.equal(menuReads, 0);
    assert.equal(arcadePort.getMenuSurfaceState()?.runType, 'gauntlet');
});

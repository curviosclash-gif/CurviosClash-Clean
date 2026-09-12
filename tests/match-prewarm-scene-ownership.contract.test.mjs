import assert from 'node:assert/strict';
import test from 'node:test';

import { SceneRootManager } from '../src/core/renderer/SceneRootManager.js';
import {
    disposeMatchSessionSystems,
    prewarmMatchArenaSession,
} from '../src/state/MatchSessionFactory.js';
import {
    clearPrewarmedArenaSession,
    consumePrewarmedArenaSessionIfMatch,
} from '../src/state/match-session/MatchSessionPrewarmStore.js';

// What getCurrentMatchSessionRefs returns in the menu: the object survives, its fields are empty.
// A second finalize (returnToMenu while already in MENU) still disposes it with clearScene.
const MENU_SESSION_REFS = Object.freeze({
    arena: null,
    entityManager: null,
    powerupManager: null,
    particles: null,
});

/**
 * Steht für Renderer: nur die echten Szenenwurzeln. matchRoot ist die eine Wurzel,
 * in die der Prewarm die Arena baut und die jeder Finalize leert — um genau diese
 * geteilte Wurzel geht es. onAdd erlaubt, mitten in den Aufbau hineinzugreifen.
 */
function createRenderer({ onAdd = null } = {}) {
    const roots = new SceneRootManager({ add() {} });
    return {
        matchRoot: roots.matchRoot,
        addToScene(object3d) {
            roots.addToScene(object3d);
            onAdd?.(object3d);
        },
        removeFromScene: (object3d) => roots.removeFromScene(object3d),
        clearMatchScene: () => roots.clearMatchScene(),
    };
}

function finalizeInMenu(renderer) {
    disposeMatchSessionSystems(renderer, MENU_SESSION_REFS, { clearScene: true });
}

async function prewarmStandard(renderer) {
    return prewarmMatchArenaSession({ renderer, settings: {}, requestedMapKey: 'standard' });
}

test('a finalize in the menu does not leave the next match a prewarmed arena without world', async () => {
    clearPrewarmedArenaSession();
    const renderer = createRenderer();
    await prewarmStandard(renderer);
    assert.ok(renderer.matchRoot.children.length > 0, 'the prewarm builds the arena into matchRoot');

    finalizeInMenu(renderer);
    const rescheduled = await prewarmStandard(renderer);
    const handedOut = consumePrewarmedArenaSessionIfMatch(renderer, rescheduled.sessionKey);

    assert.ok(handedOut, 'the rescheduled prewarm still offers an arena to the next match');
    assert.ok(
        renderer.matchRoot.children.length > 0,
        'the arena handed to the next match still has its world in the scene'
    );
});

test('a finalize during a running prewarm does not store the half-cleared arena', async () => {
    clearPrewarmedArenaSession();
    // Im Spiel lädt das GLB lange genug, dass ein Finalize zwischen Bau und Speichern landet.
    // Hier wird er hinter das erste addToScene gelegt: nach dem Bau, vor dem Speichern.
    let finalizeQueued = false;
    const renderer = createRenderer({
        onAdd: () => {
            if (finalizeQueued) return;
            finalizeQueued = true;
            queueMicrotask(() => finalizeInMenu(renderer));
        },
    });

    await prewarmStandard(renderer);
    assert.equal(finalizeQueued, true, 'the finalize landed inside the prewarm');

    const rescheduled = await prewarmStandard(renderer);
    const handedOut = consumePrewarmedArenaSessionIfMatch(renderer, rescheduled.sessionKey);

    assert.ok(handedOut, 'the rescheduled prewarm still offers an arena to the next match');
    assert.ok(
        renderer.matchRoot.children.length > 0,
        'the arena handed to the next match still has its world in the scene'
    );
});

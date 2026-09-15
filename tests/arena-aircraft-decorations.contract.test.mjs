import assert from 'node:assert/strict';
import test from 'node:test';

import { Arena } from '../src/entities/Arena.js';

// Deko-Flugzeuge sind OBJ-Fahrzeuge, die ihr Modell asynchron nachladen. Wird die Deko
// abgeraeumt, bevor der Ladevorgang zurueckkommt, haengt der Loader seine Geometrie und
// Materialien an ein laengst entferntes Wurzelobjekt - niemand raeumt sie danach noch auf.
function createDecorationEntry(id) {
    const state = { cancelled: 0, removed: 0 };
    const root = {
        traverse() {},
        children: [],
        parent: null,
    };
    return {
        state,
        entry: {
            id,
            jetId: 'aircraft',
            vehicleId: 'aircraft',
            root,
            mesh: {
                cancelPendingLoad() { state.cancelled += 1; },
            },
        },
    };
}

test('clearing aircraft decorations cancels their pending model loads', () => {
    const removed = [];
    const arena = new Arena({
        addToScene() {},
        removeFromScene(object) { removed.push(object); },
    });

    const first = createDecorationEntry('alpha');
    const second = createDecorationEntry('beta');
    arena._aircraftDecorations = [first.entry, second.entry];

    arena._clearAuthoredAircraftDecorations();

    assert.equal(first.state.cancelled, 1, 'the first decoration keeps loading into a dead root');
    assert.equal(second.state.cancelled, 1, 'the second decoration keeps loading into a dead root');
    assert.deepEqual(removed, [first.entry.root, second.entry.root]);
    assert.deepEqual(arena._aircraftDecorations, []);
});

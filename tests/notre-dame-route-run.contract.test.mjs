import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { renderParcoursPanel } from '../src/ui/ParcoursHudPresenter.js';

const map = NOTRE_DAME_MAPS.notre_dame;
const SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;

function harness() {
    const entityManager = {
        arena: { currentMapDefinition: map },
        entityRuntimeConfig: CONFIG_SECTIONS,
        _simulationClockMs: 0,
    };
    const system = new ParcoursProgressSystem(entityManager);
    const player = {
        index: 0,
        alive: true,
        isBot: false,
        hitboxRadius: 1.1,
        position: {
            x: map.playerSpawn.x * SCALE,
            y: map.playerSpawn.y * SCALE,
            z: map.playerSpawn.z * SCALE,
        },
    };
    system.startRound([player]);
    system.onPlayerSpawn(player, { reason: 'round_start' });
    return { system, player };
}

function cross(system, player, entry, now) {
    const length = Math.hypot(...entry.forward) || 1;
    const unit = entry.forward.map((value) => value / length);
    const previous = {
        x: entry.pos[0] - unit[0] * entry.radius * 0.5,
        y: entry.pos[1] - unit[1] * entry.radius * 0.5,
        z: entry.pos[2] - unit[2] * entry.radius * 0.5,
    };
    player.position = {
        x: entry.pos[0] + unit[0] * entry.radius * 0.5,
        y: entry.pos[1] + unit[1] * entry.radius * 0.5,
        z: entry.pos[2] + unit[2] * entry.radius * 0.5,
    };
    return system.updatePlayerProgress(player, previous, now);
}

test('all eight Notre-Dame branch combinations complete the fourteen-stage route', () => {
    for (let choices = 0; choices < 8; choices += 1) {
        const { system, player } = harness();
        const route = system.getRouteSnapshot();
        const stages = new Map();
        for (const checkpoint of route.checkpoints) {
            const entries = stages.get(checkpoint.routeIndex) || [];
            entries.push(checkpoint);
            stages.set(checkpoint.routeIndex, entries);
        }

        assert.equal(route.totalCheckpoints, 14);
        let branchIndex = 0;
        let now = 1000;
        const ids = [];
        for (const entries of [...stages.values()].sort((left, right) => left[0].routeIndex - right[0].routeIndex)) {
            const choice = entries.length > 1 ? ((choices >> branchIndex++) & 1) : 0;
            const result = cross(system, player, entries[choice], now);
            ids.push(result?.checkpointId || '');
            if (entries[0].id === 'CP04') {
                assert.deepEqual(system.getPlayerHudState(0, now).expectedCheckpointLabels, [
                    'Rose hoch',
                    'Portal niedrig',
                ]);
            }
            now += 500;
        }

        const finish = cross(system, player, route.finish, now);
        const hud = system.getPlayerHudState(0, now);
        assert.ok(ids.every(Boolean), `branch combination ${choices.toString(2).padStart(3, '0')} validates ${JSON.stringify(ids)}`);
        assert.equal(finish?.type, 'finish');
        assert.equal(hud.completed, true);
        assert.equal(hud.currentCheckpoint, 14);
        assert.equal(hud.wrongOrderCount, 0);
    }
});

test('Notre-Dame branch labels survive the projection and appear in the HUD', () => {
    const { system, player } = harness();
    const route = system.getRouteSnapshot();
    let now = 1000;
    for (const checkpointId of ['CP01', 'CP02', 'CP03', 'CP04']) {
        const checkpoint = route.checkpoints.find((entry) => entry.id === checkpointId);
        assert.ok(checkpoint);
        assert.equal(cross(system, player, checkpoint, now)?.type, 'checkpoint');
        now += 500;
    }

    const hud = system.getPlayerHudState(0, now);
    const projection = createMatchRuntimeProjection({ parcours: hud });
    assert.deepEqual(projection.parcours.expectedCheckpointLabels, ['Rose hoch', 'Portal niedrig']);

    const classes = new Set();
    const refs = {
        route: { textContent: '' },
        progress: { textContent: '' },
        timer: { textContent: '' },
        status: {
            textContent: '',
            classList: {
                toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
                remove(name) { classes.delete(name); },
            },
        },
    };
    renderParcoursPanel(refs, projection.parcours, null, false);
    assert.equal(refs.status.textContent, 'Wegwahl: Rose hoch · Portal niedrig');
    assert.equal(classes.has('success'), false);
});

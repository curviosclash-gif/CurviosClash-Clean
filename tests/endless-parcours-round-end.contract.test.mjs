import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { ENDLESS_PARCOURS_BOT_CAPACITY } from '../src/shared/contracts/EndlessParcoursContract.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { createEntityRuntimeSystems } from '../src/entities/runtime/EntityRuntimeSystemAssembly.js';

/**
 * Stands for EntityManager during an Endlosjagd: the round outcome system is wired by the real
 * assembly, requestRoundEnd forwards to it like EntityManager.requestRoundEnd, and the endless
 * runtime registers itself on this owner exactly as it does in a match.
 */
function createEndlessMatch({ activeBots }) {
    const human = {
        index: 0,
        isBot: false,
        alive: true,
        entitySlotActive: true,
        position: new THREE.Vector3(0, 8, 8),
        getDirection(out) { return out.set(0, 0, 1); },
        setControlOptions() {},
    };
    const bots = Array.from({ length: ENDLESS_PARCOURS_BOT_CAPACITY }, (_, slot) => ({
        player: {
            index: slot + 1,
            isBot: true,
            alive: slot < activeBots,
            entitySlotActive: slot < activeBots,
            position: new THREE.Vector3(0, 8, 60 + slot * 10),
        },
        ai: {},
    }));
    const owner = {
        humanPlayers: [human],
        bots,
        players: [human, ...bots.map((entry) => entry.player)],
        runtimeConfig: { arcade: { enabled: true, runType: 'endless_parcours' } },
        _lockOnCache: new Map(),
        _projectileSystem: { clearInBounds() {} },
        _notifyPlayerFeedback() {},
        deactivateBotSlot(slot) {
            bots[slot].player.entitySlotActive = false;
            bots[slot].player.alive = false;
            return true;
        },
    };
    const outcomeSystem = createEntityRuntimeSystems(owner, {}).roundOutcomeSystem;
    owner.requestRoundEnd = (request) => outcomeSystem.requestRoundEnd(request);
    const runtime = new EndlessParcoursRuntime({
        baseSeed: 4711,
        renderer: { addToScene() {}, removeFromScene() {} },
        arena: {
            enterStaticStreamingMode() {},
            exitStaticStreamingMode() {},
            registerStaticColliderBatch() {},
            unregisterStaticColliderBatch() {},
            checkCollisionFast() { return false; },
        },
        powerupManager: { spawnAtAnchor() {}, removeByOwnerId() {} },
        entityManager: owner,
        audio: { play() {} },
        wallClockIso: () => '2026-09-29T10:00:00.000Z',
    });
    return { human, owner, outcomeSystem, runtime };
}

/**
 * One MatchKernel frame in its real order: the entity update (whose tick pipeline resolves the
 * round outcome) runs before the endless runtime update. The first outcome that ends the round
 * is the one the result board shows.
 */
function runFrames(match, frames = 3) {
    for (let frame = 0; frame < frames; frame += 1) {
        const outcome = match.outcomeSystem.resolve();
        if (outcome.shouldEnd) return outcome;
        match.runtime.update(1 / 60);
    }
    return null;
}

for (const activeBots of [0, 1]) {
    test(`a human death in the Endlosjagd ends the run with an endless reason (${activeBots} bot active)`, () => {
        const match = createEndlessMatch({ activeBots });
        assert.equal(runFrames(match, 1), null, 'the run keeps going while the human is alive');

        // The real death hook: EntityPlayerDeathOps marks the player dead, then tells the runtime.
        match.human.alive = false;
        match.runtime.handlePlayerDeath(match.human, 'TRAIL_SELF');

        const outcome = runFrames(match);
        assert.ok(outcome, 'the round ends after the human died');
        assert.equal(outcome.reason, 'ENDLESS_PLAYER_DEATH',
            `the round ended as ${outcome.reason} instead of through the Endlosjagd summary`);
        assert.equal(outcome.parcours?.endless, true, 'the result carries the endless summary');
        match.runtime.dispose();
    });
}

test('a bot left alone in the Endlosjagd does not win the round by elimination', () => {
    const match = createEndlessMatch({ activeBots: 1 });
    // A bot slot that dies outside the runtime bookkeeping must not turn the human into a winner.
    match.owner.bots[0].player.alive = false;
    assert.equal(runFrames(match, 1), null, 'only the Endlosjagd decides when the run ends');
    match.runtime.dispose();
});

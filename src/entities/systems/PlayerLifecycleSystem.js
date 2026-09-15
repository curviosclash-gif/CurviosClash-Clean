// ============================================
// PlayerLifecycleSystem.js - player tick and lifecycle updates
// ============================================

import { PlayerActionPhase } from './lifecycle/PlayerActionPhase.js';
import { PlayerCollisionPhase } from './lifecycle/PlayerCollisionPhase.js';
import { PlayerInteractionPhase } from './lifecycle/PlayerInteractionPhase.js';
import { applyFourPlayerPlanarPhysicsConstraint } from '../../four-player-planar/FourPlayerPlanarPhysics.js';

export class PlayerLifecycleSystem {
    constructor(entityManager) {
        this.entityManager = entityManager;
        this._actionPhase = new PlayerActionPhase(entityManager);
        this._collisionPhase = new PlayerCollisionPhase(entityManager);
        this._interactionPhase = new PlayerInteractionPhase(entityManager);
    }

    updateShootCooldown(player, dt) {
        player.shootCooldown = Math.max(0, (player.shootCooldown || 0) - dt);
    }

    updatePlayer(player, dt, input, renderFrameId = 0, simulationNowMs = undefined) {
        const strategy = this.entityManager?.gameModeStrategy || null;
        const runtimeProfiler = this.entityManager?.runtimeProfiler || null;
        this._actionPhase.run(player, input, strategy);

        const prevPos = this._interactionPhase.capturePreviousPosition(player);
        player.update(dt, input, renderFrameId, strategy);
        if (player.alive && typeof player.prepareObbCollisionQuery === 'function') {
            player.prepareObbCollisionQuery();
        }
        if (player.alive && player.trail) {
            if (player.trailGapActive) player.trail.forceGap(Math.max(0.1, dt * 2));
            player.trail.update(dt, player.position, player._tmpVec);
        }

        this._interactionPhase.runSpecialGates(player, prevPos);
        this.entityManager?._mapHazardSystem?.updatePlayer?.(
            player,
            prevPos,
            Math.max(0, Number(simulationNowMs) || 0) * 0.001
        );
        if (!player.alive) return;
        const collisionStart = runtimeProfiler?.startSample?.();
        const aborted = this._collisionPhase.run(player, prevPos, strategy);
        runtimeProfiler?.endSample?.('collision', collisionStart);
        if (aborted || !player.alive) return;

        // Parcours progress is scored on the move this tick actually made, before a portal can
        // replace the end of that move with a point somewhere else on the map. Portal ends sit in
        // the middle of checkpoint rings on several authored routes; scoring afterwards meant the
        // ring was never crossed (the teleported position is outside it) while the arrival often
        // read as a ring further along the route, i.e. a wrong-order penalty or an outright loop.
        // prevPos is recaptured from the player's position at the top of the next tick, so the
        // jump itself is never seen as a crossing either.
        this.entityManager?._parcoursProgressSystem?.updatePlayerProgress?.(
            player,
            prevPos,
            simulationNowMs
        );
        this._interactionPhase.runPortalAndPickup(player, prevPos);
        applyFourPlayerPlanarPhysicsConstraint(player);
    }
}

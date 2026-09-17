import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
    encodeGameplayActionResultForLog,
} from '../../../shared/contracts/GameplayActionResultContract.js';
import { resolveGameplayConfig } from '../../../shared/contracts/GameplayConfigContract.js';
import { extinguishBurning } from '../../player/PlayerEffectOps.js';

export class PlayerInteractionPhase {
    constructor(entityManager) {
        this.entityManager = entityManager;
        this._inventoryFullPlayers = new WeakSet();
    }

    capturePreviousPosition(player) {
        return this.entityManager._tmpPrevPlayerPosition.copy(player.position);
    }

    runSpecialGates(player, prevPos) {
        const entityManager = this.entityManager;
        const gateResult = entityManager.arena.checkSpecialGates(player.position, prevPos, player.hitboxRadius, player.index);
        if (!gateResult?.ok) return;
        const gateType = String(gateResult.type || '').trim().toLowerCase();

        if (gateType === 'boost') {
            player.activateBoostPortal(gateResult.params, gateResult.forward);
            // E16: the push of the gate blows out the flamethrower afterburn.
            extinguishBurning(player);
            if (entityManager.audio && !player.isBot) entityManager.audio.play('BOOST');
            entityManager.recorder?.logEvent?.('GATE_TRIGGER', player.index, encodeGameplayActionResultForLog(buildGameplayActionResult({
                ok: true,
                code: gateResult.code || GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_BOOST,
                mode: 'gate',
                type: gateType,
            }), { mode: 'gate', type: gateType }));
            return;
        }

        if (gateType === 'slingshot') {
            player.activateSlingshot(gateResult.params, gateResult.forward, gateResult.up);
            if (entityManager.audio && !player.isBot) entityManager.audio.play('SLINGSHOT');
            entityManager.recorder?.logEvent?.('GATE_TRIGGER', player.index, encodeGameplayActionResultForLog(buildGameplayActionResult({
                ok: true,
                code: gateResult.code || GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_SLINGSHOT,
                mode: 'gate',
                type: gateType,
            }), { mode: 'gate', type: gateType }));
        }
    }

    runPortalAndPickup(player, previousPosition = null) {
        const entityManager = this.entityManager;
        const exitPortalResult = entityManager.arena.checkExitPortal?.(
            player.position,
            player.hitboxRadius,
            player.index
        );
        if (exitPortalResult?.triggered) {
            entityManager._emitArcadeGameplayEvent?.({ type: 'exit_portal', playerIndex: player.index });
            entityManager.recorder?.logEvent?.(
                'EXIT_PORTAL',
                player.index,
                encodeGameplayActionResultForLog(exitPortalResult, { mode: 'portal', type: 'EXIT_PORTAL' })
            );
        }

        const portalResult = entityManager.arena.checkPortal(
            player.position,
            player.hitboxRadius,
            player.index,
            previousPosition
        );
        if (portalResult?.target) {
            if (portalResult.exitForward) entityManager._tmpDir.copy(portalResult.exitForward).normalize();
            else player.getAimDirection(entityManager._tmpDir).normalize();
            player.position.copy(portalResult.target).addScaledVector(entityManager._tmpDir, 1.8);

            const planarMode = resolveGameplayConfig(entityManager).GAMEPLAY.PLANAR_MODE;
            if (planarMode) player.currentPlanarY = portalResult.target.y;
            else if (portalResult.rotation && player.quaternion?.premultiply) {
                player.quaternion.premultiply(portalResult.rotation).normalize();
            }
            player.trail.forceGap(0.5);
            // E16: the jump through the portal blows out the flamethrower afterburn.
            extinguishBurning(player);

            if (entityManager.audio && !player.isBot) entityManager.audio.play('PORTAL');
            entityManager.recorder?.logEvent?.('PORTAL_USE', player.index, encodeGameplayActionResultForLog(buildGameplayActionResult({
                ok: true,
                code: portalResult.code || GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL,
                mode: 'portal',
                type: 'PORTAL',
            }), { mode: 'portal', type: 'PORTAL' }));
        }

        const pickupRadiusMultiplier = Math.max(1, Number(player.pickupRadiusMultiplier) || 1);
        const fieldPickupRadius = Math.max(0, Number(entityManager.entityRuntimeConfig?.POWERUP?.PICKUP_RADIUS) || 0);
        const effectivePlayerPickupRadius = player.hitboxRadius * pickupRadiusMultiplier
            + fieldPickupRadius * (pickupRadiusMultiplier - 1);
        const pickedUp = entityManager.powerupManager.checkPickup(
            player.position,
            effectivePlayerPickupRadius,
            (type) => player.addToInventory(type)
        );
        if (!pickedUp) {
            this._inventoryFullPlayers.delete(player);
            return;
        }
        if (!pickedUp.ok) {
            if (!this._inventoryFullPlayers.has(player)) {
                this._inventoryFullPlayers.add(player);
                if (!player.isBot) entityManager._notifyPlayerFeedback?.(player, pickedUp.reason);
                entityManager.recorder?.logEvent?.('ITEM_PICKUP', player.index, encodeGameplayActionResultForLog(
                    pickedUp,
                    { mode: 'pickup', type: pickedUp.type }
                ));
            }
            return;
        }
        this._inventoryFullPlayers.delete(player);
        entityManager._emitArcadeGameplayEvent?.({
            type: 'collect',
            playerIndex: player.index,
            count: 1,
            itemType: pickedUp.type,
        });
        if (entityManager.audio && !player.isBot) entityManager.audio.play('PICKUP');
        if (entityManager.particles) entityManager.particles.spawnHit(player.position, 0x00ff00);
        entityManager.recorder?.logEvent?.('ITEM_PICKUP', player.index, encodeGameplayActionResultForLog(buildGameplayActionResult({
            ok: true,
            code: pickedUp.code || GAMEPLAY_ACTION_RESULT_CODES.ITEM_PICKUP_SUCCESS,
            mode: 'pickup',
            type: pickedUp.type,
        }), { mode: 'pickup', type: pickedUp.type }));
    }
}

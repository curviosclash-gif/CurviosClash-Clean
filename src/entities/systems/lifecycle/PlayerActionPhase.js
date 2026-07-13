import { encodeGameplayActionResultForLog } from '../../../shared/contracts/GameplayActionResultContract.js';

export class PlayerActionPhase {
    constructor(entityManager) {
        this.entityManager = entityManager;
    }

    run(player, input, strategy) {
        const entityManager = this.entityManager;

        if (input.nextItem) player.cycleItem();
        if (input.dropItem) player.dropItem();

        if (Number.isInteger(input.useItem) && input.useItem >= 0) {
            const result = entityManager._useInventoryItem(player, input.useItem);
            if (entityManager.recorder && result) {
                entityManager.recorder.logEvent('ITEM_USE', player.index, encodeGameplayActionResultForLog(result, {
                    mode: 'use',
                    type: result?.type,
                }));
            }
            if (!result.ok && !player.isBot) {
                entityManager._notifyPlayerFeedback(player, result.reason);
            }
        }

        if (input.shootItem) {
            let result = null;
            if (strategy?.requiresShootItemIndex() && Number.isInteger(input.shootItemIndex) && input.shootItemIndex >= 0) {
                result = entityManager._shootItemProjectile(player, input.shootItemIndex);
            } else if (!strategy?.requiresShootItemIndex()) {
                result = entityManager._shootItemProjectile(player, input.shootItemIndex);
            }
            if (entityManager.recorder && result) {
                entityManager.recorder.logEvent('ITEM_USE', player.index, encodeGameplayActionResultForLog(result, {
                    mode: 'shoot',
                    type: result?.type,
                }));
            }
            if (result && !result.ok && !player.isBot) {
                entityManager._notifyPlayerFeedback(player, result.reason);
            }
        }

        if (input.shootMG && strategy?.hasMachineGun()) {
            const result = entityManager._shootHuntGun(player);
            if (entityManager.recorder && result) {
                entityManager.recorder.logEvent('ITEM_USE', player.index, encodeGameplayActionResultForLog(result, {
                    mode: 'mg',
                    type: result?.type || 'MG_BULLET',
                }));
            }
            if (!result.ok && !player.isBot) {
                entityManager._notifyPlayerFeedback(player, result.reason);
            }
        }
    }
}

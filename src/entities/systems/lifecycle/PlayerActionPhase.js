import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
    encodeGameplayActionResultForLog,
} from '../../../shared/contracts/GameplayActionResultContract.js';
import { isRocketPickupType, normalizePickupType } from '../../PickupRegistry.js';

// Only -1 and a missing slot mean "take the selected one": rockets pass -1 on
// purpose and remote inputs carry no slot at all. Any other value that is not a
// slot (NaN, 1.5, '2', -2) comes from a broken caller, and falling back to the
// selection would book a different item into the statistics. Returning -1 means
// "report nothing".
function resolveSelectableSlot(player, preferredIndex, selectableCount) {
    if (preferredIndex !== undefined && preferredIndex !== -1) {
        if (!Number.isInteger(preferredIndex) || preferredIndex < 0) return -1;
        return preferredIndex < selectableCount ? preferredIndex : -1;
    }
    const selectedIndex = Number.isInteger(player?.selectedItemIndex)
        ? Math.max(0, player.selectedItemIndex)
        : 0;
    return selectedIndex < selectableCount ? selectedIndex : 0;
}

// Abgelehnte Item-Aktionen nennen ihren Typ nicht immer: Cooldown- und
// EMP-Absagen entstehen, bevor das Item ueberhaupt gelesen wird. In der
// Telemetrie kamen sie deshalb als UNKNOWN an und liessen sich keinem Item
// zuordnen. Diese reine Vorschau bildet die Legacy-Raketenmigration virtuell
// nach: Raketen sind nicht waehlbare Items, aber fuer shootRocket verfuegbar.
// Sie darf die Inventar-Sammlungen oder den selektierten Slot nicht veraendern.
function resolvePendingItemType(player, preferredIndex) {
    const legacyInventory = Array.isArray(player?.inventory) ? player.inventory : null;
    if (!legacyInventory || legacyInventory.length === 0) return null;
    let selectableCount = 0;
    for (let index = 0; index < legacyInventory.length; index += 1) {
        const rawType = legacyInventory[index];
        const type = normalizePickupType(rawType, { fallback: rawType });
        if (!isRocketPickupType(type)) selectableCount += 1;
    }
    if (selectableCount === 0) return null;
    const requestedIndex = resolveSelectableSlot(player, preferredIndex, selectableCount);
    if (requestedIndex < 0) return null;
    let selectableIndex = 0;
    for (let index = 0; index < legacyInventory.length; index += 1) {
        const rawType = legacyInventory[index];
        const type = normalizePickupType(rawType, { fallback: rawType });
        if (isRocketPickupType(type)) continue;
        if (selectableIndex === requestedIndex) return type || null;
        selectableIndex += 1;
    }
    return null;
}

// Raketen liegen in einer eigenen Warteschlange und werden immer von vorn
// verschossen; das Item-Inventar kennt sie nicht.
function resolvePendingShootType(player, input) {
    if (input.shootRocket === true) {
        const rocketInventory = Array.isArray(player?.rocketInventory) ? player.rocketInventory : [];
        if (rocketInventory.length > 0) {
            const rawType = rocketInventory[0];
            return normalizePickupType(rawType, { fallback: rawType }) || null;
        }
        const legacyInventory = Array.isArray(player?.inventory) ? player.inventory : null;
        if (!legacyInventory) return null;
        for (let index = 0; index < legacyInventory.length; index += 1) {
            const rawType = legacyInventory[index];
            const type = normalizePickupType(rawType, { fallback: rawType });
            if (isRocketPickupType(type)) return type;
        }
        return null;
    }
    return resolvePendingItemType(player, input.shootItemIndex);
}

export class PlayerActionPhase {
    constructor(entityManager) {
        this.entityManager = entityManager;
    }

    run(player, input, strategy) {
        const entityManager = this.entityManager;

        if (input.nextItem) player.cycleItem();
        if (input.dropItem) player.dropItem();

        const wantsUseItem = Number.isInteger(input.useItem) && input.useItem >= 0;
        const wantsShootItem = input.shootItem === true;
        const wantsShootRocket = input.shootRocket === true;
        let itemActionHandled = false;

        if (wantsUseItem) {
            const result = player.itemActionsDisabled
                ? buildGameplayActionResult({
                    ok: false,
                    code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_DISABLED,
                    message: 'Items durch EMP blockiert',
                    mode: 'use',
                })
                : entityManager._useInventoryItem(player, input.useItem);
            itemActionHandled = true;
            if (entityManager.recorder && result) {
                entityManager.recorder.logEvent('ITEM_USE', player.index, encodeGameplayActionResultForLog(result, {
                    mode: 'use',
                    type: result?.type || resolvePendingItemType(player, input.useItem),
                }));
            }
            if (!result.ok && !player.isBot) {
                entityManager._notifyPlayerFeedback(player, result.reason);
            }
        }

        if ((wantsShootItem || wantsShootRocket) && !itemActionHandled) {
            let result = null;
            if (player.itemActionsDisabled) {
                result = buildGameplayActionResult({
                    ok: false,
                    code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_DISABLED,
                    message: 'Items durch EMP blockiert',
                    mode: 'shoot',
                });
            } else if (wantsShootRocket) {
                result = entityManager._shootItemProjectile(player, -1, true);
            } else if (strategy?.requiresShootItemIndex() && Number.isInteger(input.shootItemIndex) && input.shootItemIndex >= 0) {
                result = entityManager._shootItemProjectile(player, input.shootItemIndex);
            } else if (!strategy?.requiresShootItemIndex()) {
                result = entityManager._shootItemProjectile(player, input.shootItemIndex);
            }
            if (entityManager.recorder && result) {
                entityManager.recorder.logEvent('ITEM_USE', player.index, encodeGameplayActionResultForLog(result, {
                    mode: 'shoot',
                    type: result?.type || resolvePendingShootType(player, input),
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

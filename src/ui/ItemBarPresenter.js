// ============================================
// ItemBarPresenter.js - item inventory bar rendering (icons, cooldown overlay)
// ============================================

import { getPickupDefinition } from '../entities/PickupRegistry.js';
import { resolvePickupActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';

export function ensureItemSlots(container, maxInventory) {
    const desired = Math.max(0, Math.floor(Number(maxInventory) || 0));

    while (container.children.length < desired) {
        const slot = document.createElement('div');
        slot.className = 'item-slot';
        slot.dataset.type = '';
        slot.dataset.pickupType = '';
        slot.dataset.actionHint = '';
        slot.dataset.actionHintLabel = '';
        slot.dataset.selected = '0';
        slot.dataset.cooldown = '0';
        const icon = document.createElement('span');
        icon.className = 'item-icon';
        const sweep = document.createElement('div');
        sweep.className = 'item-cooldown-sweep';
        const cooldownText = document.createElement('span');
        cooldownText.className = 'item-cooldown-text';
        slot.appendChild(icon);
        slot.appendChild(sweep);
        slot.appendChild(cooldownText);
        container.appendChild(slot);
    }

    while (container.children.length > desired) {
        container.removeChild(container.lastChild);
    }
}

export function updateItemBar(container, player, projection = null, gameplayConfig = null) {
    const powerupConfig = gameplayConfig?.POWERUP || {};
    const shootCooldownMax = Math.max(0.001, Number(gameplayConfig?.PROJECTILE?.COOLDOWN) || 0.001);
    const itemUseCooldownMax = Math.max(0.001, Number(gameplayConfig?.HUNT?.ITEM_USE_COOLDOWN_SECONDS) || 0.001);
    ensureItemSlots(container, powerupConfig.MAX_INVENTORY);
    const inventory = Array.isArray(player?.inventory) ? player.inventory : [];
    const inventoryLength = inventory.length;
    const selectedIndex = inventoryLength > 0
        ? Math.max(0, Math.min(Number(player?.selectedItemIndex) || 0, inventoryLength - 1))
        : -1;
    const modeType = String(projection?.modeId || 'CLASSIC').trim().toUpperCase();
    const useCooldownRemaining = Math.max(0, Number(player?.itemUseCooldownRemaining || 0));
    const shootCooldownRemaining = Math.max(0, Number(player?.shootCooldown || 0));

    for (let i = 0; i < powerupConfig.MAX_INVENTORY; i++) {
        const slot = container.children[i];
        const rawType = i < inventoryLength ? inventory[i] : '';
        const slotAction = resolvePickupActionAvailability({
            type: rawType,
            fallbackType: rawType,
            modeType,
            useCooldownRemaining,
            shootCooldownRemaining,
        });
        const type = slotAction.type;
        const config = getPickupDefinition(type) || powerupConfig.TYPES?.[type] || null;
        const isSelected = !!type && i === selectedIndex;
        const titleParts = [];
        if (type) {
            titleParts.push(type.replace(/_/g, ' '));
            if (slotAction.canUse && slotAction.canShoot) titleParts.push('Use oder Shoot');
            else if (slotAction.canShoot) titleParts.push('Verschiessbar');
            else if (slotAction.canUse) titleParts.push('Direkt nutzbar');
            else titleParts.push('Nur kontextbasiert');
            if (slotAction.useOnCooldown) titleParts.push(`Use-CD ${slotAction.useCooldownRemaining.toFixed(1)}s`);
            if (slotAction.shootOnCooldown) titleParts.push(`Shoot-CD ${slotAction.shootCooldownRemaining.toFixed(1)}s`);
        }

        slot.dataset.type = rawType;
        slot.dataset.pickupType = type || '';
        slot.dataset.actionHint = slotAction.actionHintLabel.toLowerCase();
        slot.dataset.actionHintLabel = slotAction.actionHintLabel;
        slot.dataset.selected = isSelected ? '1' : '0';
        slot.dataset.cooldown = slotAction.hasCooldown ? '1' : '0';
        const iconEl = slot.children[0];
        const sweepEl = slot.children[1];
        const cooldownTextEl = slot.children[2];
        const iconText = type ? (config?.icon || '?') : '';
        if (iconEl && iconEl.textContent !== iconText) iconEl.textContent = iconText;

        // Visible cooldown feedback (sweep fill + remaining seconds); the
        // title tooltip is unreachable because #hud has pointer-events:none.
        const activeUseCooldown = slotAction.useOnCooldown ? slotAction.useCooldownRemaining : 0;
        const activeShootCooldown = slotAction.shootOnCooldown ? slotAction.shootCooldownRemaining : 0;
        const cooldownRemaining = Math.max(activeUseCooldown, activeShootCooldown);
        let cooldownFraction = 0;
        if (cooldownRemaining > 0) {
            const useFraction = activeUseCooldown > 0 ? activeUseCooldown / itemUseCooldownMax : 0;
            const shootFraction = activeShootCooldown > 0 ? activeShootCooldown / shootCooldownMax : 0;
            cooldownFraction = Math.max(0, Math.min(1, Math.max(useFraction, shootFraction)));
        }
        if (sweepEl) {
            const sweepTransform = cooldownFraction > 0 ? `scaleY(${cooldownFraction.toFixed(3)})` : 'scaleY(0)';
            if (sweepEl.style.transform !== sweepTransform) sweepEl.style.transform = sweepTransform;
        }
        if (cooldownTextEl) {
            const cooldownText = cooldownRemaining > 0 ? cooldownRemaining.toFixed(1) : '';
            if (cooldownTextEl.textContent !== cooldownText) cooldownTextEl.textContent = cooldownText;
        }
        const titleText = titleParts.join(' | ');
        if (slot.title !== titleText) slot.title = titleText;
        slot.classList.toggle('active', !!type);
        slot.classList.toggle('selected', isSelected);
        slot.classList.toggle('projectile-only', !!type && slotAction.canShoot && !slotAction.canUse);
        slot.classList.toggle('use-only', !!type && slotAction.canUse && !slotAction.canShoot);
        slot.classList.toggle('dual-action', !!type && slotAction.canUse && slotAction.canShoot);
        slot.classList.toggle('cooldown', slotAction.hasCooldown);
        slot.style.borderColor = type && Number.isFinite(config?.color)
            ? '#' + config.color.toString(16).padStart(6, '0')
            : '';
    }
}

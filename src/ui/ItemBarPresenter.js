// ============================================
// ItemBarPresenter.js - item inventory bar rendering (icons, cooldown overlay)
// ============================================

import { getPickupDefinition, isPickupTypeOffensive, isRocketPickupType } from '../shared/contracts/PickupRegistryContract.js';
import { resolvePickupActionAvailability } from '../shared/contracts/GameplayActionAvailabilityContract.js';
import { formatKeyCodeShort } from './KeybindLabels.js';
import { resolveWeaponFanProjectileCount } from '../hunt/WeaponFanOps.js';

/**
 * Resolves the key cap shown on a slot. Items are cycled, not selected by
 * number, so the only meaningful key is the one that fires/uses the slot.
 */
function resolveSlotKeyLabel(slotAction, keyBindings, inventoryKind = 'items') {
    if (!keyBindings) return '';
    if (inventoryKind === 'rockets') return formatKeyCodeShort(keyBindings.SHOOT);
    // "Use item" triggers every item action, attack projectiles included.
    return slotAction.canUse || slotAction.canShoot ? formatKeyCodeShort(keyBindings.USE_ITEM) : '';
}

export function ensureItemSlots(container, maxInventory) {
    const desired = Math.max(0, Math.floor(Number(maxInventory) || 0));

    while (container.children.length < desired) {
        const slot = document.createElement('div');
        slot.className = 'item-slot';
        slot.dataset.type = '';
        slot.dataset.pickupType = '';
        slot.dataset.actionHint = '';
        slot.dataset.actionHintLabel = '';
        slot.dataset.actionKey = '';
        slot.dataset.selected = '0';
        slot.dataset.cooldown = '0';
        const icon = document.createElement('span');
        icon.className = 'item-icon';
        const sweep = document.createElement('div');
        sweep.className = 'item-cooldown-sweep';
        const cooldownText = document.createElement('span');
        cooldownText.className = 'item-cooldown-text';
        const tierBadge = document.createElement('span');
        tierBadge.className = 'item-tier-badge';
        slot.appendChild(icon);
        slot.appendChild(sweep);
        slot.appendChild(cooldownText);
        slot.appendChild(tierBadge);
        container.appendChild(slot);
    }

    while (container.children.length > desired) {
        container.removeChild(container.lastChild);
    }
}

export function updateItemBar(container, player, projection = null, gameplayConfig = null, keyBindings = null, inventoryKind = 'items') {
    const powerupConfig = gameplayConfig?.POWERUP || {};
    const shootCooldownMax = Math.max(0.001, Number(gameplayConfig?.PROJECTILE?.COOLDOWN) || 0.001);
    const itemUseCooldownMax = Math.max(0.001, Number(gameplayConfig?.HUNT?.ITEM_USE_COOLDOWN_SECONDS) || 0.001);
    ensureItemSlots(container, powerupConfig.MAX_INVENTORY);
    const sourceInventory = inventoryKind === 'rockets' && Array.isArray(player?.rocketInventory)
        ? player.rocketInventory
        : (Array.isArray(player?.inventory) ? player.inventory : []);
    const hasMixedLegacyInventory = sourceInventory.some((type) => (
        inventoryKind === 'rockets' ? !isRocketPickupType(type) : isRocketPickupType(type)
    ));
    const inventory = hasMixedLegacyInventory
        ? sourceInventory.filter((type) => (inventoryKind === 'rockets' ? isRocketPickupType(type) : !isRocketPickupType(type)))
        : sourceInventory;
    const inventoryLength = inventory.length;
    const selectedIndex = inventoryLength > 0
        ? Math.max(0, Math.min(Number(player?.selectedItemIndex) || 0, inventoryLength - 1))
        : -1;
    const modeType = String(projection?.combatModeId || projection?.modeId || 'CLASSIC').trim().toUpperCase();
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
            if (config?.description) titleParts.push(String(config.description));
            if (slotAction.canUse && slotAction.canShoot) titleParts.push('Use oder Shoot');
            else if (slotAction.canShoot) titleParts.push('Verschiessbar');
            else if (slotAction.canUse) titleParts.push('Direkt nutzbar');
            else titleParts.push('Nur kontextbasiert');
            if (slotAction.useOnCooldown) titleParts.push(`Use-CD ${slotAction.useCooldownRemaining.toFixed(1)}s`);
            if (slotAction.shootOnCooldown) titleParts.push(`Shoot-CD ${slotAction.shootCooldownRemaining.toFixed(1)}s`);
        }

        const slotKeyLabel = type ? resolveSlotKeyLabel(slotAction, keyBindings, inventoryKind) : '';
        if (type && slotKeyLabel) titleParts.push(`Taste ${slotKeyLabel}`);

        slot.dataset.type = rawType;
        slot.dataset.pickupType = type || '';
        slot.dataset.actionHint = slotAction.actionHintLabel.toLowerCase();
        slot.dataset.actionHintLabel = slotAction.actionHintLabel;
        slot.dataset.actionKey = slotKeyLabel;
        slot.dataset.selected = isSelected ? '1' : '0';
        slot.dataset.cooldown = slotAction.hasCooldown ? '1' : '0';
        const iconEl = slot.children[0];
        const sweepEl = slot.children[1];
        const cooldownTextEl = slot.children[2];
        const tierBadgeEl = slot.children[3];
        const iconText = type ? (config?.icon || '?') : '';
        if (iconEl && iconEl.textContent !== iconText) iconEl.textContent = iconText;

        // #hud has pointer-events:none, so the title tooltip can never be
        // hovered: everything the player needs (action, key cap, remaining
        // cooldown) has to be rendered into the slot itself. The title is kept
        // only as a debugging/inspection aid.
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
        if (tierBadgeEl) {
            const tierLabel = type ? String(config?.rocketTierLabel || '') : '';
            if (tierBadgeEl.textContent !== tierLabel) tierBadgeEl.textContent = tierLabel;
            tierBadgeEl.classList.toggle('visible', !!tierLabel);
        }
        const titleText = titleParts.join(' | ');
        if (slot.title !== titleText) slot.title = titleText;
        const accessibleLabel = type
            ? `${config?.name || type}${config?.rocketTierLabel ? ` ${config.rocketTierLabel}` : ''}, ${slotAction.actionHintLabel}${config?.description ? `, ${config.description}` : ''}${slotKeyLabel ? `, Taste ${slotKeyLabel}` : ''}`
            : `Leerer Item-Slot ${i + 1}`;
        slot.ariaLabel = accessibleLabel;
        slot.setAttribute?.('aria-label', accessibleLabel);
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

export function updateRocketBar(container, player, projection = null, gameplayConfig = null, keyBindings = null) {
    if (!container) return;
    const rocketInventory = Array.isArray(player?.rocketInventory)
        ? player.rocketInventory
        : (Array.isArray(player?.inventory) ? player.inventory.filter((type) => isRocketPickupType(type)) : []);
    updateItemBar(container, player, projection, gameplayConfig, keyBindings, 'rockets');
    container.dataset.inventoryKind = 'rockets';
    container.setAttribute?.('aria-label', 'Raketen FIFO');
    for (let i = 0; i < container.children.length; i += 1) {
        const slot = container.children[i];
        const isNext = i === 0 && i < rocketInventory.length;
        slot.classList.toggle('next-rocket', isNext);
        slot.dataset.selected = isNext ? '1' : '0';
        slot.classList.toggle('selected', isNext);
        if (isNext) slot.title = `${slot.title}${slot.title ? ' | ' : ''}Naechste Rakete (FIFO)`;
    }
}

/**
 * What an effect badge counts down. Two effects do not count seconds until they expire:
 * the hunt shield goes away by hit points, and the flamethrower by tank - its 30 second
 * expiry says nothing about whether the next press still sprays fire, the fuel does.
 */
export function resolveActiveEffectTimeLabel(effect, player = null) {
    if (effect?.type === 'FLAMETHROWER') {
        return `${Math.max(0, Number(effect.fuelSeconds) || 0).toFixed(1)}s Tank`;
    }
    if (effect?.type === 'SHIELD' && player?.hasShield && Number(player?.shieldHP) > 0) {
        return `${Math.ceil(Number(player.shieldHP))} HP`;
    }
    return `${Math.max(0, Number(effect?.remaining) || 0).toFixed(1)}s`;
}

function ensureEffectBadges(container, desired) {
    while (container.children.length < desired) {
        const badge = document.createElement('div');
        badge.className = 'active-effect-badge';
        const icon = document.createElement('span');
        icon.className = 'active-effect-icon';
        const name = document.createElement('span');
        name.className = 'active-effect-name';
        const time = document.createElement('span');
        time.className = 'active-effect-time';
        const source = document.createElement('span');
        source.className = 'active-effect-source';
        badge.appendChild(icon);
        badge.appendChild(name);
        badge.appendChild(time);
        badge.appendChild(source);
        container.appendChild(badge);
    }
    while (container.children.length > desired) {
        container.removeChild(container.lastChild);
    }
}

export function updateActiveEffectBar(container, player, globalFog = null) {
    if (!container) return;
    const effects = Array.isArray(player?.activeEffects)
        ? player.activeEffects.filter((effect) => getPickupDefinition(effect?.type))
        : [];
    const globalFogRemaining = Math.max(0, Number(globalFog?.remainingSeconds) || 0);
    if (globalFog?.active === true && globalFogRemaining > 0) {
        effects.push({ type: 'FOG', remaining: globalFogRemaining, sourcePlayerIndex: null });
    }
    const fanProjectileCount = resolveWeaponFanProjectileCount(player?.activeEffects, 'HUNT');
    const hasWeaponFan = fanProjectileCount > 1;
    const effectOffset = hasWeaponFan ? 1 : 0;
    ensureEffectBadges(container, effects.length + effectOffset);
    container.classList.toggle('hidden', effects.length === 0 && !hasWeaponFan);
    container.dataset.weaponFanProjectiles = String(fanProjectileCount);
    const ownIndex = Number.isInteger(player?.playerIndex) ? player.playerIndex : player?.index;

    if (hasWeaponFan) {
        const badge = container.children[0];
        badge.children[0].textContent = '✦';
        badge.children[1].textContent = 'Fächer gesamt';
        badge.children[2].textContent = `×${fanProjectileCount}`;
        badge.children[3].textContent = '';
        badge.dataset.type = 'WEAPON_FAN_TOTAL';
        badge.dataset.tone = 'buff';
        badge.ariaLabel = `Fächer gesamt, ${fanProjectileCount} Geschosse`;
        badge.setAttribute?.('aria-label', badge.ariaLabel);
    }

    for (let i = 0; i < effects.length; i += 1) {
        const effect = effects[i];
        const definition = getPickupDefinition(effect.type);
        const badge = container.children[i + effectOffset];
        const sourcePlayerIndex = Number.isInteger(effect?.sourcePlayerIndex)
            ? effect.sourcePlayerIndex
            : null;
        const isExternal = sourcePlayerIndex !== null && sourcePlayerIndex !== ownIndex;
        const remainingLabel = resolveActiveEffectTimeLabel(effect, player);
        badge.children[0].textContent = definition.icon || '?';
        badge.children[1].textContent = definition.name || effect.type;
        badge.children[2].textContent = remainingLabel;
        badge.children[3].textContent = isExternal ? `P${sourcePlayerIndex + 1}` : '';
        badge.dataset.type = effect.type;
        badge.dataset.tone = isPickupTypeOffensive(effect.type) ? 'debuff' : 'buff';
        badge.ariaLabel = `${definition.name}, ${remainingLabel}${isExternal ? `, von Spieler ${sourcePlayerIndex + 1}` : ''}`;
        badge.setAttribute?.('aria-label', badge.ariaLabel);
    }
}

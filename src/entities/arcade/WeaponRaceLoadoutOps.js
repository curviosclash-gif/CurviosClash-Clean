const RACE_EFFECT_TYPES = new Set(['FLAMETHROWER', 'RAILGUN']);
const RACE_INVENTORY_TYPES = new Set(['LIGHTNING']);

function ensureCollections(player) {
    if (!Array.isArray(player.inventory)) player.inventory = [];
    if (!Array.isArray(player.rocketInventory)) player.rocketInventory = [];
    if (!Array.isArray(player.activeEffects)) player.activeEffects = [];
}

export function clearWeaponRaceLoadout(player, { projectileSystem = null } = {}) {
    if (!player) return false;
    ensureCollections(player);
    player.inventory = player.inventory.filter((type) => !RACE_INVENTORY_TYPES.has(String(type || '').toUpperCase()));
    player.rocketInventory.length = 0;
    player.activeEffects = player.activeEffects.filter((effect) => !RACE_EFFECT_TYPES.has(String(effect?.type || '').toUpperCase()));
    player.weaponRaceWeaponId = '';
    player.hasFlamethrower = false;
    player.flameFuelSeconds = 0;
    player.hasRailgun = false;
    player.railShots = 0;
    projectileSystem?.clearForOwner?.(player);
    return true;
}

function latestEffect(player, type) {
    for (let i = player.activeEffects.length - 1; i >= 0; i -= 1) {
        if (String(player.activeEffects[i]?.type || '').toUpperCase() === type) return player.activeEffects[i];
    }
    return null;
}

export function applyWeaponRaceStage(player, stage, options = {}) {
    if (!player || !stage?.weaponId) return { applied: false, weaponId: '' };
    clearWeaponRaceLoadout(player, options);
    const weaponId = String(stage.weaponId);
    player.weaponRaceWeaponId = weaponId;

    if (weaponId === 'flamethrower') {
        player.applyPowerup?.('FLAMETHROWER');
        ensureCollections(player);
        const effect = latestEffect(player, 'FLAMETHROWER') || { type: 'FLAMETHROWER', remaining: 30 };
        if (!player.activeEffects.includes(effect)) player.activeEffects.push(effect);
        effect.fuelSeconds = Math.max(0, Number(stage.durationSeconds) || 4);
        player.flameFuelSeconds = effect.fuelSeconds;
        player.hasFlamethrower = true;
    } else if (weaponId === 'rocket_medium') {
        const count = Math.max(0, Math.trunc(Number(stage.ammo) || 3));
        for (let i = 0; i < count; i += 1) player.rocketInventory.push('ROCKET_MEDIUM');
    } else if (weaponId === 'railgun') {
        player.applyPowerup?.('RAILGUN');
        ensureCollections(player);
        const effect = latestEffect(player, 'RAILGUN') || { type: 'RAILGUN', remaining: 30 };
        if (!player.activeEffects.includes(effect)) player.activeEffects.push(effect);
        effect.shots = Math.max(1, Math.trunc(Number(stage.ammo) || 3));
        player.railShots = effect.shots;
        player.hasRailgun = true;
    } else if (weaponId === 'lightning') {
        const count = Math.max(1, Math.trunc(Number(stage.ammo) || 1));
        for (let i = 0; i < count; i += 1) player.inventory.push('LIGHTNING');
    }

    return { applied: true, weaponId };
}

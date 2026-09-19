function textRow(key, label, value) {
    return { key, label, value: String(value || ''), type: 'text' };
}
function listRow(key, label, values) {
    return Array.isArray(values) && values.length > 0 ? textRow(key, label, values.join(', ')) : null;
}

export function buildArcadeProgressionBlock(progression = null) {
    if (!progression || typeof progression !== 'object' || !String(progression.vehicleId || '').trim()) return null;
    const priorLevel = Math.max(1, Math.trunc(Number(progression.priorLevel) || 1));
    const newLevel = Math.max(priorLevel, Math.trunc(Number(progression.newLevel) || priorLevel));
    const rows = [
        textRow('vehicle', 'Fahrzeug', progression.vehicleLabel || progression.vehicleId),
        { key: 'xp-earned', label: 'XP in diesem Lauf', value: Math.max(0, Number(progression.xpEarned) || 0), type: 'count' },
        textRow('level-change', 'Level', `${priorLevel} → ${newLevel}`),
        { key: 'xp-bank', label: 'Aktuelle XP-Bank', value: Math.max(0, Number(progression.xpBank) || 0), type: 'count' },
        listRow('unlocked-slots', 'Neue Slots', progression.unlockedSlots),
        listRow('unlocked-tiers', 'Neue Stufen', progression.unlockedTiers),
        listRow('unlocked-families', 'Neue Teilefamilien', progression.unlockedFamilies),
        listRow('unlocked-cosmetics', 'Neue Kosmetik', progression.unlockedCosmetics),
    ].filter(Boolean);
    return { id: 'arcade-progression', title: 'Arcade-Fortschritt', kind: 'values', tier: 'detail', rows };
}

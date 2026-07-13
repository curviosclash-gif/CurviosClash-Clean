export const UPGRADE_SLOT_DISPLAY = [
    { key: 'core', label: 'Core' },
    { key: 'nose', label: 'Nose' },
    { key: 'wing_left', label: 'Wing L' },
    { key: 'wing_right', label: 'Wing R' },
    { key: 'engine_left', label: 'Engine L' },
    { key: 'engine_right', label: 'Engine R' },
    { key: 'utility', label: 'Utility' },
];

export const HITBOX_LABELS = { all: 'Alle Hitboxen', kompakt: 'Kompakt', standard: 'Standard', schwer: 'Schwer' };
export const LEVEL_LABELS = { all: 'Alle Level', rookie: 'Rookie', mid: 'Mid', elite: 'Elite' };

export function createUiNode(tag, className, text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function normalizeVehicleValue(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function nextVehicleTier(currentTier) {
    if (!currentTier || currentTier === 'T1') return 'T2';
    if (currentTier === 'T2') return 'T3';
    return null;
}

export function toVehicleLevelBand(levelValue) {
    const level = Number(levelValue);
    if (!Number.isFinite(level) || level <= 0) return 'rookie';
    if (level >= 20) return 'elite';
    if (level >= 10) return 'mid';
    return 'rookie';
}

export function resolvePlayerColor(settings) {
    const raw = String(settings?.localSettings?.playerColorP1 || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#66b6ff';
}

export function collectCardBadges(entry, profile, favorite, recent) {
    const badges = [];
    if (favorite) badges.push('FAV');
    if (recent) badges.push('RECENT');
    if (entry.kategorie === 'custom') badges.push('CUSTOM');
    if ((Number(profile?.level) || 1) >= 30) badges.push('MAX');
    if ((Number(profile?.level) || 1) <= 2) badges.push('NEW');
    return badges;
}

export function buildStatRows(leftStats, rightStats) {
    const left = leftStats && typeof leftStats === 'object' ? leftStats : {};
    const right = rightStats && typeof rightStats === 'object' ? rightStats : {};
    return [
        { key: 'armor', label: 'Armor', left: Number(left.armor) || 0, right: Number(right.armor) || 0, max: 5 },
        { key: 'agility', label: 'Agility', left: Number(left.agility) || 0, right: Number(right.agility) || 0, max: 5 },
        { key: 'control', label: 'Control', left: Number(left.control) || 0, right: Number(right.control) || 0, max: 5 },
        { key: 'upgradePotential', label: 'Upgrade', left: Number(left.upgradePotential) || 0, right: Number(right.upgradePotential) || 0, max: 7 },
    ];
}

export function calcBarWidth(value, max) {
    const ratio = Math.max(0, Math.min(1, (Number(value) || 0) / Math.max(1, Number(max) || 1)));
    return `${(ratio * 100).toFixed(1)}%`;
}

export function renderVehicleQuickRow({ containerNode, label, ids, resolveLabel, bind, onSelect }) {
    containerNode.innerHTML = '';
    containerNode.appendChild(createUiNode('span', 'arcade-vehicle-quick-row-label', label));
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) {
        containerNode.appendChild(createUiNode('span', 'menu-hint', 'keine'));
        return;
    }
    for (let i = 0; i < list.length; i += 1) {
        const vehicleId = normalizeVehicleValue(list[i]).toLowerCase();
        const button = createUiNode('button', 'secondary-btn quick-pill arcade-vehicle-quick-pill', resolveLabel(vehicleId));
        button.type = 'button';
        bind(button, 'click', () => onSelect(vehicleId));
        containerNode.appendChild(button);
    }
}

export function refreshVehiclePresetSelect({
    presetSelect,
    presetLoad,
    presetDelete,
    presets,
    preferredPresetId = '',
}) {
    presetSelect.innerHTML = '';
    if (!presets.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Keine Presets';
        presetSelect.appendChild(option);
        presetSelect.value = '';
        presetLoad.disabled = true;
        presetDelete.disabled = true;
        return '';
    }
    for (let i = 0; i < presets.length; i += 1) {
        const option = document.createElement('option');
        option.value = presets[i].presetId;
        option.textContent = presets[i].name;
        presetSelect.appendChild(option);
    }
    const resolved = presets.some((preset) => preset.presetId === preferredPresetId) ? preferredPresetId : presets[0].presetId;
    presetSelect.value = resolved;
    presetLoad.disabled = false;
    presetDelete.disabled = false;
    return resolved;
}

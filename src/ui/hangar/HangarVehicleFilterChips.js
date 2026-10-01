import { resolveArcadeLevelRange } from '../../shared/contracts/ArcadeHangarRulesContract.js';
import {
    HITBOX_LABELS,
    LEVEL_LABELS,
    ROLE_LABELS,
    createUiNode as el,
} from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';

function createButton(className, text) {
    const button = el('button', className, text);
    button.type = 'button';
    return button;
}

/**
 * Chip values of the vehicle catalog. Arcade filters by the fixed roles and by the level ranges
 * its ships currently occupy (steps of five, ascending); every other hangar keeps the hitbox
 * classes and the old level bands.
 * @param {{ rules: any, mode: string, catalogEntries: any[], levelOf: (vehicleId: string) => number }} options
 */
export function resolveHangarVehicleFilterChipValues({ rules, mode, catalogEntries, levelOf }) {
    if (mode !== 'arcade') {
        return {
            classChips: ['all', ...rules.filterChips.hitboxKlasse].map((value) => ({ value, label: HITBOX_LABELS[value] || value })),
            levelChips: ['all', ...rules.filterChips.levelBand].map((value) => ({ value, label: LEVEL_LABELS[value] || value })),
        };
    }
    const ranges = new Map();
    for (const entry of catalogEntries) {
        const range = resolveArcadeLevelRange(levelOf(entry.vehicleId));
        ranges.set(range.min, range.label);
    }
    const rangeLabels = [...ranges.entries()].sort((left, right) => left[0] - right[0]).map((pair) => pair[1]);
    return {
        classChips: ['all', ...rules.filterChips.rolle].map((value) => ({ value, label: ROLE_LABELS[value] || value })),
        levelChips: [
            { value: 'all', label: LEVEL_LABELS.all },
            ...rangeLabels.map((label) => ({ value: label, label: `Level ${label}` })),
        ],
    };
}

/** Builds the category tabs and both chip rows of the vehicle catalog once at hangar setup. */
export function renderHangarVehicleFilterChips({ rules, mode, categoryTabs, hitboxChips, levelChips, catalogEntries, levelOf }) {
    rules.categories.forEach((category) => {
        const node = createButton('secondary-btn arcade-vehicle-tab', category.label);
        node.dataset.category = category.id;
        categoryTabs.appendChild(node);
    });
    const { classChips, levelChips: levelValues } = resolveHangarVehicleFilterChipValues({ rules, mode, catalogEntries, levelOf });
    for (const [row, chips] of [[hitboxChips, classChips], [levelChips, levelValues]]) {
        chips.forEach(({ value, label }) => {
            const node = createButton('secondary-btn arcade-vehicle-chip', label);
            node.dataset.filterValue = value;
            row.appendChild(node);
        });
    }
}

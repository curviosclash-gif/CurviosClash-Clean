import {
    ARCADE_TRAIL_STYLE_IDS,
    ARCADE_WEAPON_STYLE_FAMILIES,
    ARCADE_WEAPON_STYLE_IDS,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import {
    ARCADE_TRAIL_STYLE_LABELS,
    ARCADE_TRAIL_STYLE_UNLOCKS,
    ARCADE_WEAPON_STYLE_LABELS,
    ARCADE_WEAPON_STYLE_UNLOCKS,
} from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';

function renderOptions(select, styleIds, labels, unlocks, selectedStyleId, level) {
    select.replaceChildren();
    styleIds.forEach((styleId) => {
        const option = document.createElement('option');
        const requiredLevel = unlocks[styleId];
        option.value = styleId;
        option.disabled = level < requiredLevel;
        option.textContent = `${labels[styleId]} · Level ${requiredLevel}${option.disabled ? ' (gesperrt)' : ''}`;
        select.appendChild(option);
    });
    select.value = selectedStyleId;
}

export function renderHangarCosmetics({ shell, profile, mode }) {
    const { cosmeticsBox, trailStyleSelect, weaponStyleSelects, cosmeticUnlockDetail } = shell;
    cosmeticsBox?.classList.toggle('hidden', mode !== 'arcade');
    if (mode !== 'arcade' || !trailStyleSelect) return;
    const level = Math.max(1, Math.floor(Number(profile?.level) || 1));
    renderOptions(trailStyleSelect, ARCADE_TRAIL_STYLE_IDS, ARCADE_TRAIL_STYLE_LABELS,
        ARCADE_TRAIL_STYLE_UNLOCKS, profile.trailStyleId || 'standard', level);
    for (const familyId of ARCADE_WEAPON_STYLE_FAMILIES) {
        renderOptions(weaponStyleSelects[familyId], ARCADE_WEAPON_STYLE_IDS, ARCADE_WEAPON_STYLE_LABELS,
            ARCADE_WEAPON_STYLE_UNLOCKS, profile.weaponStyleIds?.[familyId] || 'standard', level);
    }
    const cosmeticUnlocks = [
        ...Object.entries(ARCADE_TRAIL_STYLE_UNLOCKS).map(([styleId, requiredLevel]) => ({
            requiredLevel, label: `Spur ${ARCADE_TRAIL_STYLE_LABELS[styleId]}`,
        })),
        ...Object.entries(ARCADE_WEAPON_STYLE_UNLOCKS).map(([styleId, requiredLevel]) => ({
            requiredLevel, label: `Waffenstil ${ARCADE_WEAPON_STYLE_LABELS[styleId]}`,
        })),
    ];
    const newlyUnlocked = cosmeticUnlocks.filter((entry) => entry.requiredLevel === level && level > 1);
    const upcoming = cosmeticUnlocks.filter((entry) => entry.requiredLevel > level)
        .sort((a, b) => a.requiredLevel - b.requiredLevel);
    cosmeticUnlockDetail.textContent = newlyUnlocked.length
        ? `Neu freigeschaltet: ${newlyUnlocked.map((entry) => entry.label).join(', ')}. Käufe senken dein Level nicht.`
        : (upcoming.length
            ? `Nächste Kosmetik: ${upcoming[0].label} ab Level ${upcoming[0].requiredLevel}. Käufe senken dein Level nicht.`
            : 'Alle Kosmetiken freigeschaltet. Käufe senken dein Level nicht.');
}

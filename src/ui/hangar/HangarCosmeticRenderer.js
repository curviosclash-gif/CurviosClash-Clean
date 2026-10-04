import { ARCADE_COLOR_IDS, ARCADE_COLOR_REQUIREMENTS, listUnlockedArcadeColors } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { ARCADE_WEAPON_STYLE_FAMILIES } from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { ARCADE_TRAIL_STYLE_LABELS } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
function renderOptions(select,selected,unlocked) {
    select.replaceChildren();
    for(const id of ARCADE_COLOR_IDS){const option=document.createElement('option');option.value=id;option.disabled=!unlocked.includes(id);option.textContent=ARCADE_TRAIL_STYLE_LABELS[id]+(option.disabled?' · '+ARCADE_COLOR_REQUIREMENTS[id]:'');select.append(option);}
    select.value=unlocked.includes(selected)?selected:'standard';
}
export function renderHangarCosmetics({shell,profile,mode,colorRecord=null}) {
    const {cosmeticsBox,trailStyleSelect,weaponStyleSelects,cosmeticUnlockDetail}=shell;
    cosmeticsBox?.classList.toggle('hidden',mode!=='arcade');
    if(mode!=='arcade'||!trailStyleSelect)return;
    const unlocked=listUnlockedArcadeColors(colorRecord);
    renderOptions(trailStyleSelect,profile.trailStyleId,unlocked);
    for(const family of ARCADE_WEAPON_STYLE_FAMILIES)renderOptions(weaponStyleSelects[family],profile.weaponStyleIds?.[family],unlocked);
    cosmeticUnlockDetail.textContent='Freigeschaltete Farben gelten für alle deine Schiffe. Teilfarben, Spur und jede Waffenfamilie wählst du getrennt.';
}

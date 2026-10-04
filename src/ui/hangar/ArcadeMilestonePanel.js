import { ARCADE_PATTERN_LABELS, ARCADE_PATTERN_UNLOCKS, resolveArcadeMilestoneCosmetics, selectArcadeMilestoneCosmetic } from '../../shared/contracts/ArcadeMilestoneCosmeticContract.js';
import { ARCADE_MACHINE_GUN_MODELS } from '../../shared/contracts/ArcadeMachineGunContract.js';

export function createArcadeMilestonePanel({bind,getProfile,saveProfile,toast}) {
    const root=document.createElement('section');root.className='hangar-milestone-panel';
    const heading=document.createElement('h4');heading.textContent='Titel, Abzeichen und Muster';
    const hint=document.createElement('p');hint.className='field-hint';
    const controls={};
    root.append(heading,hint);
    for(const [field,label] of [['milestoneTitleLevel','Titellevel'],['milestoneBadgeLevel','Abzeichenlevel'],['milestonePatternId','Muster']]) {
        const row=document.createElement('label');row.className='hangar-cosmetic-field';row.textContent=label;
        const input=document.createElement(field==='milestonePatternId'?'select':'input');
        input.className='hangar-cosmetic-select';
        input.setAttribute('aria-label',label);controls[field]=input;
        if(field!=='milestonePatternId'){const numeric=/** @type {HTMLInputElement} */(input);numeric.type='number';numeric.min='0';numeric.step='10';}
        row.append(input);root.append(row);
        bind(input,'change',()=>{
            const value=field==='milestonePatternId'?input.value:Number(input.value);
            const result=selectArcadeMilestoneCosmetic(getProfile(),field,value);
            if(!result.ok){toast('Diesen Meilenstein hast du noch nicht erreicht.','warning');return;}
            saveProfile(result.profile);
        });
    }
    const mastery=document.createElement('p');mastery.className='field-hint';root.append(mastery);
    return {root,render(profile){
        const state=resolveArcadeMilestoneCosmetics(profile);
        hint.textContent=`Alle 10 Level ein neuer Titel und ein Abzeichen; frei wählbar bis Level ${state.earnedLevel}. 0 blendet sie aus. Muster gelten nur für eigene Lab-Schiffe.`;
        for(const [field,value] of [['milestoneTitleLevel',state.titleLevel],['milestoneBadgeLevel',state.badgeLevel]]) {controls[field].max=String(state.earnedLevel);controls[field].value=String(value);}
        const own=String(profile.vehicleId).startsWith('arcade_lab_');
        controls.milestonePatternId.replaceChildren(...Object.entries(ARCADE_PATTERN_UNLOCKS).map(([id,level])=>{
            const option=document.createElement('option');option.value=id;option.textContent=`${ARCADE_PATTERN_LABELS[id]}${level?' · Level '+level:''}`;
            option.disabled=Number(profile.level)<level||(id!=='standard'&&!own);return option;
        }));controls.milestonePatternId.value=state.patternId;
        const mastered=ARCADE_MACHINE_GUN_MODELS.slice(0,state.masterCount).map(gun=>gun.label);
        mastery.textContent=`MG-Meisterung ab Level 60, danach alle 10 Level: ${mastered.join(', ')||'noch keine'}. Verändert nur Schusseffekte.`;
    }};
}

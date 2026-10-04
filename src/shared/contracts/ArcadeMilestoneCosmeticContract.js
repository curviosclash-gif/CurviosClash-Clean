import { ARCADE_MACHINE_GUN_IDS } from './ArcadeMachineGunContract.js';

export const ARCADE_PATTERN_UNLOCKS = Object.freeze({ standard:0,stripes:10,grid:20,dots:30 });
export const ARCADE_PATTERN_LABELS = Object.freeze({standard:'Kein Muster',stripes:'Streifen',grid:'Raster',dots:'Punkte'});
export function resolveArcadeMilestoneCosmetics(profile) {
    const level=Math.max(1,Math.floor(Number(profile?.level)||1));
    const earnedLevel=Math.floor(level/10)*10;
    const selected=(value)=>Math.min(earnedLevel,Math.max(0,Math.floor((Number(value)||0)/10)*10));
    const titleLevel=selected(profile?.milestoneTitleLevel ?? earnedLevel);
    const badgeLevel=selected(profile?.milestoneBadgeLevel ?? earnedLevel);
    const own=/^arcade_lab_[1-9][0-9]*$/.test(String(profile?.vehicleId||''));
    const pattern=String(profile?.milestonePatternId||'standard');
    const patternId=own&&Object.hasOwn(ARCADE_PATTERN_UNLOCKS,pattern)&&level>=ARCADE_PATTERN_UNLOCKS[pattern]?pattern:'standard';
    return {earnedLevel,titleLevel,badgeLevel,patternId,title:titleLevel?`Meister ${titleLevel}`:'',badge:badgeLevel?`◆ ${badgeLevel}`:'',
        masterCount:Math.max(0,Math.min(ARCADE_MACHINE_GUN_IDS.length,Math.floor((level-50)/10)))};
}
export function selectArcadeMilestoneCosmetic(profile,field,value) {
    const current=profile||{};
    const level=Math.max(1,Number(current.level)||1);
    if (field==='milestoneTitleLevel'||field==='milestoneBadgeLevel') {
        const selected=Number(value);
        if(!Number.isInteger(selected)||selected<0||selected%10!==0||selected>Math.floor(level/10)*10)return {ok:false,profile:current};
    } else if(field==='milestonePatternId') {
        if(!Object.hasOwn(ARCADE_PATTERN_UNLOCKS,value)||level<ARCADE_PATTERN_UNLOCKS[value]
            ||(value!=='standard'&&!/^arcade_lab_[1-9][0-9]*$/.test(String(current.vehicleId||''))))return {ok:false,profile:current};
    } else return {ok:false,profile:current};
    return {ok:true,profile:{...current,[field]:value}};
}
export function isArcadeMachineGunMastered(machineGunId,masterCount) {
    const index=ARCADE_MACHINE_GUN_IDS.indexOf(machineGunId);
    return index>=0&&index<Math.max(0,Math.min(ARCADE_MACHINE_GUN_IDS.length,Number(masterCount)||0));
}

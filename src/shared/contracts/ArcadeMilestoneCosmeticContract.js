import { ARCADE_MACHINE_GUN_IDS } from './ArcadeMachineGunContract.js';

export const ARCADE_PATTERN_UNLOCKS = Object.freeze({ standard:0,stripes:10,grid:20,dots:30 });
export const ARCADE_PATTERN_LABELS = Object.freeze({standard:'Kein Muster',stripes:'Streifen',grid:'Raster',dots:'Punkte'});
export const ARCADE_MASTER_SHOT_STYLES = Object.freeze([
    Object.freeze({ style:'master-sunflare', muzzleColor:0xffd166, streakFraction:0.2, segmentCount:2, muzzleScale:1.35, durationSeconds:0.105 }),
    Object.freeze({ style:'master-aurora', muzzleColor:0x71ffd0, streakFraction:0.27, segmentCount:3, muzzleScale:1.45, durationSeconds:0.11 }),
    Object.freeze({ style:'master-void', muzzleColor:0xc88aff, streakFraction:0.34, segmentCount:2, muzzleScale:1.55, durationSeconds:0.115 }),
    Object.freeze({ style:'master-comet', muzzleColor:0xff7d91, streakFraction:0.41, segmentCount:3, muzzleScale:1.65, durationSeconds:0.12 }),
    Object.freeze({ style:'master-tide', muzzleColor:0x5de3ff, streakFraction:0.48, segmentCount:2, muzzleScale:1.75, durationSeconds:0.125 }),
    Object.freeze({ style:'master-ion', muzzleColor:0xb6ff5c, streakFraction:0.55, segmentCount:3, muzzleScale:1.85, durationSeconds:0.13 }),
    Object.freeze({ style:'master-crown', muzzleColor:0xff9e42, streakFraction:0.62, segmentCount:2, muzzleScale:1.95, durationSeconds:0.135 }),
]);
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

export function resolveArcadeMachineGunMasteryStyle(machineGunId,masterCount) {
    const index=ARCADE_MACHINE_GUN_IDS.indexOf(machineGunId);
    return index>=0&&isArcadeMachineGunMastered(machineGunId,masterCount)
        ? ARCADE_MASTER_SHOT_STYLES[index]
        : null;
}

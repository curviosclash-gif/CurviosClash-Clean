export const ARCADE_COLORS_STORAGE_KEY = 'cuviosclash.arcade-colors.v1';
export const ARCADE_COLORS_SCHEMA_VERSION = 'arcade-colors.v1';
export const ARCADE_COLOR_IDS = Object.freeze(['standard','frost','ember','ion','solar','violet','prism']);
export const ARCADE_COLOR_REQUIREMENTS = Object.freeze({
    standard: 'Werkfarbe', frost: 'Einen Gauntlet-Sektor ohne Treffer abschließen (auch Schildtreffer zählen).',
    ember: 'Zehn eigene Abschüsse in einem Run erzielen.', ion: 'Eine vorhandene persönliche Bestzeit verbessern.',
    solar: 'Die Daily Challenge erfolgreich abschließen.', violet: 'Welle 10 in Arena oder Endless erreichen.',
    prism: 'Albtraum-Gauntlet gewinnen oder zehn Albtraum-Wellen in Arena oder Endless abschließen.',
});
export const ARCADE_COLOR_PALETTE = Object.freeze({ frost:0xbfefff,ember:0xff7a3d,ion:0x48d7ff,solar:0xffd45a,violet:0xc678ff,prism:0xe9b8ff });
const EMPTY = Object.freeze([]);
const PROGRESS_EVENTS = new Set(['damage','shield_hit','kill','sector_complete','best_time','wave_reached','wave_complete','run_complete']);

export function readArcadeColors(raw) {
    if (raw == null) return {schemaVersion:ARCADE_COLORS_SCHEMA_VERSION,unlockedColorIds:['standard']};
    if (!raw || typeof raw!=='object' || Array.isArray(raw) || raw.schemaVersion!==ARCADE_COLORS_SCHEMA_VERSION || !Array.isArray(raw.unlockedColorIds)) return null;
    return {...raw,unlockedColorIds:ARCADE_COLOR_IDS.filter(id=>id==='standard'||raw.unlockedColorIds.includes(id))};
}
export function loadArcadeColors(store) {
    try {
        const read=store?.readJsonRecordResult?.(ARCADE_COLORS_STORAGE_KEY);
        if (read && read.status!=='missing' && (read.status!=='found'||read.value==null)) return null;
        return readArcadeColors(read?.status==='found'?read.value:store?.loadJsonRecord?.(ARCADE_COLORS_STORAGE_KEY,null));
    } catch {return null;}
}
export function listUnlockedArcadeColors(record) {return readArcadeColors(record)?.unlockedColorIds || ['standard'];}
export function unlockArcadeColors(store, ids) {
    if (!ids?.length) return EMPTY;
    const previous=loadArcadeColors(store);
    if (!previous) return [];
    const newly=ARCADE_COLOR_IDS.filter(id=>ids.includes(id)&&!previous.unlockedColorIds.includes(id));
    if (!newly.length) return [];
    try {
        const saved=store?.saveJsonRecord?.(ARCADE_COLORS_STORAGE_KEY,{...previous,unlockedColorIds:[...previous.unlockedColorIds,...newly],
            unlockedAt: {...previous.unlockedAt, ...Object.fromEntries(newly.map(id=>[id,new Date().toISOString()]))}});
        return saved===true || saved?.success===true || saved?.ok===true ? newly : [];
    } catch {return [];}
}
export function createArcadeColorProgress({runType='',tierId='normal',dailyChallenge=false,storesByIndex={},humanIndices=[0]}={}) {
    if (!['gauntlet','endless_parcours','arena_waves','five_portals'].includes(runType)) return null;
    return {runType,tierId,dailyChallenge,players:Object.fromEntries(humanIndices.map(index=>[index,{store:storesByIndex[index],kills:0,sectorHit:false,newly:[]}]))};
}
/** Only meaningful gameplay/completion events reach this function; no per-frame storage. */
export function trackArcadeColorEvent(progress,event) {
    // Colours reward what a player did; a companion's kill is help, not progress.
    if (!progress || !event || event.companion === true || !PROGRESS_EVENTS.has(event.type)) return EMPTY;
    const players=progress.players;
    const player=players[Number(event.playerIndex)];
    if (event.type==='damage'||event.type==='shield_hit') {if(player)player.sectorHit=true;return EMPTY;}
    if (event.type==='kill') {
        if (!player || !(Number(event.count)>0)) return EMPTY;
        player.kills+=Math.floor(Number(event.count));
        if (player.kills<10) return EMPTY;
    }
    const targets=['kill','best_time'].includes(event.type)?(player?[player]:[]):Object.values(players);
    const all=[];
    for (const target of targets) {
        const ids=[];
        if(event.type==='kill'&&target.kills>=10)ids.push('ember');
        if(event.type==='sector_complete'&&progress.runType==='gauntlet'&&!target.sectorHit)ids.push('frost');
        if(event.type==='best_time'&&event.previousBestTimeMs>0&&event.totalTimeMs<event.previousBestTimeMs)ids.push('ion');
        const waves=['arena_waves','endless_parcours'].includes(progress.runType);
        if(event.type==='wave_reached'&&waves&&event.wave>=10)ids.push('violet');
        if(event.type==='wave_complete'&&waves&&event.completedWaves>=10&&progress.tierId==='nightmare')ids.push('prism');
        if(event.type==='run_complete'&&event.succeeded===true) {
            if(progress.dailyChallenge)ids.push('solar');
            if(progress.runType==='gauntlet'&&progress.tierId==='nightmare')ids.push('prism');
        }
        if(event.type==='sector_complete')target.sectorHit=false;
        const newly=unlockArcadeColors(target.store,ids);target.newly.push(...newly);all.push(...newly);
    }
    return all;
}

export function filterArcadePartColors(style,record) {
    const allowed=new Set(listUnlockedArcadeColors(record).map(id=>ARCADE_COLOR_PALETTE[id]).filter(v=>v!==undefined));
    return Object.fromEntries(Object.entries(style||{}).map(([name,entry])=>{
        const next={...entry};if(next.color!==undefined&&!allowed.has(next.color))delete next.color;
        return [name,next];
    }).filter(([,entry])=>Object.keys(entry).length));
}

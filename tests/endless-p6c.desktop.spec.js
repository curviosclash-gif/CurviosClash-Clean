import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';
import { updateEndlessParcoursRecords, ENDLESS_PARCOURS_RECORDS_STORAGE_KEY } from '../src/shared/contracts/EndlessParcoursRecordsContract.js';
import { resolveEndlessRecordScope } from '../src/shared/contracts/EndlessParcoursSeedContract.js';
import { ARCADE_LAST_RUN_STORAGE_KEY } from '../src/shared/contracts/ArcadeMenuPersistenceContract.js';

async function openEndless(page) {
    await returnToMenu(page); await selectSessionType(page, 'single');
    const back = page.locator('[data-journey-back]'); if (await back.isVisible()) await back.click();
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung', {exact:true}).selectOption('free');
}
async function startEndless(page) {
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE?.state==='PLAYING' && window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session={page}; await installControl(session); await setPaused(session,true); return session;
}

test('Endlos P6c offers free and fixed training seeds through the real menu and runtime', async ({page}, testInfo) => {
    test.setTimeout(180_000); const errors=collectErrors(page); await waitForLoadedGame(page); await openEndless(page);
    await expect(page.getByLabel('Endlosjagd: Strecke',{exact:true})).toHaveValue('free');
    const runs=[];
    for(const mode of ['training','training','free','free']) {
        if(runs.length)await openEndless(page);
        await page.getByLabel('Endlosjagd: Strecke',{exact:true}).selectOption(mode);
        if(mode==='training')await page.getByLabel('Endlosjagd: Trainingsseed',{exact:true}).fill('130202');
        if(!runs.length)await testInfo.attach('endless-p6c-training-menu.png',{body:await page.screenshot(),contentType:'image/png'});
        await startEndless(page);
        runs.push(await page.evaluate(snapshotKey=>{
            const g=window.GAME_INSTANCE,r=g.entityManager.endlessParcoursRuntime;
            const snapshot=g.playerProfileManager.getActiveRecordStorePort().loadJsonRecord(snapshotKey,null);
            return {seed:r.baseSeed,mode:r.seedMode,configMode:g.runtimeConfig.arcade.endlessSeedMode,model:r.startVehicleId,
                snapshotSeed:snapshot?.seed,
                layout:Array.from({length:12},(_,index)=>{const m=r._path.getModule(index);return [m.templateId,m.exitConnector,m.exitDrift,m.areaBlock];})};
        },ARCADE_LAST_RUN_STORAGE_KEY));
    }
    expect(runs[0]).toEqual(runs[1]);expect(runs[0].seed).toBe(130202);expect(runs[0].mode).toBe('training');
    expect(runs[0].configMode).toBe('training');expect(runs[2].mode).toBe('free');expect(runs[2].configMode).toBe('free');
    expect(runs[2].seed).not.toBe(runs[3].seed);
    for(const run of runs)expect(run.snapshotSeed).toBe(run.seed);
    await testInfo.attach('endless-p6c-seeds.json',{body:JSON.stringify(runs,null,2),contentType:'application/json'});
    await openEndless(page);
    await page.getByLabel('Endlosjagd: Strecke',{exact:true}).selectOption('training');
    await page.getByLabel('Endlosjagd: Trainingsseed',{exact:true}).fill('0');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await expect(page.locator('[data-journey-start="endless_hunt"]')).toBeVisible();
    expect(await page.evaluate(()=>window.GAME_INSTANCE.state)).not.toBe('PLAYING');
    expect(errors).toHaveLength(0);
});

test('Endlos P6c profile activation resets training choice and keeps model records isolated', async ({page},testInfo)=>{
    test.setTimeout(180_000); await waitForLoadedGame(page);
    const originalId=await page.evaluate(()=>window.GAME_INSTANCE.playerProfileManager.getActiveProfile().id);
    await openEndless(page);
    await page.getByLabel('Endlosjagd: Strecke',{exact:true}).selectOption('training');
    await page.getByLabel('Endlosjagd: Trainingsseed',{exact:true}).fill('987');
    await returnToMenu(page);
    for(const panel of ['#submenu-game','#submenu-custom']) {
        if(await page.locator(`${panel}:not(.hidden)`).count())await page.locator(`${panel} .submenu-header [data-back]`).click();
    }
    await page.locator('#btn-main-player').click();
    const name=`Endlos Scope ${Date.now()}`;
    await page.locator('#player-profile-name').fill(name);await page.locator('#btn-player-profile-create').click();
    const otherId=await page.evaluate(label=>window.GAME_INSTANCE.playerProfileManager.getProfiles().find(p=>p.displayName===label)?.id,name);
    expect(otherId).toBeTruthy();expect(otherId).not.toBe(originalId);
    await page.locator('#player-profile-select').selectOption(otherId);
    await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#btn-player-profile-activate').click()]);
    await waitForLoadedGame(page);await openEndless(page);
    await expect(page.getByLabel('Endlosjagd: Strecke',{exact:true})).toHaveValue('free');
    await expect(page.locator('[data-journey-stage="endless_hunt"]')).toContainText('Noch kein Modellrekord.');
    const state=await page.evaluate(key=>({id:window.GAME_INSTANCE.playerProfileManager.getActiveProfile().id,
        stored:window.GAME_INSTANCE.playerProfileManager.getActiveRecordStorePort().readJsonRecordResult(key)}),ENDLESS_PARCOURS_RECORDS_STORAGE_KEY);
    expect(state.id).toBe(otherId);expect(state.stored.status).toBe('missing');
    await testInfo.attach('endless-p6c-profile-scope.json',{body:JSON.stringify({originalId,...state},null,2),contentType:'application/json'});
});

test('Endlos P6c controlled death settles into the actual model record and preserves historical values', async ({page},testInfo)=>{
    test.setTimeout(180_000);const errors=collectErrors(page);await waitForLoadedGame(page);
    const legacy=updateEndlessParcoursRecords(null,{score:9000,distanceMeters:50000,runId:'historical-sentinel',ruleVersion:'endless-parcours-rules.v2'}).records;
    await page.evaluate(({key,value})=>{
        const g=window.GAME_INSTANCE,p=g.playerProfileManager;
        p.getRecordStorePort(p.getActiveProfile().id).saveJsonRecord(key,value);
    },{key:ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,value:legacy});
    await openEndless(page);await page.getByLabel('Endlosjagd: Strecke',{exact:true}).selectOption('training');
    await page.getByLabel('Endlosjagd: Trainingsseed',{exact:true}).fill('606');
    const session=await startEndless(page);expect((await step(session,2000)).completed).toBe(true);
    // Storage/UI integration fixture at the normal entity-death boundary. This is
    // not a claim that this short flight completed a combat or survival challenge.
    await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager;m._killPlayer(m.humanPlayers[0],'ENDLESS_PLAYER_DEATH');
    });
    await step(session,100);
    const result=await page.evaluate(key=>{
        const g=window.GAME_INSTANCE,r=g.entityManager.endlessParcoursRuntime,p=g.playerProfileManager;
        return {summary:r?._summary,stored:p.getRecordStorePort(p.getActiveProfile().id).readJsonRecordResult(key)};
    },ENDLESS_PARCOURS_RECORDS_STORAGE_KEY);
    expect(result.summary?.persistence?.ok).toBe(true);expect(result.summary.seedMode).toBe('training');expect(result.summary.seed).toBe(606);
    const scope=resolveEndlessRecordScope(result.summary);
    expect(result.stored.status).toBe('found');expect(result.stored.value.best.score).toBe(9000);
    expect(result.stored.value.bestDistance.distanceMeters).toBe(50000);
    expect(result.stored.value.bestByRunScope[scope].runId).toBe(result.summary.runId);
    expect(result.stored.value.bestByRunScope[scope].vehicleId).toBe(result.summary.vehicleId);
    await openEndless(page);
    await expect(page.locator('[data-journey-stage="endless_hunt"] .arcade-journey-board').locator('..')).toContainText(`${Math.round(result.summary.score)} Punkte`);
    await testInfo.attach('endless-p6c-model-record.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
    await testInfo.attach('endless-p6c-record-menu.png',{body:await page.screenshot(),contentType:'image/png'});
    expect(errors).toHaveLength(0);
});

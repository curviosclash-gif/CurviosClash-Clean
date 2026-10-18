import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

async function start(page){
    await selectSessionType(page,'single');
    const back=page.locator('[data-journey-back]');if(await back.isVisible())await back.click();
    await page.locator('[data-journey-world="flight_school"]').click();await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung',{exact:true}).selectOption('free');
    await page.getByLabel('Endlosjagd: Strecke',{exact:true}).selectOption('training');
    await page.getByLabel('Endlosjagd: Trainingsseed',{exact:true}).fill('130202');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE.state==='PLAYING'&&window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session={page};await installControl(session);await setPaused(session,true);return session;
}

test('Endlos P8 shows compact live HUD, real water changes and complete result details after death',async({page},testInfo)=>{
    test.setTimeout(180_000);const errors=collectErrors(page);await waitForLoadedGame(page);let session=await start(page);
    expect((await step(session,200)).completed).toBe(true);
    const hud=page.locator('#arcade-score-hud'),section=hud.locator('.arcade-score-hud-endless');
    await expect(section.locator('.arcade-score-hud-metric-label')).toHaveText(['Distanz','Welle','Rettungen','Zone','Wasser']);
    await expect(section).toContainText('0 / 3');await expect(section).toContainText('Trocken');
    await expect(hud.locator('.arcade-score-hud-label').first()).toHaveText('Punkte');
    const scoreInset=await hud.locator('.arcade-score-hud-score').evaluate(n=>n.parentElement.parentElement.getBoundingClientRect().right-n.getBoundingClientRect().right);
    expect(scoreInset).toBeGreaterThanOrEqual(20);
    await testInfo.attach('endless-p8-dry.png',{body:await page.screenshot(),contentType:'image/png'});
    const index=await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];let wet=-1;
        for(let i=6;i<30;i++){h.position.copy(r.getCoursePoint(i,0,0,40).position);r.update(0);if(r.activeModules.get(i).underwater){wet=i;break;}}
        if(wet<0)throw new Error('Missing wet section');
        const f=r.getCoursePoint(wet-1,0,0,104);h.position.copy(f.position);
        h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(),h.position.clone().copy(f.tangent)));
        h.spawnProtectionTimer=99;h.markRenderDiscontinuity('p8-water-entry');r.update(0);return wet;
    });
    expect((await step(session,1000)).completed).toBe(true);
    await expect(section).toContainText('Unter Wasser');await expect(section).toContainText('Tiefsee');
    await testInfo.attach('endless-p8-underwater.png',{body:await page.screenshot(),contentType:'image/png'});
    await page.evaluate(i=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0],f=r.getCoursePoint(i+5,0,0,104);
        h.position.copy(f.position);h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(),h.position.clone().copy(f.tangent)));
        h.spawnProtectionTimer=99;h.markRenderDiscontinuity('p8-water-exit');r.update(0);
    },index);
    for(let i=0;i<12;i++){expect((await step(session,250)).completed).toBe(true);if(await page.evaluate(()=>!window.GAME_INSTANCE.entityManager.humanPlayers[0].waterSubmerged))break;}
    await expect(section).toContainText('Trocken');
    // Presentation fixture: exhaust the rescue counter, then use the real death/result boundary.
    await page.evaluate(()=>{const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime;r.reviveCount=3;m._killPlayer(m.humanPlayers[0],'ENDLESS_PLAYER_DEATH');});
    await step(session,100);
    const result=await page.evaluate(()=>window.GAME_INSTANCE.entityManager.endlessParcoursRuntime._summary);
    expect(result.revives).toBe(3);expect(result.survivalSeconds).toBeGreaterThan(0);
    const results=page.locator('#arcade-overlay-panel');
    await expect(results.getByRole('heading',{name:'Endlosjagd beendet',exact:true})).toBeVisible();
    await expect(results.locator('[data-stats-block-id="endless-parcours"]')).toBeVisible();
    await expect(results).not.toContainText('Missions-Rate');await expect(results).not.toContainText('Keine Sektordaten.');
    await expect(results.locator('[data-stats-row-key="revives"]')).toContainText('3');
    await expect(results.locator('[data-stats-row-key="zone"]')).toBeVisible();
    await expect(results.locator('[data-stats-row-key="survival"]').first()).toBeVisible();
    await expect(results.locator('#arcade-overlay-xp-counter')).toHaveText(`${new Intl.NumberFormat('de-DE').format(Math.round(result.xp))} XP`);
    await testInfo.attach('endless-p8-results.png',{body:await page.screenshot(),contentType:'image/png'});
    const detailScroll=results.locator('[data-arcade-scroll="Endlosjagd-Ergebnis"]');await detailScroll.hover();
    await page.mouse.wheel(0,420);await expect.poll(()=>detailScroll.evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
    await testInfo.attach('endless-p8-result-details.png',{body:await page.screenshot(),contentType:'image/png'});
    await testInfo.attach('endless-p8-results.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
    await returnToMenu(page);await expect(hud).toBeHidden();
    session=await start(page);expect((await step(session,200)).completed).toBe(true);
    await expect(section).toContainText('0 / 3');await expect(section).toContainText('Trocken');expect(errors).toHaveLength(0);
});

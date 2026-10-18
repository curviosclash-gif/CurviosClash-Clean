import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

test('Endlos P6b changes visible area, objective and tier together on the physical course', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors=collectErrors(page);
    await waitForLoadedGame(page);await selectSessionType(page,'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung',{exact:true}).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE?.state==='PLAYING'&&window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session={page};await installControl(session);await setPaused(session,true);
    const changes=[];
    for(const target of [1,3]) {
        const before=await page.evaluate(block=>{
            const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];
            let index=1;while(r._path.getModule(index).areaBlock<block)index++;
            const f=r.getCoursePoint(index-1,0,0,104);h.position.copy(f.position);
            h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(),h.position.clone().copy(f.tangent)));
            h.spawnProtectionTimer=99;h.markRenderDiscontinuity('pacing-boundary-fixture');r.update(0);
            return {module:r.currentModuleIndex,station:r.currentProgressMeters,area:r.currentArea,block:r.pacingAreaBlock,
                objective:r.objectiveAreaBlock,tier:r._activePaletteTier,threshold:r.getPathMetric().getStationRange(index).startS};
        },target);
        expect(before.block).toBe(target-1);
        expect((await step(session,2000)).completed).toBe(true);
        const after=await page.evaluate(()=>{
            const r=window.GAME_INSTANCE.entityManager.endlessParcoursRuntime;
            return {module:r.currentModuleIndex,station:r.currentProgressMeters,area:r.currentArea,block:r.pacingAreaBlock,
                objective:r.objectiveAreaBlock,tier:r._activePaletteTier,visibleArea:r.activeModules.get(r.currentModuleIndex).module.area,
                threat:r.getHudState().threatLevel};
        });
        expect(after.station).toBeGreaterThan(before.threshold);expect(after.block).toBe(target);
        expect(after.objective).toBe(target);expect(after.area).toBe(after.visibleArea);
        expect(after.tier).toBe(target===3?2:1);expect(after.threat).toBe(target===3?'NORMAL':'EASY');
        changes.push({before,after});
    }
    await testInfo.attach('endless-p6b-boundaries.json',{body:JSON.stringify(changes,null,2),contentType:'application/json'});
    await testInfo.attach('endless-p6b-stage.png',{body:await page.screenshot(),contentType:'image/png'});
    expect(errors).toHaveLength(0);
});

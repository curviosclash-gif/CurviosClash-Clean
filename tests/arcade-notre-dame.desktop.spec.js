import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, returnToMenu, selectSessionType } from './helpers.js';
import { ARCADE_JOURNEY_STORAGE_KEY, ARCADE_JOURNEY_SCHEMA } from '../src/shared/contracts/ArcadeJourneyContract.js';

async function selection(page) {
    return page.evaluate(() => {
        const s = window.GAME_INSTANCE.settings;
        return { map:s.mapKey, mode:s.gameMode, path:s.localSettings.modePath, bots:s.numBots,
            vehicles:s.vehicles, runType:s.arcade.runType, sectorCount:s.arcade.sectorCount };
    });
}
async function readJourney(page) {
    return page.evaluate(key => {
        const manager = window.GAME_INSTANCE.playerProfileManager;
        return manager.getRecordStorePort(manager.getActiveProfile().id).readJsonRecordResult(key).value;
    }, ARCADE_JOURNEY_STORAGE_KEY);
}
async function startCourse(page) {
    await waitForLoadedGame(page);
    await returnToMenu(page);
    const saved = await page.evaluate(async ({key,schema}) => {
        const game = window.GAME_INSTANCE, manager = game.playerProfileManager;
        game.settings.arcade.difficultyTierId = 'normal';
        return manager.getRecordStorePort(manager.getActiveProfile().id).saveJsonRecord(key, {
            schema, stages:{ first_run:{ medals:{ normal:{ medal:1,runId:'fixture-first-run' } } } },
            boards:{'first_run:normal:1':[{runId:'fixture-first-run',value:99999,medal:1,playerCount:1}]}, note:'keep old course',
        });
    }, {key:ARCADE_JOURNEY_STORAGE_KEY,schema:ARCADE_JOURNEY_SCHEMA});
    expect(saved === true || saved?.ok === true || saved?.success === true).toBe(true);
    await selectSessionType(page,'single');
    // Journey enters the Arcade mode path, whose personal selection is independent of free combat.
    await page.evaluate(()=>window.GAME_INSTANCE.runtimeFacade.handleModePathChange({modePath:'arcade',stayOnPanel:true}));
    const before = await selection(page);
    await page.locator('[data-journey-world="tower_city"]').click();
    await page.locator('[data-journey-node="notre_dame"]').click();
    await expect(page.locator('[data-journey-start="notre_dame"]')).toBeEnabled();
    await page.locator('[data-journey-start="notre_dame"]').click();
    await expect.poll(() => page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return { state: game.state, map: game.runtimeConfig.session.mapKey,
            route: game.entityManager?.getParcoursRouteSnapshot()?.routeId || null };
    })).toEqual({ state: 'PLAYING', map: 'notre_dame', route: 'notre_dame_evolution_v1' });
    expect(await page.evaluate(() => {
        const c=window.GAME_INSTANCE.runtimeConfig;
        return {map:c.session.mapKey,bots:c.session.numBots,sectors:c.arcade.sectorCount,stage:c.arcade.journeyStageId};
    })).toEqual({map:'notre_dame',bots:0,sectors:1,stage:'notre_dame'});
    return before;
}

// Controlled plane crossings exercise real branch/order/penalty/finish predicates and persistence.
// They are integration fixtures, not a flown K19 route or collision-clearance acceptance.
async function crossCourse(page, lane, withPenalty) {
    return page.evaluate(({lane,withPenalty}) => {
        const game=window.GAME_INSTANCE, manager=game.entityManager;
        const system=manager.runtimePorts.spawn.parcoursProgressSystem, player=manager.humanPlayers[0];
        const route=system.getRouteSnapshot(), anchor=system.nowProvider()+3000;
        const cross=(entry,now) => {
            const length=Math.hypot(...entry.forward)||1, unit=entry.forward.map(v=>v/length);
            const previous={x:entry.pos[0]-unit[0]*entry.radius*.5,y:entry.pos[1]-unit[1]*entry.radius*.5,z:entry.pos[2]-unit[2]*entry.radius*.5};
            // Approach the back side first, including when revisiting a wrongly entered ring.
            player.position.set(previous.x,previous.y,previous.z);
            system.updatePlayerProgress(player,previous,now-1);
            player.position.set(entry.pos[0]+unit[0]*entry.radius*.5,entry.pos[1]+unit[1]*entry.radius*.5,entry.pos[2]+unit[2]*entry.radius*.5);
            system.updatePlayerProgress(player,previous,now);
        };
        cross(route.finish,anchor-2000);
        if(system.getPlayerProgressSnapshot(0).completed) throw new Error('Finish accepted before the course');
        if(withPenalty) cross(route.checkpoints.find(cp=>cp.id==='CP02'),anchor-1000);
        const preferred=lane==='low'?['CP05_PORTAL','CP08_AISLE','CP11_AMBULATORY']:['CP05_ROSE','CP08_ATTIC','CP11_CHOIR'];
        let finished=false;
        const trace=[];
        for(let step=0;step<=route.checkpoints.length+1;step++) {
            const progress=system.getPlayerProgressSnapshot(0);
            const id=preferred.find(id=>progress.expectedCheckpointIds.includes(id))||progress.expectedCheckpointIds[0];
            const entry=id===route.finish.id?route.finish:route.checkpoints.find(cp=>cp.id===id);
            if(!entry) throw new Error('No valid Notre-Dame checkpoint: '+JSON.stringify(progress));
            cross(entry,anchor+(id===route.finish.id?179000:entry.routeIndex*179000/route.totalCheckpoints));
            trace.push({ id, progress:system.getPlayerProgressSnapshot(0) });
            if(system.getPlayerProgressSnapshot(0).completed){finished=true;break;}
        }
        if(!finished) throw new Error('Notre-Dame course did not finish: '+JSON.stringify(trace));
        const progress=system.getPlayerProgressSnapshot(0), outcome=system.getRoundOutcome();
        if(!outcome?.shouldEnd) throw new Error('No real course outcome');
        game.matchFlowUiController.onRoundEnd(player,outcome);
        return {time:outcome.parcours.completionTimeMs,penalty:outcome.parcours.penaltyTimeMs,
            passed:progress.passedCheckpointIds,completed:progress.completed,reason:outcome.reason};
    },{lane,withPenalty});
}

for(const lane of ['low','high']) test(`Notre-Dame ${lane} branch finishes one full timed course and preserves previous progress`,async({page},testInfo)=>{
    test.setTimeout(180000);
    const before=await startCourse(page);
    const completed=await crossCourse(page,lane,lane==='low');
    expect(completed.completed).toBe(true);expect(completed.reason).toBe('PARCOURS_COMPLETE');
    expect(completed.penalty).toBe(lane==='low'?2400:0);
    expect(completed.time).toBeCloseTo(lane==='low'?181400:179000,3);
    expect(completed.passed).toContain(lane==='low'?'CP05_PORTAL':'CP05_ROSE');
    expect(completed.passed).toContain(lane==='low'?'CP08_AISLE':'CP08_ATTIC');
    expect(completed.passed).toContain(lane==='low'?'CP11_AMBULATORY':'CP11_CHOIR');
    await expect(page.locator('.arcade-journey-result-medal')).toContainText(lane==='low'?'Silber':'Gold');
    await expect(page.locator('.arcade-journey-result-time')).toContainText(lane==='low'?'181.40':'179.00');
    await expect(page.locator('#btn-arcade-victory-continue')).toBeHidden();
    const record=await readJourney(page);
    expect(record.stages.notre_dame.medals.normal.medal).toBe(lane==='low'?2:3);
    expect(record.boards['notre_dame:normal:1']).toHaveLength(1);
    expect(record.boards['notre_dame:normal:1'][0].value).toBeCloseTo(completed.time,3);
    expect(record.boards['first_run:normal:1'][0].value).toBe(99999);expect(record.note).toBe('keep old course');
    await page.screenshot({path:testInfo.outputPath(`notre-dame-${lane}-result.png`)});
    if(lane==='low') {
        await page.locator('[data-journey-action="retry"]').click();
        await page.waitForFunction(()=>window.GAME_INSTANCE.state==='PLAYING'
            &&window.GAME_INSTANCE.entityManager.getParcoursRouteSnapshot()?.routeId==='notre_dame_evolution_v1');
        expect(await page.evaluate(()=>window.GAME_INSTANCE.entityManager.runtimePorts.spawn.parcoursProgressSystem.getPlayerProgressSnapshot(0).completed)).toBe(false);
        await returnToMenu(page);
    } else await page.locator('[data-journey-action="map"]').click();
    expect(await readJourney(page)).toEqual(record);
    expect(await selection(page)).toEqual(before);
});

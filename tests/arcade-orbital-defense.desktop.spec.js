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
            schema, stages:{ first_run:{ medals:{ normal:{ medal:1,runId:'fixture-first-run' } } }, notre_dame:{medals:{normal:{medal:1,runId:'fixture-notre-dame'}}} },
            boards:{'first_run:normal:1':[{runId:'fixture-first-run',value:99999,medal:1,playerCount:1}]}, note:'keep old course',
        });
    }, {key:ARCADE_JOURNEY_STORAGE_KEY,schema:ARCADE_JOURNEY_SCHEMA});
    expect(saved === true || saved?.ok === true || saved?.success === true).toBe(true);
    await selectSessionType(page,'single');
    // Journey enters the Arcade mode path, whose personal selection is independent of free combat.
    await page.evaluate(()=>window.GAME_INSTANCE.runtimeFacade.handleModePathChange({modePath:'arcade',stayOnPanel:true}));
    const before = await selection(page);
    await page.locator('[data-journey-world="orbit"]').click();
    await page.locator('[data-journey-node="orbital_shipyard"]').click();
    await expect(page.locator('[data-journey-start="orbital_shipyard"]')).toBeEnabled();
    await page.locator('[data-journey-start="orbital_shipyard"]').click();
    await expect.poll(() => page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return { state: game.state, map: game.runtimeConfig.session.mapKey,
            route: game.entityManager?.getParcoursRouteSnapshot()?.routeId || null };
    })).toEqual({ state: 'PLAYING', map: 'orbital_shipyard', route: 'orbital_shipyard_v1' });
    expect(await page.evaluate(() => {
        const c=window.GAME_INSTANCE.runtimeConfig;
        return {map:c.session.mapKey,bots:c.session.numBots,sectors:c.arcade.sectorCount,stage:c.arcade.journeyStageId};
    })).toEqual({map:'orbital_shipyard',bots:2,sectors:1,stage:'orbital_shipyard'});
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
        const preferred=lane==='low'?['CP09_LOCK']:['CP09_DUCT'];
        let finished=false;
        const trace=[];
        for(let step=0;step<=route.checkpoints.length+1;step++) {
            const progress=system.getPlayerProgressSnapshot(0);
            const id=preferred.find(id=>progress.expectedCheckpointIds.includes(id))||progress.expectedCheckpointIds[0];
            const entry=id===route.finish.id?route.finish:route.checkpoints.find(cp=>cp.id===id);
            if(!entry) throw new Error('No valid Orbitalwerft checkpoint: '+JSON.stringify(progress));
            cross(entry,anchor+(id===route.finish.id?99000:entry.routeIndex*99000/route.totalCheckpoints));
            trace.push({ id, progress:system.getPlayerProgressSnapshot(0) });
            if(system.getPlayerProgressSnapshot(0).completed){finished=true;break;}
        }
        if(!finished) throw new Error('Orbitalwerft course did not finish: '+JSON.stringify(trace));
        const progress=system.getPlayerProgressSnapshot(0), outcome=system.getRoundOutcome();
        if(!outcome?.shouldEnd) throw new Error('No real course outcome');
        game.matchFlowUiController.onRoundEnd(player,outcome);
        return {time:outcome.parcours.completionTimeMs,penalty:outcome.parcours.penaltyTimeMs,
            passed:progress.passedCheckpointIds,completed:progress.completed,reason:outcome.reason};
    },{lane,withPenalty});
}

for(const lane of ['low','high']) test(`Orbitalwerft ${lane} branch finishes one full timed course and preserves previous progress`,async({page},testInfo)=>{
    test.setTimeout(180000);
    const before=await startCourse(page);
    expect(await page.evaluate(()=>{const m=window.GAME_INSTANCE.entityManager;return {bots:m.bots.map(b=>({type:b.ai.type,racer:b.player.isArcadeParcoursCompetitor})),turrets:m.getStaticTurretSnapshot().map(t=>t.weapon).sort()};})).toEqual({bots:[{type:'hunt',racer:false},{type:'hunt',racer:false}],turrets:['mg','mg','rocket','rocket']});
    const completed=await crossCourse(page,lane,lane==='low');
    expect(completed.completed).toBe(true);expect(completed.reason).toBe('PARCOURS_COMPLETE');
    expect(completed.penalty).toBe(lane==='low'?2400:0);
    expect(completed.time).toBeCloseTo(lane==='low'?101400:99000,3);
    expect(completed.passed).toContain(lane==='low'?'CP09_LOCK':'CP09_DUCT');
    await expect(page.locator('.arcade-journey-result-medal')).toContainText(lane==='low'?'Silber':'Gold');
    await expect(page.locator('.arcade-journey-result-time')).toContainText(lane==='low'?'101.40':'99.00');
    await expect(page.locator('#btn-arcade-victory-continue')).toBeHidden();
    const record=await readJourney(page);
    expect(record.stages.orbital_shipyard.medals.normal.medal).toBe(lane==='low'?2:3);
    expect(record.boards['orbital_shipyard:normal:1']).toHaveLength(1);
    expect(record.boards['orbital_shipyard:normal:1'][0].value).toBeCloseTo(completed.time,3);
    expect(record.boards['first_run:normal:1'][0].value).toBe(99999);expect(record.note).toBe('keep old course');
    await page.screenshot({path:testInfo.outputPath(`orbital-defense-${lane}-result.png`)});
    if(lane==='low') {
        await page.locator('[data-journey-action="retry"]').click();
        await page.waitForFunction(()=>window.GAME_INSTANCE.state==='PLAYING'
            &&window.GAME_INSTANCE.entityManager.getParcoursRouteSnapshot()?.routeId==='orbital_shipyard_v1');
        expect(await page.evaluate(()=>window.GAME_INSTANCE.entityManager.runtimePorts.spawn.parcoursProgressSystem.getPlayerProgressSnapshot(0).completed)).toBe(false);
        await returnToMenu(page);
    } else await page.locator('[data-journey-action="map"]').click();
    expect(await readJourney(page)).toEqual(record);
    expect(await selection(page)).toEqual(before);
});

test('Orbital defense emplacements acquire a human through real geometry, fire MG damage and rocket projectiles', async ({page},testInfo)=>{
    test.setTimeout(180000);
    await startCourse(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    // Controlled combat fixture: real loaded geometry, targeting, weapon and damage systems.
    // Advancing those systems explicitly holds the human at a clear inspection position.
    const proof=await page.evaluate(()=>{
        const game=window.GAME_INSTANCE,m=game.entityManager,system=m._staticTurretSystem,human=m.humanPlayers[0];
        const results=[];
        for(const turret of system.turrets){
            const initialShots=turret.shotsFired;
            human.alive=true;human.hp=human.maxHp;human.spawnProtectionTimer=0;
            const healthBefore=human.hp+Math.max(0,Number(human.shieldHp)||0);
            const offsets=[[0,9,36],[36,9,0],[-36,9,0],[0,9,-36],[0,36,0],[54,18,54],[-54,18,-54]];
            let position=null;
            for(const offset of offsets){
                human.position.copy(turret.position).add({x:offset[0],y:offset[1],z:offset[2]});
                if(m.arena.checkCollisionFast(human.position,human.hitboxRadius))continue;
                for(let tick=0;tick<45&&turret.shotsFired===initialShots&&human.alive;tick++)system.update(.1);
                if(turret.shotsFired>initialShots){position=human.position.toArray();break;}
            }
            const healthAfter=human.hp+Math.max(0,Number(human.shieldHp)||0);
            results.push({id:turret.id,weapon:turret.weapon,shots:turret.shotsFired-initialShots,position,
                baseCollision:Boolean(m.arena.checkCollisionFast(turret.position,.18)),damage:healthBefore-healthAfter,
                rocket:m._projectileSystem.projectiles.some(p=>p.sourceTurretId===turret.id)});
        }
        return results;
    });
    expect(proof).toHaveLength(4);
    for(const entry of proof){
        expect(entry.baseCollision,entry.id+' must have an unobstructed muzzle origin').toBe(false);
        expect(entry.shots,entry.id+' must acquire and shoot a human without bypassing line of sight').toBeGreaterThan(0);
        if(entry.weapon==='rocket')expect(entry.rocket,entry.id+' must create a real projectile').toBe(true);
        else expect(entry.damage,entry.id+' must damage HP or shield').toBeGreaterThan(0);
    }
    await testInfo.attach('orbital-defense-combat.json',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
    await page.screenshot({path:testInfo.outputPath('orbital-defense-combat.png')});
});

test('Orbital Hunt bots choose and resolve an actual attack on the human, rather than racing through checkpoints',async({page},testInfo)=>{
    test.setTimeout(180000);await startCourse(page);
    await page.keyboard.press('Escape');await expect(page.locator('#pause-overlay')).toBeVisible();
    const proof=await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,human=m.humanPlayers[0],results=[];
        for(const {player,ai} of m.bots){
            // Clear air above the launch bay, within the actual arena bounds and weapon range.
            player.position.set(-360,450,330);player.quaternion.identity();player.hp=player.maxHp;player.spawnProtectionTimer=0;
            human.position.set(-360,450,295);human.hp=human.maxHp;human.spawnProtectionTimer=0;human.alive=true;
            const before=human.hp+Math.max(0,Number(human.shieldHp)||0);
            let requested=false,shot=null;
            for(let tick=0;tick<20;tick++){
                const action=ai.update(1/60,player,m.createBotRuntimeContext(player,1/60));
                if(action?.shootMG){requested=true;shot=m._shootHuntGun(player);break;}
            }
            results.push({type:ai.type,racer:player.isArcadeParcoursCompetitor,requested,shot,
                damage:before-human.hp-Math.max(0,Number(human.shieldHp)||0),
                playerClear:!m.arena.checkCollisionFast(player.position,player.hitboxRadius),humanClear:!m.arena.checkCollisionFast(human.position,human.hitboxRadius)});
        }
        return results;
    });
    await testInfo.attach('orbital-bot-attacks.json',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
    expect(proof).toHaveLength(2);
    for(const bot of proof){expect(bot.type).toBe('hunt');expect(bot.racer).toBe(false);expect(bot.playerClear&&bot.humanClear).toBe(true);
        expect(bot.requested).toBe(true);expect(bot.shot.ok).toBe(true);expect(bot.damage).toBeGreaterThan(0);}
});

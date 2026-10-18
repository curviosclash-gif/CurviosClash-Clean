import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

test('Endlos P6a scores a real ring flight, rejects a flight beside it and counts actual MG combat separately', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors=collectErrors(page);
    await waitForLoadedGame(page);await selectSessionType(page,'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung',{exact:true}).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE?.state==='PLAYING'&&window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session={page};await installControl(session);await setPaused(session,true);
    await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];
        const f=r.getCoursePoint(0,24,0,104);h.position.copy(f.position);
        h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(),h.position.clone().copy(f.tangent)));
        h.spawnProtectionTimer=99;h.markRenderDiscontinuity('ring-miss-fixture');r.update(0);
    });
    expect((await step(session,1000)).completed).toBe(true);
    const miss=await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];
        return {rings:r.checkpointsPassed,bonus:r.bonusScore,station:r.projectCoursePoint(h.position).s,
            rescue:r.getHudState().reviveArmed,alive:h.alive};
    });
    expect(miss.station).toBeGreaterThan(116);expect(miss.rings).toBe(0);expect(miss.bonus).toBe(0);expect(miss.rescue).toBe(false);
    await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];
        const f=r.getCoursePoint(1,0,0,104);h.position.copy(f.position);
        h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(),h.position.clone().copy(f.tangent)));
        h.spawnProtectionTimer=99;h.markRenderDiscontinuity('ring-hit-fixture');r.update(0);
    });
    await testInfo.attach('endless-p6a-ring.png',{body:await page.screenshot(),contentType:'image/png'});
    expect((await step(session,1000)).completed).toBe(true);
    const hit=await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];
        return {rings:r.checkpointsPassed,last:r.lastCheckpointIndex,bonus:r.bonusScore,
            rescue:r.getHudState().reviveArmed,alive:h.alive};
    });
    await testInfo.attach('endless-p6a-ring-flight.json',{body:JSON.stringify({miss,hit},null,2),contentType:'application/json'});
    expect(hit).toMatchObject({rings:1,last:1,bonus:200,rescue:true,alive:true});
    let index;
    for(let tick=0;tick<24;tick++) {
        expect((await step(session,250)).completed).toBe(true);
        index=await page.evaluate(()=>window.GAME_INSTANCE.entityManager.bots.find(b=>b.player.alive&&b.player.entitySlotActive)?.player.index);
        if(index!=null)break;
    }
    expect(index).not.toBeUndefined();
    const before=await page.evaluate(i=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0],b=m.players[i];
        for(const[p,z]of[[h,20],[b,45]]) {
            const f=r.getCoursePoint(r.currentModuleIndex,0,0,z);p.position.copy(f.position);
            p.quaternion.premultiply(p.quaternion.clone().setFromUnitVectors(p.getDirection().normalize(),p.position.clone().copy(f.tangent)));
            p.markRenderDiscontinuity('ring-combat-fixture');
        }
        h.spawnProtectionTimer=99;h.shootCooldown=0;b.hp=1;b.shieldHP=0;b.spawnProtectionTimer=0;r.update(0);
        return {kills:r.botKills,combat:r.botKills*1500+r.combatBonusScore};
    },index);
    await page.keyboard.down('x');let after;
    for(let tick=0;tick<12;tick++) {
        expect((await step(session,100)).completed).toBe(true);
        after=await page.evaluate(()=>{const r=window.GAME_INSTANCE.entityManager.endlessParcoursRuntime;return {kills:r.botKills,combat:r.botKills*1500+r.combatBonusScore};});
        if(after.kills>before.kills)break;
    }
    await page.keyboard.up('x');
    await testInfo.attach('endless-p6a-combat.json',{body:JSON.stringify({before,after},null,2),contentType:'application/json'});
    expect(after.kills).toBe(before.kills+1);expect(after.combat-before.combat).toBeGreaterThanOrEqual(1500);
    expect(after.combat-before.combat).toBeLessThanOrEqual(2500);
    expect(errors).toHaveLength(0);
});

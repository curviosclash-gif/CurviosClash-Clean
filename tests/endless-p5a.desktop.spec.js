import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

test('Endlos P5a hunters follow the course at the current player pace and retain real attacks', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors=collectErrors(page);
    await waitForLoadedGame(page); await selectSessionType(page,'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung',{exact:true}).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE?.state==='PLAYING'&&window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session={page}; await installControl(session); await setPaused(session,true);
    await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];
        const f=r.getCoursePoint(1,0,0,40);h.position.copy(f.position);
        h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(),h.position.clone().copy(f.tangent)));
        h.spawnProtectionTimer=99;h.markRenderDiscontinuity('hunter-wave-start');r.update(0);
    });
    let index;
    for(let tick=0;tick<20;tick++) {
        expect((await step(session,250)).completed).toBe(true);
        index=await page.evaluate(()=>window.GAME_INSTANCE.entityManager.bots.find(b=>b.player.alive&&b.player.entitySlotActive)?.player.index);
        if(index!=null)break;
    }
    expect(index).not.toBeUndefined();
    const start=await page.evaluate(i=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0],b=m.players[i];
        const spawn={position:b.position.toArray(),radius:b.hitboxRadius,collision:Boolean(m.arena.getCollisionInfo(b.position,b.hitboxRadius))};
        for(const [p,z]of[[b,20],[h,100]]) {
            const f=r.getCoursePoint(0,0,0,z);p.position.copy(f.position);
            p.quaternion.premultiply(p.quaternion.clone().setFromUnitVectors(p.getDirection().normalize(),p.position.clone().copy(f.tangent)));
            p.spawnProtectionTimer=99;p.markRenderDiscontinuity('hunter-route-fixture');
        }
        r.update(0);
        return {index:i,spawn,station:r.projectCoursePoint(b.position).s,route:m.getParcoursRouteSnapshot(i)?.kind};
    },index);
    await testInfo.attach('endless-p5a-start.json',{body:JSON.stringify(start,null,2),contentType:'application/json'});
    expect(start.spawn.collision).toBe(false);expect(start.route).toBe('endless_hunter');
    const samples=[];
    for(let tick=0;tick<4;tick++) {
        expect((await step(session,500)).completed).toBe(true);
        samples.push(await page.evaluate(i=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0],b=m.players[i];
        return {alive:b.alive,station:r.projectCoursePoint(b.position).s,position:b.position.toArray(),
            humanSpeed:h.baseSpeed,botSpeed:b.baseSpeed,objective:b.botObjectiveType,
            policy:m.bots.find(entry=>entry.player===b)?.ai?.type,configuredPolicy:m.botPolicyType,
            mode:m.activeGameMode,combat:m.combatModeType};
        },index));
    }
    const flight=samples[samples.length-1];
    await testInfo.attach('endless-p5a-flight.json',{body:JSON.stringify({start,samples},null,2),contentType:'application/json'});
    expect(flight.alive).toBe(true);expect(flight.station-start.station).toBeGreaterThan(20);
    expect(flight.botSpeed/flight.humanSpeed).toBeCloseTo(1.12,5);expect(flight.policy).toBe('hunt-3d');
    expect(samples.some(sample=>sample.objective==='ENDLESS_ROUTE')).toBe(true);
    const before=await page.evaluate(i=>{
        const m=window.GAME_INSTANCE.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0],b=m.players[i];
        for(const[p,z]of[[b,20],[h,45]]) {
            const f=r.getCoursePoint(0,0,0,z);p.position.copy(f.position);
            p.quaternion.premultiply(p.quaternion.clone().setFromUnitVectors(p.getDirection().normalize(),p.position.clone().copy(f.tangent)));
            p.markRenderDiscontinuity('hunter-attack-fixture');
        }
        // A fixture teleport must also discard the avoidance/recovery memory of its old pose.
        // Weapon heat keeps cooling normally; neither the AI action nor the hit is forced.
        m.bots.find(entry=>entry.player===b).ai.reset();
        h.spawnProtectionTimer=0;h.arenaCollisionGraceTimer=0;h.shieldHP=0;b.shootCooldown=0;r.update(0);
        return {hp:h.hp,rescues:r.reviveCount};
    },index);
    expect((await step(session,1000)).completed).toBe(true);
    const after=await page.evaluate(()=>{
        const m=window.GAME_INSTANCE.entityManager,h=m.humanPlayers[0];
        return {hp:h.hp,rescues:m.endlessParcoursRuntime.reviveCount,alive:h.alive};
    });
    await testInfo.attach('endless-p5a-attack.json',{body:JSON.stringify({before,after},null,2),contentType:'application/json'});
    expect(after.hp<before.hp||after.rescues>before.rescues).toBe(true);
    expect(errors).toHaveLength(0);
});

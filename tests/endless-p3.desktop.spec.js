import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

test('Endlos P3 loads original animated assets before play and keeps collision on the moving pose', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await selectSessionType(page,'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung',{exact:true}).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE?.state==='PLAYING'
        && window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session = { page }; await installControl(session); await setPaused(session,true);
    const start = await page.evaluate(()=> {
        const manager=window.GAME_INSTANCE.entityManager, runtime=manager.endlessParcoursRuntime, human=manager.humanPlayers[0];
        human.position.copy(runtime.getCoursePoint(1,0,0,1).position); runtime.update(0);
        runtime.elapsedCombatSeconds=100;
        let chosen;
        for(let index=3;index<=64;index++) {
            human.position.copy(runtime.getCoursePoint(index,0,0,10).position); runtime.update(0);
            chosen=[...runtime.activeModules.values()].find(instance=>instance.setpiece?.id==='iris');
            if(chosen)break;
        }
        if(!chosen)throw new Error('No authored iris module found in the bounded seed fixture');
        const frame=runtime.getCoursePoint(chosen.module.moduleIndex,0,0,28);
        human.position.copy(frame.position);
        human.quaternion.premultiply(human.quaternion.clone().setFromUnitVectors(human.getDirection().normalize(),human.position.clone().copy(frame.tangent)));
        human.spawnProtectionTimer=99; human.markRenderDiscontinuity('endless-p3-asset-fixture');
        runtime.update(0);
        const instance=runtime.activeModules.get(chosen.module.moduleIndex);
        return { debug:runtime.getDebugSnapshot(), index:chosen.module.moduleIndex, id:instance.setpiece.id,
            matrices:instance.setpiece.colliders.map(c=>Array.from(c.meshCollider.matrixElements)) };
    });
    expect(start.debug.setpieceTemplates).toBe(5);
    expect(start.id).toBe('iris');
    expect((await step(session,500)).completed).toBe(true);
    const after = await page.evaluate(index=> {
        const manager=window.GAME_INSTANCE.entityManager,runtime=manager.endlessParcoursRuntime;
        const instance=runtime.activeModules.get(index),checks=[];
        for(const c of instance.setpiece.colliders) {
            const collider=c.meshCollider, matrix=collider.mesh.matrixWorld;
            const triangles=collider.worldTriangles;
            const a=manager.humanPlayers[0].position.clone().fromArray(triangles,0).applyMatrix4(matrix);
            const b=a.clone().fromArray(triangles,3).applyMatrix4(matrix);
            const d=a.clone().fromArray(triangles,6).applyMatrix4(matrix);
            const normal=b.clone().sub(a).cross(d.clone().sub(a)).normalize();
            const center=a.clone().add(b).add(d).multiplyScalar(1/3);
            const hit=manager.arena.getCollisionInfo(center,0.2);
            checks.push({ name:c.sourceName, matrix:Array.from(collider.matrixElements),
                aligned:matrix.elements.every((v,i)=>Math.abs(v-collider.matrixElements[i])<1e-8),
                hit:Boolean(hit), kind:hit?.kind, normalLength:normal.length() });
        }
        return { checks, debug:runtime.getDebugSnapshot(), alive:manager.humanPlayers[0].alive };
    },start.index);
    expect(after.checks.every(c=>c.aligned&&c.hit&&c.kind==='hard')).toBe(true);
    expect(after.checks.some((c,i)=>c.matrix.some((v,j)=>Math.abs(v-start.matrices[i][j])>0.01))).toBe(true);
    expect(after.alive).toBe(true);
    await testInfo.attach('endless-p3-animation.json',{body:JSON.stringify({start,after},null,2),contentType:'application/json'});
    await testInfo.attach('endless-p3-iris.png',{body:await page.screenshot(),contentType:'image/png'});
    const impactStart = await page.evaluate(index=> {
        const manager=window.GAME_INSTANCE.entityManager,runtime=manager.endlessParcoursRuntime,human=manager.humanPlayers[0];
        const instance=runtime.activeModules.get(index);
        const frame=runtime.getCoursePoint(index,0,0,60),tangent=human.position.clone().copy(frame.tangent);
        for(const c of instance.setpiece.colliders.filter(c=>c.sourceName.startsWith('iris_blade_'))) {
            const triangles=c.meshCollider.worldTriangles,matrix=c.meshCollider.mesh.matrixWorld;
            for(let offset=0;offset<triangles.length;offset+=27) {
                const a=human.position.clone().fromArray(triangles,offset).applyMatrix4(matrix);
                const b=a.clone().fromArray(triangles,offset+3).applyMatrix4(matrix);
                const d=a.clone().fromArray(triangles,offset+6).applyMatrix4(matrix);
                const normal=b.clone().sub(a).cross(d.clone().sub(a)).normalize();
                if(Math.abs(normal.dot(tangent))<0.9)continue;
                const center=a.clone().add(b).add(d).multiplyScalar(1/3);
                for(const sign of [1,-1]) {
                    const position=center.clone().addScaledVector(normal,sign*(human.hitboxRadius+2));
                    if(manager.arena.getCollisionInfo(position,human.hitboxRadius))continue;
                    const previous=human.position.clone(); human.position.copy(position);
                    if(manager.arena.exclusionZoneSource.isOutside(human)) { human.position.copy(previous); continue; }
                    const direction=normal.clone().multiplyScalar(-sign);
                    human.quaternion.premultiply(human.quaternion.clone().setFromUnitVectors(human.getDirection().normalize(),direction));
                    human.spawnProtectionTimer=0; human.arenaCollisionGraceTimer=0; human.shieldHP=0;
                    human.markRenderDiscontinuity('endless-p3-impact');
                    return { hp:human.hp, rescues:runtime.reviveCount, source:c.sourceName, position:human.position.toArray() };
                }
            }
        }
        return null;
    },start.index);
    expect(impactStart).not.toBeNull();
    expect((await step(session,400)).completed).toBe(true);
    const impact = await page.evaluate(()=> {
        const human=window.GAME_INSTANCE.entityManager.humanPlayers[0];
        return { hp:human.hp,alive:human.alive,position:human.position.toArray(),
            rescues:window.GAME_INSTANCE.entityManager.endlessParcoursRuntime.reviveCount };
    });
    await testInfo.attach('endless-p3-impact.json',{body:JSON.stringify({before:impactStart,after:impact},null,2),contentType:'application/json'});
    expect(impact.hp<impactStart.hp || impact.rescues>impactStart.rescues).toBe(true);
    expect(errors).toHaveLength(0);
});

import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

async function startEndless(page) {
    await returnToMenu(page);await selectSessionType(page,'single');
    const back=page.locator('[data-journey-back]');if(await back.isVisible())await back.click();
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung',{exact:true}).selectOption('free');
    await page.getByLabel('Endlosjagd: Strecke',{exact:true}).selectOption('training');
    await page.getByLabel('Endlosjagd: Trainingsseed',{exact:true}).fill('130202');
    await page.evaluate(()=>{window.GAME_INSTANCE.renderer.renderer.debug.checkShaderErrors=true;});
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(()=>window.GAME_INSTANCE.state==='PLAYING'&&window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session={page};await installControl(session);await setPaused(session,true);return session;
}

test('Endlos P7 renders and flies all five biomes with a bounded measured decoration cost',async({page},testInfo)=>{
    test.setTimeout(240_000);const errors=collectErrors(page);await waitForLoadedGame(page);
    const session=await startEndless(page);
    const stations=await page.evaluate(()=>{
        const r=window.GAME_INSTANCE.entityManager.endlessParcoursRuntime,found={};
        for(let index=1;index<180&&Object.keys(found).length<5;index++){
            r._syncModules(index);const id=r.activeModules.get(index).biomeId;if(found[id]===undefined)found[id]=index;
        }
        return Object.entries(found).map(([biome,index])=>({biome,index})).sort((a,b)=>a.index-b.index);
    });
    expect(stations.map(x=>x.biome).sort()).toEqual(['crystal','deepsea','energy','industrial','ruins']);
    const frames=[];
    for(const station of stations){
        const before=await page.evaluate(({index})=>{
            const g=window.GAME_INSTANCE,m=g.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0];
            const f=r.getCoursePoint(index,0,0,12);h.position.copy(f.position);
            h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(),h.position.clone().copy(f.tangent)));
            h.spawnProtectionTimer=99;h.markRenderDiscontinuity('biome-camera-station');r.update(0);
            return {s:r.currentProgressMeters,hp:h.hp,rescues:r.reviveCount,position:h.position.toArray(),direction:h.getDirection().toArray()};
        },station);
        expect((await step(session,600)).completed).toBe(true);
        const data=await page.evaluate(()=>{
            const g=window.GAME_INSTANCE,m=g.entityManager,r=m.endlessParcoursRuntime,h=m.humanPlayers[0],three=g.renderer.renderer;
            const instance=r.activeModules.get(r.currentModuleIndex),groups=[];
            let lights=0,casters=0;
            g.renderer.scene.traverseVisible(node=>{if(node.isLight)lights++;if(node.castShadow)casters++;});
            for(const item of r.activeModules.values())for(const child of item.group.children)if(child.name.includes(':biome:'))groups.push(child);
            const previous=three.info.autoReset;three.info.autoReset=false;
            const measure=()=>{three.info.reset();g.renderer.render();return {calls:three.info.render.calls,triangles:three.info.render.triangles};};
            const withDecor=measure();for(const group of groups)group.visible=false;
            const withoutDecor=measure();for(const group of groups)group.visible=true;three.info.autoReset=previous;
            return {biome:instance.biomeId,alive:h.alive,hp:h.hp,rescues:r.reviveCount,s:r.currentProgressMeters,
                submerged:h.waterSubmerged,cameraWater:g.renderer.cameras[0].userData.waterVisibilityMultiplier,
                fog:{near:g.renderer.scene.fog.near,far:g.renderer.scene.fog.far,color:g.renderer.scene.fog.color.getHex()},
                clock:r._biomeResources.clock.value,loaded:r.activeModules.size,lights,casters,withDecor,withoutDecor,
                position:h.position.toArray(),direction:h.getDirection().toArray()};
        });
        await testInfo.attach(`endless-p7-station-${station.biome}.json`,{body:JSON.stringify({before,...station,...data},null,2),contentType:'application/json'});
        expect(data.biome).toBe(station.biome);expect(data.alive).toBe(true);expect(data.hp).toBe(before.hp);
        expect(data.rescues).toBe(before.rescues);expect(data.s).toBeGreaterThan(before.s);
        expect(data.withDecor.calls-data.withoutDecor.calls).toBeLessThanOrEqual(data.loaded*3);
        expect(data.withDecor.triangles-data.withoutDecor.triangles).toBeLessThanOrEqual(data.loaded*1800);
        if(station.biome==='deepsea'){expect(data.submerged).toBe(true);expect(data.cameraWater).toBe(0.42);}
        frames.push({...station,...data});
        await testInfo.attach(`endless-p7-${station.biome}.png`,{body:await page.screenshot(),contentType:'image/png'});
        const wall=await page.evaluate(index=>{
            const g=window.GAME_INSTANCE,r=g.entityManager.endlessParcoursRuntime,three=g.renderer.renderer;
            const camera=g.renderer.cameras[0].clone();camera.aspect=640/332;camera.updateProjectionMatrix();
            camera.position.copy(r.getCoursePoint(index,0,0,60).position);
            // Course samples are plain coordinates, not Three Vector3 lookAt arguments.
            camera.lookAt(camera.position.clone().copy(r.getCoursePoint(index,26,0,68).position));
            const direction=camera.getWorldDirection(camera.position.clone());
            let Target;g.renderer.scene.traverse(n=>{if(!Target&&n.isLight&&n.shadow?.map)Target=n.shadow.map.constructor;});
            if(!Target)throw new Error('Missing render target for wall acceptance');
            const target=new Target(640,332),pixels=new Uint8Array(640*332*4);
            const previous=three.getRenderTarget();
            three.setRenderTarget(target);three.setScissorTest(false);three.setViewport(0,0,640,332);
            three.render(g.renderer.scene,camera);three.readRenderTargetPixels(target,0,0,640,332,pixels);
            three.setRenderTarget(previous);target.dispose();g.renderer.render();
            let min=255,max=0,lit=0;const colors=new Set();
            for(let i=0;i<pixels.length;i+=4){const v=Math.max(pixels[i],pixels[i+1],pixels[i+2]);min=Math.min(min,v);max=Math.max(max,v);if(v>40)lit++;colors.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);}
            const canvas=document.createElement('canvas');canvas.width=640;canvas.height=332;const data=new Uint8ClampedArray(pixels.length);
            for(let y=0;y<332;y++)data.set(pixels.subarray((331-y)*640*4,(332-y)*640*4),y*640*4);
            canvas.getContext('2d').putImageData(new ImageData(data,640,332),0,0);
            return {min,max,lit,colors:colors.size,direction:direction.toArray(),png:canvas.toDataURL('image/png').split(',')[1]};
        },station.index);
        expect(wall.direction.every(Number.isFinite)).toBe(true);expect(wall.lit).toBeGreaterThan(1000);expect(wall.colors).toBeGreaterThan(100);
        await testInfo.attach(`endless-p7-${station.biome}-wall.png`,{body:Buffer.from(wall.png,'base64'),contentType:'image/png'});
        const {png,...wallStats}=wall;frames[frames.length-1].wall=wallStats;
        const pausedClock=await page.evaluate(()=>window.GAME_INSTANCE.entityManager.endlessParcoursRuntime._biomeResources.clock.value);
        expect(await page.evaluate(()=>window.GAME_INSTANCE.entityManager.endlessParcoursRuntime._biomeResources.clock.value)).toBe(pausedClock);
    }
    // These are same-frame counters with decoration visible/hidden, not a P6 FPS comparison.
    expect(new Set(frames.map(f=>JSON.stringify(f.fog))).size).toBe(1);
    await testInfo.attach('endless-p7-biome-budget.json',{body:JSON.stringify(frames,null,2),contentType:'application/json'});
    expect(errors).toHaveLength(0);
});

test('Endlos P7 returns and restarts without accumulating biome GPU textures',async({page},testInfo)=>{
    test.setTimeout(180_000);const errors=collectErrors(page);await waitForLoadedGame(page);const values=[];
    for(let run=0;run<3;run++){
        const session=await startEndless(page);expect((await step(session,200)).completed).toBe(true);
        values.push(await page.evaluate(()=>{
            const g=window.GAME_INSTANCE,r=g.entityManager.endlessParcoursRuntime,retired=[];
            for(const style of Object.values(r._biomeResources.styles))for(const resource of [style.wall.map,style.wall.emissiveMap,...Object.values(style)]){
                const record={resource,disposed:0};resource.addEventListener('dispose',()=>record.disposed++);retired.push(record);
            }
            window.__p7Retired=retired;
            window.__p7OldRuntime=r;
            const inventory=[];g.renderer.scene.traverse(node=>{
                if(node.isLight&&node.shadow?.map)inventory.push({kind:'shadow',name:node.name,id:node.shadow.map.texture.uuid});
                const materials=Array.isArray(node.material)?node.material:[node.material];
                for(const material of materials)if(material)for(const [key,texture] of Object.entries(material))if(texture?.isTexture)inventory.push({kind:key,name:node.name,id:texture.uuid});
            });
            return {textures:g.renderer.renderer.info.memory.textures,geometries:g.renderer.renderer.info.memory.geometries,inventory};
        }));
        await returnToMenu(page);
        expect(await page.evaluate(()=>window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime||null)).toBeNull();
        const retired=await page.evaluate(()=>window.__p7Retired.map(({resource,disposed})=>({disposed,texture:!!resource.isTexture,
            gpu:!!window.GAME_INSTANCE.renderer.renderer.properties.get(resource).__webglTexture})));
        const lifecycle=await page.evaluate(()=>({disposed:window.__p7OldRuntime._disposed,
            attached:[...window.__p7OldRuntime.activeModules.values()].map(i=>({index:i.module.moduleIndex,parent:i.group.parent?.name})),
            textures:window.GAME_INSTANCE.renderer.renderer.info.memory.textures}));
        values[run].retired=retired;values[run].lifecycle=lifecycle;
    }
    await testInfo.attach('endless-p7-restarts.json',{body:JSON.stringify(values,null,2),contentType:'application/json'});
    for(const value of values){expect(value.retired).toHaveLength(30);expect(value.retired.every(x=>x.disposed===1&&!x.gpu)).toBe(true);}
    expect(values[2].textures).toBeLessThanOrEqual(values[1].textures);expect(values[2].geometries).toBeLessThanOrEqual(values[1].geometries);
    expect(errors).toHaveLength(0);
});

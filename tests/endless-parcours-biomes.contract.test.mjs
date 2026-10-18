import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { ENDLESS_BIOMES, resolveEndlessBiome } from '../src/shared/contracts/EndlessParcoursBiomeContract.js';
import { createEndlessBiomeResources } from '../src/entities/endless/EndlessParcoursBiomeResources.js';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { buildEndlessModuleInstance } from '../src/entities/endless/EndlessParcoursModuleBuilder.js';
import { isEndlessWaterModule } from '../src/entities/endless/EndlessParcoursWater.js';
import { buildEndlessBiomeView } from '../src/entities/endless/EndlessParcoursBiomeView.js';
import { buildEndlessTube, ENDLESS_TUBE, resolveEndlessTubeRadius } from '../src/entities/endless/EndlessParcoursTube.js';
import { createEndlessMaterials } from '../src/entities/endless/EndlessParcoursStageOps.js';
import { createGameRuntimeBundle } from '../src/core/runtime/GameRuntimeBundle.js';
import { MatchSessionRuntimeBridge } from '../src/core/MatchSessionRuntimeBridge.js';
import { disposeMatchSessionSystems } from '../src/state/match-session/MatchSessionSetupOps.js';

test('five deterministic biome appearances reuse the actual route and flooded modules', () => {
    const path = new EndlessParcoursPath({baseSeed:130202}), ids = new Set();
    for(let index=0;index<300;index++) {
        const module=path.getModule(index), wet=isEndlessWaterModule(module,130202);
        const id=resolveEndlessBiome(module,130202,wet); ids.add(id);
        assert.equal(id,resolveEndlessBiome(module,130202,wet));
        if(wet)assert.equal(id,'deepsea');
    }
    assert.deepEqual([...ids].sort(),Object.keys(ENDLESS_BIOMES).sort());path.dispose();
});

test('biome textures are distinct, shared and freed once; paused particles have no clock advance', () => {
    const bank=createEndlessBiomeResources(), hashes=new Set(), resources=[];
    for(const style of Object.values(bank.styles)) {
        const map=style.wall.map; resources.push(map,style.wall.emissiveMap,...Object.values(style));
        hashes.add(createHash('sha256').update(map.image.data).digest('hex'));
        assert.equal(map.image.width,64);assert.equal(map.wrapS,THREE.RepeatWrapping);
        for(const material of [style.wall,style.trim,style.detail])assert.ok(material.emissiveIntensity<2);
    }
    assert.equal(hashes.size,5);
    bank.update(1,1);assert.equal(bank.clock.value,1);bank.update(0,0);assert.equal(bank.clock.value,1);
    bank.update(0.5,999);assert.equal(bank.clock.value,1.5);
    for(const style of Object.values(bank.styles))assert.ok(style.wall.emissiveIntensity<2);
    const disposed=new Map();for(const resource of resources)resource.addEventListener('dispose',()=>disposed.set(resource,(disposed.get(resource)||0)+1));
    bank.dispose();bank.dispose();assert.equal(disposed.size,30);assert.ok([...disposed.values()].every(n=>n===1));
});

test('tube UVs wrap without stretched seam triangles and retain original open boundary vertices', () => {
    const path=new EndlessParcoursPath({baseSeed:130202});
    const tube=buildEndlessTube({module:path.getModule(0),baseSeed:130202,material:new THREE.MeshStandardMaterial(),ownerId:'uv'});
    const geometry=tube.mesh.geometry, uv=geometry.getAttribute('uv'), index=geometry.index;
    assert.equal(uv.count,geometry.getAttribute('position').count);
    for(let i=0;i<index.count;i+=3) {
        const values=[0,1,2].map(j=>uv.getX(index.getX(i+j)));
        assert.ok(Math.max(...values)-Math.min(...values)<=6/ENDLESS_TUBE.radialSegments+1e-5);
    }
    for(const g of tube.geometries)g.dispose();tube.mesh.material.dispose();path.dispose();
});

test('biome decorations stay in the wall, leave side mouths open and cost at most three calls per module', () => {
    const bank=createEndlessBiomeResources();
    const module={moduleIndex:12,areaBlock:1,originZ:1440,length:120,entryDrift:{x:0,y:0},exitDrift:{x:0,y:0}};
    for(const id of Object.keys(ENDLESS_BIOMES)) {
        const view=buildEndlessBiomeView(module,130202,id,bank.styles[id],{firstRing:4,lastRing:10});
        let calls=0,triangles=0;
        view.group.traverse(node=>{
            assert.equal(node.isLight,undefined);
            if(node.isMesh) {
                calls++;triangles+=node.geometry.index.count/3;assert.equal(node.castShadow,false);
                const p=node.geometry.getAttribute('position');
                for(let i=0;i<p.count;i++) {
                    const t=(p.getZ(i)-module.originZ)/120, radius=resolveEndlessTubeRadius(130202,12,t);
                    const segment=Math.PI*2/ENDLESS_TUBE.radialSegments,angle=Math.atan2(p.getY(i),p.getX(i));
                    const within=((angle%segment)+segment)%segment-segment/2;
                    const wall=radius*Math.cos(segment/2)/Math.cos(within);
                    assert.ok(Math.hypot(p.getX(i),p.getY(i))>=wall-0.31,'no solid-looking detail in the cabin');
                    assert.ok(t<4/32-0.02||t>10/32+0.02,'no decoration across the side opening');
                }
            }
            if(node.isPoints){calls++;assert.equal(node.geometry.getAttribute('position').count,24);}
        });
        assert.ok(calls<=3);assert.ok(triangles<=1800);
        view.geometries.forEach(g=>g.dispose());
    }
    bank.dispose();
});

test('appearance does not change physical tube or obstacle triangles, including the side shaft', () => {
    const bank=createEndlessBiomeResources(), path=new EndlessParcoursPath({baseSeed:130202});
    const materials=createEndlessMaterials(),geometry=new THREE.BoxGeometry(1,1,1);
    for(const index of [0,4,10,22]) {
        const options={module:path.getModule(index),geometry,materials,baseSeed:130202};
        const plain=buildEndlessModuleInstance(options),biome=buildEndlessModuleInstance({...options,biomeResources:bank});
        assert.equal(plain.staticColliders.length,biome.staticColliders.length);
        for(let n=0;n<plain.staticColliders.length;n++)assert.deepEqual(plain.staticColliders[n].meshCollider.worldTriangles,biome.staticColliders[n].meshCollider.worldTriangles);
        for(const item of [plain,biome])item.ownedGeometries.forEach(g=>g.dispose());
    }
    bank.dispose();Object.values(materials).forEach(m=>m.dispose());geometry.dispose();path.dispose();
});

test('1000 streamed module changes and repeated restarts dispose every owned visual exactly once', () => {
    for(let restart=0;restart<3;restart++) {
        const runtime=new EndlessParcoursRuntime({baseSeed:130202,entityManager:{humanPlayers:[],bots:[]}});
        const watched=new Map(),seenTextures=new Set();
        const watch=()=>{
            for(const instance of runtime.activeModules.values()) {
                for(const geometry of instance.ownedGeometries)if(!watched.has(geometry)) {
                    watched.set(geometry,0);geometry.addEventListener('dispose',()=>watched.set(geometry,watched.get(geometry)+1));
                }
                const wall=runtime._biomeResources.styles[instance.biomeId].wall;seenTextures.add(wall.map);
            }
            assert.ok(runtime.activeModules.size<=7);
        };
        watch();for(let index=1;index<=(restart===0?1000:12);index++){runtime._syncModules(index);watch();}
        assert.ok(seenTextures.size<=5);runtime.dispose();runtime.dispose();
        assert.ok([...watched.values()].every(count=>count===1));assert.equal(runtime.activeModules.size,0);
    }
});

test('published session teardown releases the entity-owned endless runtime before players without crediting aborted XP', () => {
    const events=[], writes=[];
    const entityManager={humanPlayers:[],bots:[],dispose(){assert.equal(runtime._disposed,true);events.push('entities');}};
    const arena={dispose(){events.push('arena');}};
    const runtime=new EndlessParcoursRuntime({baseSeed:130202,entityManager,arena});
    runtime.runXp=123;runtime._recordStore={loadJsonRecord(){return null;},saveJsonRecord(...args){writes.push(args);return true;}};
    let disposed=0;
    for(const style of Object.values(runtime._biomeResources.styles))for(const item of [style.wall.map,style.wall.emissiveMap,...Object.values(style)])item.addEventListener('dispose',()=>disposed++);
    const bundle=createGameRuntimeBundle(),bridge=new MatchSessionRuntimeBridge({game:{},runtimeBundle:bundle});
    bridge.applyInitializedMatchSession({session:{entityManager,arena,endlessParcoursRuntime:runtime}});
    const refs=bridge.getCurrentMatchSessionRefs();assert.equal(refs.endlessParcoursRuntime,undefined);
    disposeMatchSessionSystems({clearMatchScene(){events.push('scene');}},refs);
    assert.deepEqual(events,['entities','arena','scene']);assert.equal(disposed,30);assert.equal(writes.length,0);
    assert.equal(entityManager.endlessParcoursRuntime,null);runtime.dispose();assert.equal(disposed,30);
});

test('biome shader customization preserves inherited atmosphere uniforms before adding local haze', () => {
    const previous=THREE.Material.prototype.onBeforeCompile, fogClip={value:200};
    THREE.Material.prototype.onBeforeCompile=function(shader){shader.uniforms.fogClipDistance=fogClip;};
    let bank;
    try {
        bank=createEndlessBiomeResources();
        for(const style of Object.values(bank.styles))for(const material of Object.values(style)) {
            const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <fog_fragment>\n#include <color_fragment>'};
            material.onBeforeCompile(shader,{});
            assert.equal(shader.uniforms.fogClipDistance,fogClip);
            assert.ok(shader.uniforms.endlessBiomeHaze);assert.ok(shader.uniforms.endlessBiomeRange);
        }
    } finally {bank?.dispose();THREE.Material.prototype.onBeforeCompile=previous;}
});

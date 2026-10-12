import * as THREE from 'three';
import { resolveArcadeMilestoneCosmetics } from '../contracts/ArcadeMilestoneCosmeticContract.js';

function clearPattern(mesh) {
    const prior=mesh?.userData?.arcadeMilestonePattern;
    if(!prior)return;
    for(const [material,map] of prior.originals){material.map=map;material.needsUpdate=true;}
    prior.texture.dispose();mesh.userData.arcadeMilestonePattern=null;
}
/** Small owned texture, rebuilt only when design/pattern changes and released on removal. */
export function applyArcadeMilestonePattern(mesh,profile) {
    if(!mesh?.isModularVehicle)return;
    const pattern=resolveArcadeMilestoneCosmetics(profile).patternId;
    const prior=mesh.userData.arcadeMilestonePattern;
    if(prior?.pattern===pattern&&prior.children===mesh.children[0])return;
    clearPattern(mesh);
    if(pattern==='standard')return;
    const pixels=new Uint8Array(4*4*4);
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){
        const dark=pattern==='stripes'?x<2:pattern==='grid'?(x===0||y===0):(x===1&&y===1);
        const i=(y*4+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=dark?150:255;pixels[i+3]=255;
    }
    const texture=new THREE.DataTexture(pixels,4,4);
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(3,3);texture.needsUpdate=true;
    const originals=new Map();
    mesh.traverse(node=>{
        for(const material of (Array.isArray(node.material)?node.material:[node.material])){
            if(!material||material.transparent||originals.has(material))continue;
            originals.set(material,material.map);material.map=texture;material.needsUpdate=true;
        }
    });
    mesh.userData.arcadeMilestonePattern={pattern,texture,originals,children:mesh.children[0]};
    if(!mesh.userData.arcadePatternRemovalBound){mesh.addEventListener('removed',()=>clearPattern(mesh));mesh.userData.arcadePatternRemovalBound=true;}
}

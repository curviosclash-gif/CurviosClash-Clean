import { ARCADE_JOURNEY_MAP_PLANNED_LINKS } from '../../shared/contracts/ArcadeJourneyMapContract.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgElement(create, tag, attributes) {
    const node = document.createElementNS?.(SVG_NS, tag) || create(tag, '');
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
}
function place(node, x, y, width) { node.setAttribute('style', 'left:'+x+'px;top:'+y+'px;'+(width?'width:'+width+'px':'')); }
export function createArcadeJourneyMapView(create, worlds, nodes, links) {
    const element=create('div','journey-map'); element.dataset.journeyMap='true';
    element.setAttribute('role','group'); element.setAttribute('aria-label','Arcade-Landkarte');
    const canvas=create('div','journey-map-canvas journey-map-overview');
    const svg=svgElement(create,'svg',{'aria-hidden':'true',class:'journey-map-links'}),defs=svgElement(create,'defs',{});
    for(const [id,color] of [['journey-arrow','var(--menu-muted)'],['journey-arrow-selected','var(--menu-accent-2)']]){
        const marker=svgElement(create,'marker',{id,viewBox:'0 0 8 8',refX:7,refY:4,markerWidth:7,markerHeight:7,markerUnits:'userSpaceOnUse',orient:'auto'});
        marker.appendChild(svgElement(create,'path',{d:'M0 0L8 4L0 8Z',fill:color}));defs.appendChild(marker);
    }
    svg.appendChild(defs);canvas.appendChild(svg);
    const regions=new Map(),worldButtons=new Map(),nodeButtons=new Map(),nodeById=new Map(nodes.map(n=>[n.id,n]));
    for(const world of worlds){
        const region=svgElement(create,'rect',{rx:14,class:'journey-map-region'});svg.appendChild(region);regions.set(world.id,region);
        const button=create('button','journey-map-world');button.type='button';button.dataset.journeyWorld=world.id;
        button.appendChild(create('span','journey-map-world-label',world.label));
        const progress=create('span','journey-map-progress'),reward=create('span','journey-map-reward sr-only');button.append(progress,reward);
        const landmark=create('div','journey-world-landmark');landmark.dataset.worldLandmark=world.id;landmark.setAttribute('aria-hidden','true');
        canvas.append(landmark,button);worldButtons.set(world.id,{button,progress,reward,landmark});
    }
    const paths=links.map(([from,to])=>{
        const planned=ARCADE_JOURNEY_MAP_PLANNED_LINKS.some(e=>e[0]===from&&e[1]===to);
        const clearance=svgElement(create,'path',{class:'journey-path-clearance'});
        const path=svgElement(create,'path',{class:'journey-map-path','vector-effect':'non-scaling-stroke'});
        path.dataset.journeyFrom=from;path.dataset.journeyTo=to;path.dataset.journeyPlanned=String(planned);
        svg.append(clearance,path);return {from,to,planned,path,clearance};
    });
    for(const node of nodes){
        const button=create('button','journey-map-node');button.type='button';button.dataset.journeyNode=node.id;
        const mark=create('span','journey-map-node-mark',node.kind==='tour'?'◎':node.boss?'◆':'●');mark.setAttribute('aria-hidden','true');
        const badge=create('span','journey-map-node-badge');badge.setAttribute('aria-hidden','true');mark.appendChild(badge);
        const label=create('span','journey-map-node-label',node.label);label.lang='de';
        const status=create('span','journey-map-node-status');button.append(mark,label,status);canvas.appendChild(button);
        nodeButtons.set(node.id,{button,mark,badge,status});
    }
    element.appendChild(canvas);
    let currentWorld='',currentNode='',currentPoints=new Map(),visibleIds=new Set(nodes.map(n=>n.id));
    /** @type {(id:string) => void} */ let onWorld=()=>{};
    /** @type {(id:string, focusDetail?:boolean) => void} */ let onSelect=()=>{};
    const focusNode=id=>nodeButtons.get(id)?.button.focus();
    function layout(){
        const width=element.clientWidth||900,columns=currentWorld||width<620?1:2;
        const shownWorlds=worlds.filter(w=>!currentWorld||w.id===currentWorld),slot=width/columns,band=390,height=Math.ceil(shownWorlds.length/columns)*band;
        canvas.setAttribute('style','height:'+height+'px');svg.setAttribute('viewBox','0 0 '+width+' '+height);currentPoints=new Map();
        for(const world of worlds){
            const index=shownWorlds.indexOf(world),shown=index>=0,region=regions.get(world.id),ref=worldButtons.get(world.id);
            region.classList.toggle('hidden',!shown);ref.button.classList.toggle('hidden',!shown);ref.landmark.classList.toggle('hidden',!shown);
            if(!shown)continue;
            const x=index%columns*slot,y=Math.floor(index/columns)*band;
            for(const [key,value] of Object.entries({x:x+5,y:y+55,width:slot-10,height:band-62}))region.setAttribute(key,String(value));
            place(ref.button,x+12,y+4,slot-24);place(ref.landmark,x+slot*.56,y+band-85,slot*.34);
            nodes.filter(n=>n.worldId===world.id).forEach((node,i)=>{
                if(!visibleIds.has(node.id))return;
                const p={x:x+slot*((i%3+.5)/3),y:y+125+Math.floor(i/3)*145};
                currentPoints.set(node.id,p);place(nodeButtons.get(node.id).button,p.x,p.y,Math.min(140,slot*.3));
            });
        }
        for(const [id,ref] of nodeButtons)ref.button.classList.toggle('hidden',!currentPoints.has(id));
        const relevant=new Set();
        function trace(id){for(const e of paths.filter(e=>e.to===id&&!e.planned)){const key=e.from+'>'+e.to;if(relevant.has(key))continue;relevant.add(key);trace(e.from);}}
        trace(currentNode);paths.filter(e=>e.from===currentNode).forEach(e=>relevant.add(e.from+'>'+e.to));
        for(const edge of [...paths].sort((a,b)=>Number(relevant.has(a.from+'>'+a.to))-Number(relevant.has(b.from+'>'+b.to)))){
            const a=currentPoints.get(edge.from),b=currentPoints.get(edge.to),active=relevant.has(edge.from+'>'+edge.to);
            edge.path.classList.toggle('hidden',!a||!b);edge.clearance.classList.toggle('hidden',!a||!b);if(!a||!b)continue;
            let d;
            if(Math.abs(a.y-b.y)<20){const sign=Math.sign(b.x-a.x);d='M'+(a.x+sign*26)+' '+a.y+'L'+(b.x-sign*29)+' '+b.y;}
            else if(nodeById.get(edge.from).worldId===nodeById.get(edge.to).worldId)d='M'+a.x+' '+(a.y+26)+'C'+a.x+' '+(a.y+65)+' '+b.x+' '+(b.y-65)+' '+b.x+' '+(b.y-29);
            else {const gutter=columns===1?8:width/2;d='M'+a.x+' '+(a.y+26)+'Q'+a.x+' '+(a.y+60)+' '+gutter+' '+(a.y+60)+'L'+gutter+' '+(b.y-60)+'Q'+b.x+' '+(b.y-60)+' '+b.x+' '+(b.y-29);}
            edge.path.setAttribute('d',d);edge.clearance.setAttribute('d',d);
            edge.path.classList.toggle('is-planned',edge.planned);edge.path.classList.toggle('is-relevant',active);
            edge.path.setAttribute('marker-end','url(#'+(active?'journey-arrow-selected':'journey-arrow')+')');svg.append(edge.clearance,edge.path);
        }
    }
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(layout):null;observer?.observe(element);
    return {
        element,focusNode,dispose:()=>observer?.disconnect(),focusWorld:id=>worldButtons.get(id)?.button.focus(),
        render(worldId,nodeId,states,visible=nodes.map(n=>n.id)){
            currentWorld=worldId;currentNode=nodeId;visibleIds=new Set(visible);canvas.dataset.journeyWorldPanel=worldId;
            canvas.classList.toggle('journey-map-overview',!worldId);canvas.classList.toggle('journey-map-world-view',!!worldId);
            for(const world of worlds){
                const ref=worldButtons.get(world.id),members=nodes.filter(n=>n.worldId===world.id);
                const stars=members.reduce((s,n)=>s+(states.get(n.id)?.stars||0),0),max=members.reduce((s,n)=>s+(states.get(n.id)?.maxStars||0),0);
                const unknown=members.some(n=>states.get(n.id)?.reason==='unavailable'),unfinished=members.some(n=>n.development);
                ref.progress.textContent=unknown?'Fortschritt nicht lesbar':max?stars+'/'+max+' ★':'Etappen folgen';
                ref.reward.textContent=unfinished?'Welt-Abzeichen: weitere Etappen offen':members.filter(n=>n.stageId).every(n=>states.get(n.id)?.stars>0)?world.label+'-Abzeichen · verdient':'Welt-Abzeichen: überall Bronze';
                ref.button.setAttribute('aria-label',world.label+(worldId?' verkleinern: ':' vergrößern: ')+(unknown?'Fortschritt nicht lesbar':max?stars+' von '+max+' Sternen':'Noch keine spielbaren Etappen')+(unfinished?', weitere Etappen offen':''));
            }
            for(const [id,ref] of nodeButtons){
                const state=states.get(id),node=nodeById.get(id);
                ref.button.classList.toggle('is-selected',id===nodeId);ref.button.classList.toggle('is-locked',!state.unlocked);
                ref.button.classList.toggle('is-development',node.development);ref.button.classList.toggle('is-boss',node.boss===true);
                ref.button.setAttribute('aria-pressed',String(id===nodeId));ref.button.setAttribute('aria-label',node.label+', '+state.label+(state.free?', frei spielbar':''));
                ref.button.tabIndex=id===nodeId?0:-1;
                if(id===nodeId)ref.button.dataset.menuFocusPreferred='true';else delete ref.button.dataset.menuFocusPreferred;
                ref.badge.textContent=node.development?'◌':state.stars?'★':state.unlocked?'✓':state.reason==='unavailable'?'?':'⌑';ref.status.textContent=state.label;
            }
            layout();
        },
        moveFocus(direction,active){
            const from=[...nodeButtons].find(([,r])=>r.button===active);if(!from)return false;
            const origin=currentPoints.get(from[0]);if(!origin)return false;
            const horizontal=['left','right'].includes(direction),sign=['left','up'].includes(direction)?-1:1;
            const choices=[...currentPoints].filter(([id])=>id!==from[0]).map(([id,p])=>({id,forward:(horizontal?p.x-origin.x:p.y-origin.y)*sign,score:Math.hypot(p.x-origin.x,p.y-origin.y)+Math.abs(horizontal?p.y-origin.y:p.x-origin.x)})).filter(p=>p.forward>1).sort((a,b)=>a.score-b.score);
            if(!choices[0])return false;onSelect(choices[0].id);focusNode(choices[0].id);return true;
        },
        activateFocused(active){if(active!==nodeButtons.get(currentNode)?.button)return false;onSelect(currentNode,true);return true;},
        bind(bind,actions){
            ({onWorld,onSelect}=actions);
            for(const [id,ref] of worldButtons)bind(ref.button,'click',()=>onWorld(id));
            for(const [id,ref] of nodeButtons){
                bind(ref.button,'click',()=>onSelect(id));
                bind(ref.button,'keydown',event=>{if(!['Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();if(!event.repeat)onSelect(id,true);});
            }
        },
    };
}

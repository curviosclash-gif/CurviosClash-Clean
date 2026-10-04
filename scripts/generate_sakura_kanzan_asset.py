import bpy, math, random, os, json, time
from mathutils import Vector

# Reproducible mature Prunus serrulata 'Kanzan' spring hero asset.
SEED = int(os.environ.get('SAKURA_KANZAN_SEED', '314159'))
VARIANT = os.environ.get('SAKURA_KANZAN_VARIANT', '01')
FLOWER_FACTOR = float(os.environ.get('SAKURA_KANZAN_FLOWER_FACTOR', '1' if VARIANT == '01' else '0.22'))
random.seed(SEED)
OUT = os.path.abspath(os.environ.get('SAKURA_KANZAN_OUTPUT_DIR', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'models', 'sakura_kanzan')))
os.makedirs(OUT, exist_ok=True)

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    pass

def mat_principled(name, color, rough=0.7, subs=0.0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=rough
    if 'Subsurface Weight' in p.inputs: p.inputs['Subsurface Weight'].default_value=subs
    return m

bark=mat_principled('Bark | warm reddish brown',(.16,.062,.047),.88)
# glTF does not export Blender's procedural Noise-to-Base-Color link.
# Keep the authored brown Base Color directly on Principled BSDF for game GLBs.
petals=[mat_principled('Petals | blush',(.82,.27,.43),.62,.1),mat_principled('Petals | pale pink',(.96,.48,.61),.58,.1),mat_principled('Petals | warm pink',(.67,.16,.32),.64,.08)]
leafmat=mat_principled('Young leaves | bronze green',(.37,.25,.09),.62,.05)
calyxmat=mat_principled('Calyx | muted rose',(.39,.12,.15),.68)
stamenmat=mat_principled('Stamens | golden ivory',(.95,.72,.32),.58)
lentmat=mat_principled('Lenticels | pale warm gray',(.43,.25,.19),.9)
MATS=[bark, *petals, leafmat, calyxmat, stamenmat, lentmat]

def v(x): return Vector(x)
def norm(x):
    q=v(x); return q.normalized() if q.length>1e-8 else Vector((0,0,1))

# Aggregate branch frusta, blossom organs, lenticels, and young leaves by material.
verts=[]; faces=[]; mids=[]; branch_counts={}
def add_face(indices, mi): faces.append(tuple(indices)); mids.append(mi)
def add_tube(points, radii, matidx=0, sides=7, caps=False):
    pts=[v(p) for p in points]
    for i, (pt, rad) in enumerate(zip(pts,radii)):
        tangent=norm(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)])
        ref=Vector((0,0,1)) if abs(tangent.z)<.88 else Vector((1,0,0))
        u=norm(tangent.cross(ref)); w=norm(tangent.cross(u))
        for j in range(sides):
            a=2*math.pi*j/sides; q=pt+rad*(u*math.cos(a)+w*math.sin(a)); verts.append(tuple(q))
    start=len(verts)-len(pts)*sides
    for i in range(len(pts)-1):
        for j in range(sides):
            a=start+i*sides+j; b=start+i*sides+(j+1)%sides
            add_face((a,b,b+sides,a+sides),matidx)
    if caps:
        add_face(tuple(start+j for j in range(sides))[::-1],matidx)
        add_face(tuple(start+(len(pts)-1)*sides+j for j in range(sides)),matidx)

def add_sphere(center, scale, mi, rings=4, seg=6):
    c=v(center); base=len(verts)
    for ri in range(rings+1):
        th=math.pi*ri/rings
        for si in range(seg):
            ph=2*math.pi*si/seg; verts.append((c.x+scale[0]*math.sin(th)*math.cos(ph),c.y+scale[1]*math.sin(th)*math.sin(ph),c.z+scale[2]*math.cos(th)))
    for ri in range(rings):
        for si in range(seg):
            a=base+ri*seg+si; b=base+ri*seg+(si+1)%seg
            add_face((a,b,b+seg,a+seg),mi)

def cubic(a,b,c,d,t): return a*(1-t)**3+b*(3*(1-t)**2*t)+c*(3*(1-t)*t*t)+d*t**3
def make_path(start, direction, length, radius, sag=0.0, bend=0.0, samples=6, order=1):
    branch_counts[order]=branch_counts.get(order,0)+1
    a=v(start); d=norm(direction); side=norm(d.cross(Vector((0,0,1))) if abs(d.z)<.93 else d.cross(Vector((1,0,0))))
    jitter=side*random.uniform(-bend,bend)+Vector((random.uniform(-bend,bend),random.uniform(-bend,bend),0))
    end=a+d*length+jitter+Vector((0,0,-sag))
    c1=a+d*length*.34+side*random.uniform(-bend,bend)+Vector((0,0,.10*length))
    c2=a+d*length*.73+side*random.uniform(-bend,bend)+Vector((0,0,-sag*.55))
    pts=[cubic(a,c1,c2,end,i/(samples-1)) for i in range(samples)]
    radii=[max(.001, radius*(1-.88*i/(samples-1))**1.12) for i in range(samples)]
    add_tube(pts,radii,0,7,False)
    return pts, norm(pts[-1]-pts[-2]), radii

# A low-forking, gently curved bole, tapering into the crown rather than forming an exposed mast.
trunk_pts=[(0,0,-.10),(.025,-.02,.25),(.065,.01,.85),(.10,.04,1.50),(.09,.08,2.12),(.14,.10,2.65),(.18,.075,3.20),(.16,.055,3.78),(.11,.08,4.33),(.08,.12,4.84),(.12,.15,5.33)]
trunk_r=[.34,.315,.28,.25,.225,.19,.155,.118,.078,.04,.005]
add_tube(trunk_pts,trunk_r,0,14,False)

# Main leader remains continuous to full height; scaffold origins and directions are spread in 3D.
primary=[]
spec=[(1.97,.12,3.95,29),(2.24,2.28,3.78,30),(2.49,4.45,3.78,32),
      (2.78,1.22,3.48,32),(3.06,3.48,3.42,35),(3.32,5.62,3.16,38)]
for z,ang,L,updeg in spec:
    root=Vector((.10,.07,z)); dr=Vector((math.cos(ang)*math.cos(math.radians(updeg)), math.sin(ang)*math.cos(math.radians(updeg)), math.sin(math.radians(updeg))))
    pts,tan,radii=make_path(root,dr,L,.145*(1-(z-2)*.13),.22,.32,9,1); primary.append((pts,tan,radii,ang))

terminals=[]
for pts,tan,radii,ang in primary:
    # Secondary limbs inherit the radius at their actual attachment, not the tiny tip radius.
    for j in range(random.randint(5,7)):
        t=random.uniform(.25,.89); idx=min(int(t*(len(pts)-1)),len(pts)-2); base=pts[idx]
        theta=ang+(j*2.399+random.uniform(-.4,.4)); up=random.uniform(.10,.62)
        dr=norm(Vector((math.cos(theta)*.75+tan.x*.25,math.sin(theta)*.75+tan.y*.25,up+tan.z*.22)))
        L=random.uniform(1.25,2.05)*(1-.12*t)
        sp,st,sr=make_path(base,dr,L,radii[idx]*random.uniform(.46,.62),random.uniform(.18,.43),.23,7,2)
        for k in range(random.randint(4,6)):
            u=random.uniform(.30,.94); ii=min(int(u*(len(sp)-1)),len(sp)-2); b=sp[ii]
            az=theta+random.uniform(-1.45,1.45); elevate=random.uniform(-.02,.65)
            td=norm(Vector((math.cos(az),math.sin(az),elevate)))
            tl=random.uniform(.70,1.27); tp,tt,tr=make_path(b,td,tl,sr[ii]*random.uniform(.43,.61),random.uniform(.11,.32),.19,6,3)
            for m in range(random.randint(4,7)):
                u2=random.uniform(.35,.97); iii=min(int(u2*(len(tp)-1)),len(tp)-2); fb=tp[iii]
                fa=az+random.uniform(-1.4,1.4); fd=norm(Vector((math.cos(fa),math.sin(fa),random.uniform(.02,.62))))
                fl=random.uniform(.33,.69); fp,ft,fr=make_path(fb,fd,fl,tr[iii]*random.uniform(.40,.60),random.uniform(.07,.23),.13,5,4)
                for site_t in (.39,.60,.81,1.0):
                    idp=min(int(site_t*(len(fp)-1)),len(fp)-1); terminals.append((fp[idp],ft,fr,fd))

# Short upper shoots complete a rounded, spreading canopy without an exposed central leader.
for i in range(15):
    z=random.uniform(3.62,5.10); ang=i*2.399+random.uniform(-.35,.35); L=random.uniform(1.0,1.88)
    base=Vector((.12,.10,z)); d=norm(Vector((math.cos(ang)*.67,math.sin(ang)*.67,random.uniform(.42,.86))))
    pp,pt,pr=make_path(base,d,L,.055*(5.5-z)/2.0,.12,.19,7,2)
    for m in range(random.randint(5,7)):
        t=random.uniform(.50,.99); bb=pp[min(int(t*(len(pp)-1)),len(pp)-1)]; a=ang+random.uniform(-1.1,1.1)
        fd=norm(Vector((math.cos(a),math.sin(a),random.uniform(.12,.72))))
        base_idx=min(int(t*(len(pp)-1)),len(pp)-1)
        fp,ft,fr=make_path(bb,fd,random.uniform(.44,.82),pr[base_idx]*.48,.12,.12,5,4)
        for site_t in (.39,.60,.81,1.0): terminals.append((fp[int(site_t*(len(fp)-1))],ft,fr,fd))

# Blossom cluster: linked form built directly into consolidated meshes; each blossom has 24 shaped petals,
# a sepal cup, 9 fine stamens and a short pedicel. 4,000-6,000 blossoms, grouped 3-5 per terminal site.
flower_count=0; leaf_count=0
def basis(normal):
    n=norm(normal); ref=Vector((0,0,1)) if abs(n.z)<.90 else Vector((1,0,0)); u=norm(n.cross(ref)); w=norm(n.cross(u)); return u,w,n
def blossom(origin, center, normal, scale, petal_mat):
    global flower_count
    c=v(center); u,w,n=basis(normal); phase=random.uniform(0,2*math.pi)
    # Every rose pedicel grows from its fine twig; no detached golden stalks.
    start=v(origin); add_tube([start,start+(c-start)*.53,c],[.0015,.0012,.0010],5,5,False)
    add_sphere(c-n*.002,(.006*scale,.006*scale,.004*scale),5,2,4)
    # Petals alternate between inner and outer whorls with varied length, width, and slight cupping.
    for pi in range(16):
        whorl=pi//8; local=pi%8
        ang=phase+2*math.pi*local/8+whorl*math.pi/8+random.uniform(-.08,.08)
        radial=u*math.cos(ang)+w*math.sin(ang); tang=-u*math.sin(ang)+w*math.cos(ang)
        length=random.uniform(.024,.030)*scale*(.78 if whorl else 1)
        width=random.uniform(.010,.013)*scale*(.88 if whorl else 1)
        inner=.0018*scale if whorl else .0035*scale
        # Broad, cupped cherry petals with a shallow cleft at the outer edge.
        coords=[(inner,-width*.25),(inner+length*.48,-width*.72),(inner+length*.91,-width*.62),
                (inner+length,-width*.20),(inner+length*.90,0),
                (inner+length,width*.20),(inner+length*.91,width*.62),
                (inner+length*.48,width*.72),(inner,width*.25)]
        base=len(verts)
        for rr,ww in coords:
            q=c+radial*rr+tang*ww+n*(.0015*math.sin(math.pi*rr/max(length,1e-5))+abs(ww)*.16)
            verts.append(tuple(q))
        # Eight facets, with a slightly raised center for a cupped double blossom.
        mid=tuple(c+radial*(inner+length*.42)+n*.001)
        verts.append(tuple(mid)); center_i=len(verts)-1
        for kk in range(8): add_face((center_i,base+kk,base+kk+1),petal_mat)
    # Stamens splay gently from the center. Tiny tapered rods keep golden detail at close view.
    for si in range(4):
        a=phase+si*2.399; radial=u*math.cos(a)+w*math.sin(a); dest=c+radial*random.uniform(.004,.008)*scale+n*random.uniform(.003,.007)*scale
        add_tube([c,dest],[.0007*scale,.00035*scale],6,4,False)
        base=len(verts); e=.0015*scale
        verts.extend([tuple(dest+Vector((e,0,0))),tuple(dest+Vector((-e,0,0))),tuple(dest+Vector((0,e,0))),tuple(dest+Vector((0,-e,0))),tuple(dest+Vector((0,0,e))),tuple(dest+Vector((0,0,-e)))])
        for ff in ((0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)): add_face(tuple(base+x for x in ff),6)
    flower_count+=1

for pos,tangent,radius,direction in terminals:
    # Restrict density to the crown while allowing an imperfect edge and visible airy holes.
    q=v(pos)
    if q.z<3.05 or q.z>7.4: continue
    radial=q-Vector((.10,.06,4.2)); horiz=math.sqrt(radial.x*radial.x+radial.y*radial.y)
    if horiz>4.55 or random.random()<.045: continue
    n=norm(Vector((radial.x*.70,radial.y*.70,.62))+norm(tangent)*.22)
    group=random.randint(3,5)
    for j in range(group):
        if flower_count>=21000: break
        if random.random()>FLOWER_FACTOR: continue
        a=random.uniform(0,2*math.pi); off=Vector((math.cos(a)*random.uniform(.022,.084),math.sin(a)*random.uniform(.022,.084),random.uniform(-.08,.035)))
        ctr=q+off
        blossom(q,ctr,n+Vector((random.uniform(-.70,.70),random.uniform(-.70,.70),random.uniform(-.40,.35))),random.uniform(.88,1.12),random.choices([1,2,3],[.38,.42,.20])[0])
    # Scattered just-opening bronze leaves visible among blossoms.
    if random.random()<.11:
        leaf_count+=1; d=norm(n+Vector((random.uniform(-.8,.8),random.uniform(-.8,.8),random.uniform(.1,.8))))
        tip=q+d*random.uniform(.045,.085); mid=q+(tip-q)*.48; add_tube([q,mid],[.0012,.0007],4,4,False)
        side=norm(d.cross(Vector((0,0,1))))*.012
        base=len(verts); verts.extend([tuple(mid),tuple(mid+(tip-mid)*.5+side),tuple(tip),tuple(mid+(tip-mid)*.5-side)])
        add_face((base,base+1,base+2),4); add_face((base,base+2,base+3),4)

# Small horizontal lenticels applied sparsely to the visible lower bole, surface-following.
lent_count=0
for i in range(430):
    z=random.uniform(.28,2.58); angle=random.uniform(0,2*math.pi)
    k=next(j for j in range(len(trunk_pts)-1) if trunk_pts[j][2]<=z<=trunk_pts[j+1][2])
    t=(z-trunk_pts[k][2])/(trunk_pts[k+1][2]-trunk_pts[k][2])
    rr=trunk_r[k]*(1-t)+trunk_r[k+1]*t
    cx=trunk_pts[k][0]*(1-t)+trunk_pts[k+1][0]*t
    cy=trunk_pts[k][1]*(1-t)+trunk_pts[k+1][1]*t
    c=Vector((cx,cy,z))+Vector((math.cos(angle)*rr,math.sin(angle)*rr,0))
    # short, flattened elliptical dash laid tangent to trunk; horizontal around the bole.
    tangent=Vector((-math.sin(angle),math.cos(angle),0)); add_tube([c-tangent*random.uniform(.005,.012),c+tangent*random.uniform(.005,.012)],[.0014,.0010],7,5,False); lent_count+=1

mesh=bpy.data.meshes.new('Kanzan tree consolidated botanical meshes'); mesh.from_pydata(verts,[],faces); mesh.update()
tree=bpy.data.objects.new('Prunus serrulata Kanzan | 6.5 m spring hero',mesh); bpy.context.collection.objects.link(tree)
for m in MATS: mesh.materials.append(m)
for poly,mi in zip(mesh.polygons,mids): poly.material_index=mi
for p in mesh.polygons: p.use_smooth=True

# Export only the game tree. The source's studio scene is deliberately excluded.
scene=bpy.context.scene
for obj in list(bpy.data.objects):
    if obj != tree:
        bpy.data.objects.remove(obj, do_unlink=True)

# Representative loose foliage anchors carry glTF extras and are batched at runtime.
leaf_mesh=bpy.data.meshes.new('Kanzan wind leaf proxy')
leaf_mesh.from_pydata([(-.045,0,0),(0,0,.13),(.045,0,0),(0,0,-.04)],[],[(0,1,2),(0,2,3)])
leaf_mesh.materials.append(leafmat)
for i in range(48):
    terminal=terminals[(i*len(terminals))//48][0]
    anchor=Vector(terminal)
    obj=bpy.data.objects.new('Kanzan wind leaf anchor %03d'%(i+1),leaf_mesh); scene.collection.objects.link(obj)
    obj.location=anchor; obj.rotation_euler[1]=random.uniform(-math.pi,math.pi)
    obj['role']='wind_leaf'; obj['leaf_index']=i+1; obj['leaf_family']='kanzan'

ratio=float(os.environ.get('SAKURA_KANZAN_DECIMATE_RATIO','0.24' if VARIANT == '01' else '0.035'))
bpy.context.view_layer.objects.active=tree; tree.select_set(True)
# A single collapse pass spends the budget on large faces and destroys the bole
# and tiny pink petals. Keep wood/leaf surfaces intact and simplify each organ
# material separately so its silhouette and colour cannot be starved by wood.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='MATERIAL')
bpy.ops.object.mode_set(mode='OBJECT')
tree_parts=list(bpy.context.selected_objects)
for part in tree_parts:
    material=part.data.materials[0]
    part.name='Kanzan '+material.name
    part['role']='tree_structure' if material == bark else 'tree_organs'
    if material in petals or material in (calyxmat, stamenmat, lentmat):
        dec=part.modifiers.new('Grove organ LOD budget','DECIMATE')
        dec.ratio=max(ratio, 0.18) if material in petals else max(ratio, 0.12)
        bpy.context.view_layer.objects.active=part
        bpy.ops.object.modifier_apply(modifier=dec.name)
    part.data.validate(clean_customdata=False)
    part.data.update()
if VARIANT == '01':
    source_dir=os.path.join(os.path.dirname(OUT), 'blender')
    os.makedirs(source_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(source_dir, 'kanzan_grove.blend'), compress=True)
render_path=os.path.join(OUT,'kanzan_%s.glb'%VARIANT)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=render_path, export_format='GLB', export_apply=True, export_extras=True, export_yup=True)

# Low-poly trunk-only cylinder provides coarse vehicle blocking without leaf physics.
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=.30, depth=2.75, location=(0,0,1.28))
collision=bpy.context.object; collision.name='Kanzan trunk collision'; collision.data.materials.append(bark)
bpy.ops.object.select_all(action='DESELECT'); collision.select_set(True); bpy.context.view_layer.objects.active=collision
if VARIANT == '01':
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'kanzan_collision.glb'), export_format='GLB', export_apply=True, export_extras=True, export_yup=True, use_selection=True)

triangles=sum(len(p.vertices)-2 for part in tree_parts for p in part.data.polygons)
qa={'seed':SEED,'variant':VARIANT,'species':"Prunus serrulata 'Kanzan'",'flower_count':flower_count,'flower_factor':FLOWER_FACTOR,'flowering_sites':len(terminals),'young_leaf_count':leaf_count,'lenticel_count':lent_count,'branch_counts_by_order':branch_counts,'evaluated_mesh_triangles':triangles,'material_count':len(MATS),'render_asset':os.path.basename(render_path),'render_file_bytes':os.path.getsize(render_path),'decimate_ratio':ratio,'source_seed':314159,'bounds_m':'refer to exact GLB reimport report','source_hero_triangles':3390000,'branch_geometry':'seeded primary/secondary/tertiary/fine hierarchy; distance profile has distributed flower thinning plus mesh decimation'}
with open(os.path.join(OUT,'kanzan_%s_qa.json'%VARIANT),'w',encoding='utf-8') as f: json.dump(qa,f,indent=2)
print('SAKURA_KANZAN_GROVE_QA '+json.dumps(qa))

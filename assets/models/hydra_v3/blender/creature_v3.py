"""Deterministic Hydra v3 anatomy, skeletal animation and cinematic construction.

Run build_hydra_v3.py in Blender 4.2 background mode. Z up, -Y forward,
metres, 120 frames at 24 fps. Source helpers live beside this module.
"""
from mathutils import Matrix, Quaternion
import json

# Materials: overlapping broad scutes plus fine procedural scale relief.
for mat, scale in ((skin, 31), (skin_alt, 24), (belly, 16)):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    bs.inputs['Metallic'].default_value = 0.08
    bs.inputs['Roughness'].default_value = 0.46
    tex = nodes.new('ShaderNodeTexVoronoi')
    tex.feature = 'DISTANCE_TO_EDGE'
    tex.inputs['Scale'].default_value = scale
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.33
    bump.inputs['Distance'].default_value = 0.065
    links.new(tex.outputs['Distance'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bs.inputs['Normal'])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 5
    ramp = nodes.new('ShaderNodeValToRGB')
    c = tuple(mat.diffuse_color[:3])
    ramp.color_ramp.elements[0].color = (*[v*0.48 for v in c], 1)
    ramp.color_ramp.elements[1].color = (*[min(v*1.6,1) for v in c], 1)
    links.new(noise.outputs['Fac'], ramp.inputs[0])
    links.new(ramp.outputs[0], bs.inputs['Base Color'])
dark.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = 0.42
scar_mat = material('old healed scars', (0.19,0.25,0.21), 0, 0.7)
pupil_mat = material('slit pupils', (0.004,0.008,0.009), 0, 0.3)

def activate(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

def fuse(name, objects, voxel=0.09):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects: ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = ob.modifiers.new('Continuous anatomical surface', 'REMESH')
    mod.mode = 'VOXEL'; mod.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = ob.modifiers.new('Soften anatomical transitions', 'SMOOTH')
    mod.factor = 1.15; mod.iterations = 4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    smooth(ob)
    return ob

def mesh_obj(name, vertices, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(vertices, [], faces); me.update()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    assign(smooth(ob),mat)
    return ob

def tube(name, pts, radii, mat, sides=16):
    verts, faces = [], []
    for j,p in enumerate(pts):
        tangent = (pts[min(j+1,len(pts)-1)]-pts[max(0,j-1)]).normalized()
        ref = Vector((0,1,0)) if abs(tangent.y)<0.92 else Vector((1,0,0))
        right = tangent.cross(ref).normalized()
        up = right.cross(tangent).normalized()
        for k in range(sides):
            a = 2*math.pi*k/sides
            verts.append(p+radii[j]*(math.cos(a)*right+math.sin(a)*up))
    for j in range(len(pts)-1):
        for k in range(sides):
            a=j*sides+k; b=j*sides+(k+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces += [tuple(reversed(range(sides))),tuple((len(pts)-1)*sides+k for k in range(sides))]
    return mesh_obj(name,verts,faces,mat)

def curved_horn(name,start,end,width,parent,mat=dark):
    a,b=Vector(start),Vector(end)
    pts=[a.lerp(b,j/8)+Vector((0,0.18*math.sin(math.pi*j/8),0)) for j in range(9)]
    ob=tube(name,pts,[width*(1-j/8)**0.75+0.003 for j in range(9)],mat,10)
    ob.parent=parent
    return ob

root=empty('HYDRA | body motion')
parts=[]
for name,pos,scale in [
    ('ribcage',(0,0.4,1.8),(1.48,2.04,1.0)),
    ('chest',(0,-1.0,1.8),(1.28,1.0,1.1)),
    ('withers',(0,-0.2,2.35),(1.17,1.3,0.65)),
    ('pelvis',(0,1.7,1.6),(1.22,0.85,0.83))]:
    parts.append(uv(name,pos,scale,skin,None,32,20))
bases=[Vector(((i-2)*0.48,-0.85+abs(i-2)*0.14,2.42)) for i in range(5)]
for i,p in enumerate(bases):
    parts.append(uv('neck root muscles',p+Vector((0,0,0.1)),(0.60,0.64,0.74),skin))
for s in (-1,1):
    for y in (-1.12,1.48):
        parts.append(uv('shoulder and haunch muscle',(s*1.14,y,1.65),(0.57,0.65,0.63),skin))
body=fuse('HYDRA | continuous torso and five neck roots',parts,0.075)
body.parent=root
# Broad ventral plates follow the body, with visible overlap and tapered edges.
for j in range(9):
    zz=1.05+j*0.18
    yy=-1.0-1.04*math.sqrt(max(0.1,1-((zz-1.8)/1.1)**2))-0.06
    ob=uv(f'ventral breast shield {j}',(0,yy,zz),
          (0.80-j*0.025,0.12,0.125),belly,root,24,12)
for row in range(10):
    yy=-0.85+row*0.32
    for col in range(-3,4):
        xx=col*0.30+(row%2)*0.08
        zz=2.64+0.18*(1-(xx/1.35)**2)-0.14*max(yy,0)
        ob=uv(f'back overlapping scute {row}-{col}',(xx,yy,zz),(0.20,0.29,0.075),skin_alt if col else belly,root,12,8)
        ob.rotation_euler.x=-0.22
    curved_horn(f'dorsal crest {row}',(0,yy,2.76),(0,yy+0.34,3.25-row*0.035),0.15,root)

def pulse(t,a,b):
    if t<=a or t>=b:return 0.0
    return math.sin(math.pi*(t-a)/(b-a))**2

def body_motion(t):
    return Vector((0.10*pulse(t,1.7,4.7),-0.14*pulse(t,2.0,4.5),0.035*math.sin(t*3)+0.09*pulse(t,2,4.7)))

tips=[Vector((-3.15,-2.55,5.8)),Vector((-1.55,-1.55,6.85)),Vector((0,-2.15,7.7)),Vector((1.65,-1.0,6.7)),Vector((3.15,-2.30,5.65))]

def head_pose(i,t):
    p=t*1.18+i*1.4
    notice=pulse(t,0.75+i*0.11,2.8+i*0.08)
    roar=pulse(t,2.65,4.15)
    end=tips[i]+Vector((0.27*math.sin(p),0.22*math.cos(p*0.81),0.15*math.sin(p*0.92)))
    end+=Vector(((i-2)*0.10*roar,-0.40*roar if i==2 else 0.18*roar,0.35*roar if i==2 else -0.12*roar))
    yaw=(i-2)*0.27+0.24*math.sin(p*0.7)+notice*(0.9 if i<3 else -0.75)
    pitch=0.10*math.sin(p)+0.22*notice
    if i==2: yaw*=1-roar; pitch+=0.30*roar
    if i==0:
        yaw-=0.40*pulse(t,3.1,4.9)
        pitch-=0.30*pulse(t,0.2,1.7)
    if i==1:pitch+=0.28*notice
    if i==4:yaw+=1.25*pulse(t,0.1,1.8)
    direction=Vector((math.sin(yaw)*math.cos(pitch),-math.cos(yaw)*math.cos(pitch),math.sin(pitch)))
    return end+body_motion(t),direction

def neck_points(i,t):
    a=bases[i]+body_motion(t); d,look=head_pose(i,t)
    b=a+Vector(((i-2)*0.31,0.10,1.9))
    c=d-look*1.32
    result=[]
    for j in range(15):
        u=j/14; v=1-u
        p=a*v**3+b*3*v*v*u+c*3*v*u*u+d*u**3
        p+=Vector((0.12*math.sin(u*2*math.pi+t*1.6+i)*math.sin(math.pi*u)**2,0.07*math.sin(u*math.pi*2-t+i)*math.sin(math.pi*u)**2,0))
        result.append(p)
    return result

def tail_points(t):
    offset=body_motion(t)
    return [Vector((0.25*u+0.85*u*u*math.sin(t*1.65-u*2.2),1.9+4.1*u,1.62-0.7*math.sin(math.pi*u)+0.45*u*u))+offset for u in [j/14 for j in range(15)]]

leg_specs=[]
for s in (-1,1):
    for rear in (False,True):leg_specs.append((s,rear))
def leg_points(i,t):
    s,rear=leg_specs[i]; y=1.48 if rear else -1.12
    hip=Vector((s*1.0,y,1.85))+body_motion(t)
    foot=Vector((s*1.58,y-0.37,0.21))
    if i==0:
        # One deliberate planted step. Other three feet remain anchored.
        u=max(0,min(1,(t-2.0)/0.65)); ease=u*u*(3-2*u)
        foot.y-=0.28*ease
        foot.z+=0.25*math.sin(math.pi*u)
    knee=hip.lerp(foot,0.52)+Vector((s*0.23,0.35 if rear else -0.22,0.05))
    return [hip,knee,foot]

def toe_points(i,toe,t):
    foot=leg_points(i,t)[-1]
    x=(toe-1)*0.23
    curl=0.10*pulse(t,2.7,4.2)
    if i==0:curl+=0.48*pulse(t,2.0,2.65)
    a=foot+Vector((x,-0.30,-0.03))
    b=a+Vector((0,-0.24*math.cos(curl),0.24*math.sin(curl)))
    c=b+Vector((0,-0.23*math.cos(curl*1.6),-0.08+0.23*math.sin(curl*1.6)))
    return [a,b,c]

arm=bpy.data.armatures.new('Hydra anatomical skeleton')
rig=bpy.data.objects.new('HYDRA | skeleton',arm);scene.collection.objects.link(rig)
rig.show_in_front=True
activate(rig);bpy.ops.object.mode_set(mode='EDIT')
chains={}
for label,pts in [(f'neck{i}',neck_points(i,0)) for i in range(5)]+[('tail',tail_points(0))]+[(f'leg{i}',leg_points(i,0)) for i in range(4)]+[(f'toe{i}_{toe}',toe_points(i,toe,0)) for i in range(4) for toe in range(3)]:
    names=[]
    for j in range(len(pts)-1):
        bone=arm.edit_bones.new(f'{label}.{j:02d}')
        bone.head=pts[j];bone.tail=pts[j+1]
        if j:bone.parent=arm.edit_bones[names[-1]];bone.use_connect=True
        names.append(bone.name)
    chains[label]=names
bpy.ops.object.mode_set(mode='OBJECT')
rests={b.name:b.matrix_local.copy() for b in arm.bones}

def bind(ob,label,weights):
    # weights maps vertex indices to the continuous segment coordinate.
    names=chains[label]
    groups=[ob.vertex_groups.new(name=n) for n in names]
    for vid,u in weights:
        u=max(0,min(len(names)-1,u))
        a=int(u);b=min(a+1,len(names)-1);f=u-a
        groups[a].add([vid],1-f,'REPLACE')
        if b!=a and f>0:groups[b].add([vid],f,'REPLACE')
    mod=ob.modifiers.new('Skeletal deformation','ARMATURE');mod.object=rig

def bind_rigid(ob,label,index):
    # primitive vertices are local, but rig rest space is world space.
    activate(ob);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bind(ob,label,[(v.index,index) for v in ob.data.vertices])

for i in range(5):
    pts=neck_points(i,0)
    radii=[0.51*(1-j/14)+0.265*j/14 for j in range(15)]
    neck=tube(f'neck {i+1} | continuous skin',pts,radii,skin,24)
    bind(neck,f'neck{i}',[(v.index,v.index//24-0.5) for v in neck.data.vertices])
    sub=neck.modifiers.new('Smooth neck contour','SUBSURF');sub.levels=2;sub.render_levels=2
    for j in range(2,14):
        tangent=(pts[min(j+1,14)]-pts[j-1]).normalized()
        front=Vector((0,-1,0));front=(front-tangent*front.dot(tangent)).normalized()
        loc=pts[j]+front*radii[j]*0.92
        ob=uv(f'neck {i+1} ventral scute {j}',loc,(radii[j]*0.80,0.075,0.18),belly,None,16,8)
        ob.rotation_euler=front.to_track_quat('-Y','Z').to_euler()
        bind_rigid(ob,f'neck{i}',j-0.5)
        if j%2==0:
            ob=curved_horn(f'neck {i+1} crest {j}',pts[j]-front*radii[j]*0.85,pts[j]-front*(radii[j]+0.25)+Vector((0,0,0.15)),0.09,None)
            bind_rigid(ob,f'neck{i}',j-0.5)

pts=tail_points(0)
tail=tube('tail | flexible muscular taper',pts,[0.67*(1-j/14)**1.2+0.018 for j in range(15)],skin,20)
bind(tail,'tail',[(v.index,v.index//20-0.5) for v in tail.data.vertices])
sub=tail.modifiers.new('Tail smooth','SUBSURF');sub.levels=2
for j in range(2,13):
    r=0.67*(1-j/14)**1.2
    ob=curved_horn(f'tail crest {j}',pts[j]+Vector((0,0,r)),pts[j]+Vector((0,0.20,r+0.38)),0.14*(1-j/16),None)
    bind_rigid(ob,'tail',j-0.5)

feet=[]
for i,(s,rear) in enumerate(leg_specs):
    pts=leg_points(i,0)
    leg=tube(f'leg {i} | continuous muscle',pts,[0.52,0.34,0.23],skin,20)
    bind(leg,f'leg{i}',[(v.index,v.index//20-0.5) for v in leg.data.vertices])
    sub=leg.modifiers.new('Leg contour','SUBSURF');sub.levels=2
    foot=empty(f'foot {i} | ground contact',pts[-1]);feet.append(foot)
    uv(f'foot {i} pad',(0,-0.12,-0.03),(0.39,0.50,0.20),skin_alt,foot)
    for toe in range(3):
        toe_pts=toe_points(i,toe,0)
        toe_skin=tube(f'foot {i} articulated toe {toe}',toe_pts,[0.115,0.095,0.045],skin,12)
        bind(toe_skin,f'toe{i}_{toe}',[(v.index,v.index//12-0.5) for v in toe_skin.data.vertices])
        sub=toe_skin.modifiers.new('Toe contour','SUBSURF');sub.levels=1
        claw=curved_horn(f'foot {i} claw {toe}',toe_pts[1]+Vector((0,0,0.04)),toe_pts[2]+Vector((0,-0.17,-0.025)),0.085,None)
        bind_rigid(claw,f'toe{i}_{toe}',1)

heads=[];jaws=[];eyes=[];lids=[];tongues=[]
for i in range(5):
    ctrl=empty(f'head {i+1} | intent and gaze');heads.append(ctrl)
    bulk=1.13 if i==2 else (0.94 if i in (0,4) else 1.0)
    pieces=[]
    for name,pos,scale in [('cranium',(0,-0.22,0.06),(0.45,0.60,0.42)),('snout',(0,-0.75,-0.03),(0.34,0.64,0.26)),('cheekL',(-0.31,-0.3,-0.03),(0.24,0.34,0.29)),('cheekR',(0.31,-0.3,-0.03),(0.24,0.34,0.29))]:
        pieces.append(uv(name,pos,scale,skin))
    skull=fuse(f'head {i+1} | sculpted skull',pieces,0.045)
    # fuse preserves first primitive origin; place its vertices in head space.
    activate(skull);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    skull.parent=ctrl
    jaw=empty(f'head {i+1} | jaw',(0,-0.12,-0.22),ctrl);jaws.append(jaw)
    uv('lower mandible',(0,-0.53,-0.16),(0.31,0.66,0.14),skin_alt,jaw,24,12)
    uv('palate',(0,-0.75,-0.25),(0.28,0.48,0.055),mouth,ctrl)
    uv('lower gums',(0,-0.57,-0.08),(0.27,0.52,0.055),mouth,jaw)
    tongue=empty(f'head {i+1} | tongue flick',(0,-0.68,-0.01),jaw);tongues.append(tongue)
    uv('tongue muscle',(0,-0.17,0),(0.10,0.28,0.03),mouth,tongue,16,8)
    for side in (-1,1):
        curved_horn('forked tongue',(side*0.035,-0.34,0),(side*0.08,-0.51,0.01),0.035,tongue,mouth)
        uv('recessed socket',(side*0.36,-0.35,0.24),(0.18,0.22,0.16),dark,ctrl)
        eye=empty('eye gaze',(side*0.43,-0.40,0.26),ctrl);eyes.append((eye,i,side))
        uv('amber iris',(0,0,0),(0.10,0.13,0.10),eye_mat,eye,20,12)
        uv('vertical pupil',(side*0.079,-0.064,0),(0.019,0.057,0.071),pupil_mat,eye,16,10)
        lid=uv('upper lid',(side*0.43,-0.40,0.335),(0.12,0.16,0.045),skin_alt,ctrl,20,10);lids.append((lid,i))
        brow=uv('angular brow',(side*0.32,-0.34,0.39),(0.23,0.28,0.09),skin_alt,ctrl)
        brow.rotation_euler.y=side*0.25
        uv('nostril',(side*0.20,-1.19,0.08),(0.065,0.035,0.038),dark,ctrl)
        for k in range(6):
            y=-0.40-k*0.14
            length=0.20 if k in (1,4) else 0.11+0.025*(k%2)
            curved_horn('upper tooth',(side*0.25,y,-0.23),(side*0.21,y-0.035,-0.23-length),0.046,ctrl,teeth_mat)
            curved_horn('lower tooth',(side*0.24,y+0.04,-0.07),(side*0.22,y+0.015,0.08),0.04,jaw,teeth_mat)
        for k in range(2+(i==2)):
            start=(side*(0.25+k*0.085),0.04+k*0.12,0.30)
            end=(side*(0.40+k*0.17),0.45+k*0.22,0.82+0.18*k+(0.20 if i==2 else 0))
            curved_horn(f'head {i+1} individual horn',start,end,0.16-k*0.025,ctrl)
        for k in range(3):
            ob=uv('cheek scale',(side*0.40,-0.05+k*0.13,0.08),(0.10,0.16,0.065),belly,ctrl,12,8)
        if i in (0,3):
            curved_horn('healed facial scar',(side*0.30,-0.75,0.17),(side*0.38,-0.42,0.29),0.015,ctrl,scar_mat)
    ctrl.scale=(bulk,bulk*(1.10 if i==4 else 1),bulk)

# Skin motion is baked as ordinary pose keys: no frame handlers or external deps.
for frame in range(1,121):
    t=(frame-1)/24
    root.location=body_motion(t)
    root.keyframe_insert(data_path='location',frame=frame)
    body.scale=(1+0.010*math.sin(t*3),1,1+0.018*math.sin(t*3))
    body.keyframe_insert(data_path='scale',frame=frame)
    all_pts={**{f'neck{i}':neck_points(i,t) for i in range(5)},'tail':tail_points(t),**{f'leg{i}':leg_points(i,t) for i in range(4)},**{f'toe{i}_{toe}':toe_points(i,toe,t) for i in range(4) for toe in range(3)}}
    for label,pts in all_pts.items():
        parent_pose=None;parent_rest=None
        for j,name in enumerate(chains[label]):
            delta=pts[j+1]-pts[j]
            rest_direction=(arm.bones[name].tail_local-arm.bones[name].head_local).normalized()
            swing=rest_direction.rotation_difference(delta.normalized())
            rotation=(swing@rests[name].to_quaternion()).to_matrix().to_4x4()
            stretch=delta.length/arm.bones[name].length
            # Uniform scale avoids shear when child rotations counter parent bends.
            # Absolute target matrices keep the full chain endpoint exact.
            desired=Matrix.Translation(pts[j])@rotation@Matrix.Diagonal((stretch,stretch,stretch,1))
            basis=rests[name].inverted()@desired if j==0 else rests[name].inverted()@parent_rest@parent_pose.inverted()@desired
            pb=rig.pose.bones[name];pb.rotation_mode='QUATERNION';pb.matrix_basis=basis
            pb.keyframe_insert(data_path='location',frame=frame)
            pb.keyframe_insert(data_path='rotation_quaternion',frame=frame)
            pb.keyframe_insert(data_path='scale',frame=frame)
            parent_pose=desired;parent_rest=rests[name]
    for i,ctrl in enumerate(heads):
        pos,direction=head_pose(i,t)
        # Last neck segment defines the actual tangent; head and neck turn together.
        pts=all_pts[f'neck{i}'];direction=(pts[-1]-pts[-2]).normalized()
        ctrl.location=pos;ctrl.rotation_mode='QUATERNION'
        ctrl.rotation_quaternion=direction.to_track_quat('-Y','Z')
        ctrl.keyframe_insert(data_path='location',frame=frame);ctrl.keyframe_insert(data_path='rotation_quaternion',frame=frame)
        roar=pulse(t,2.65,4.15)
        jaws[i].rotation_euler.x=0.055+(0.65 if i==2 else 0.17)*roar+0.14*pulse(t,1.3+i*0.13,2.1+i*0.13)
        jaws[i].keyframe_insert(data_path='rotation_euler',frame=frame)
        tongues[i].scale.y=1+0.65*pulse(t,0.4+i*0.31,0.85+i*0.31)
        tongues[i].rotation_euler.x=0.15*math.sin(t*8+i)*roar
        tongues[i].keyframe_insert(data_path='scale',frame=frame);tongues[i].keyframe_insert(data_path='rotation_euler',frame=frame)
    for eye,i,side in eyes:
        eye.rotation_euler.z=0.19*math.sin(t*1.7+i+0.3)
        eye.keyframe_insert(data_path='rotation_euler',frame=frame)
    for lid,i in lids:
        blink=pulse(t,0.50+i*0.32,0.67+i*0.32)+pulse(t,4.35+i*0.055,4.50+i*0.055)
        lid.scale.z=0.045+0.13*blink
        lid.location.z=0.335-0.045*blink
        lid.keyframe_insert(data_path='scale',frame=frame);lid.keyframe_insert(data_path='location',frame=frame)
    for i,foot in enumerate(feet):
        foot.location=all_pts[f'leg{i}'][-1];foot.keyframe_insert(data_path='location',frame=frame)
    if frame%30==0:print('ANIMATION',frame,flush=True)

# Controlled arcane exhalation: tapered core plus particles with travelling trails.
breath=empty('BREATH | mouth source',(0,-1.18,-0.34),heads[2])
for k in range(24):
    ob=uv(f'breath glowing mote {k}',(0,0,0),(0.025,0.09,0.025),glow,breath,10,6)
    for frame in range(1,121):
        t=(frame-1)/24;env=pulse(t,3.0,4.3)
        u=(t*1.6+k/24)%1
        angle=k*2.399+u*3
        ob.location=(math.cos(angle)*0.25*u,-0.2-2.6*u,math.sin(angle)*0.25*u)
        size=env*(1-u)*0.085+0.0001
        ob.scale=(size,size*2.7,size)
        ob.keyframe_insert(data_path='location',frame=frame);ob.keyframe_insert(data_path='scale',frame=frame)
for k in range(5):
    ob=curved_horn('breath filament',(0,0,0),(0.09*math.sin(k),-1.8,0.09*math.cos(k)),0.025,breath,glow)
    for frame in range(1,121):
        env=pulse((frame-1)/24,3.0,4.2)
        ob.scale=(env+0.001,env+0.001,env+0.001);ob.keyframe_insert(data_path='scale',frame=frame)

# Quiet basalt stage keeps the creature readable.
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=7.0,depth=0.30,location=(0,0,-0.17))
platform=bpy.context.object;platform.name='STAGE | basalt';assign(platform,ground_mat)
bevel=platform.modifiers.new('Worn rim','BEVEL');bevel.width=0.12;bevel.segments=3
for r in (5.8,6.25,6.6):torus('STAGE | etched ring',(0,0,-0.005),r,0.012,ring_mat)

def aim(ob,p):ob.rotation_euler=(Vector(p)-ob.location).to_track_quat('-Z','Y').to_euler()
def area(name,pos,color,energy,size):
    bpy.ops.object.light_add(type='AREA',location=pos)
    ob=bpy.context.object;ob.name=name;ob.data.energy=energy;ob.data.color=color;ob.data.shape='DISK';ob.data.size=size;aim(ob,(0,0,3))
area('LIGHT | soft warm key',(2,-8,12),(1,0.83,0.66),2500,8)
area('LIGHT | cool edge',(-7,3,10),(0.35,0.74,1),2800,7)
area('LIGHT | rear separation',(5,6,10),(0.62,0.55,1),2000,6)
area('LIGHT | face fill',(-2,-7,6),(0.75,0.88,1),950,6)
bpy.ops.object.camera_add(location=(10,-19,10.2))
camera=bpy.context.object;camera.name='CAMERA | hero';scene.camera=camera
camera.data.type='ORTHO';camera.data.ortho_scale=20.8
for frame,x in ((1,9.0),(60,7.8),(120,6.6)):
    camera.location=(x,-19,10.0);aim(camera,(0,-0.1,3.7))
    camera.keyframe_insert(data_path='location',frame=frame);camera.keyframe_insert(data_path='rotation_euler',frame=frame)
scene.world.color=(0.035,0.035,0.045)
scene.unit_settings.system='METRIC'
scene.render.resolution_x=1920;scene.render.resolution_y=1080
scene.eevee.taa_render_samples=32
scene.render.fps=24;scene.frame_start=1;scene.frame_end=120
scene.render.image_settings.file_format='FFMPEG';scene.render.image_settings.color_mode='RGB'
scene.render.ffmpeg.codec='H264';scene.render.ffmpeg.format='MPEG4'
scene.render.ffmpeg.constant_rate_factor='HIGH'
scene.render.filepath=str(OUT/'hydra_v3_5_seconds.mp4')
scene['asset_contract']='Hydra v3; five heads; Z up; -Y forward; metres; cinematic non-looping 120f/24fps; deterministic seed 240921'
scene['generator']='build_hydra_v3.py + creature_v3.py'
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hydra_v3.blend'))
scene.render.resolution_percentage=50;scene.eevee.taa_render_samples=16
scene.render.image_settings.file_format='PNG';scene.frame_set(82)
scene.render.filepath=str(OUT/'hydra_v3_preview.png')
bpy.ops.render.render(write_still=True)
print('HYDRA_V3_READY',len(arm.bones),'bones',len(bpy.data.objects),'objects',flush=True)

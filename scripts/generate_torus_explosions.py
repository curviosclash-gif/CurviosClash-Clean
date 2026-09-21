"""Self-contained, keyed volumetric torus VFX for Blender 4.2.

Batch entry point: build_variant(context). No simulation cache or Python handlers.
Dimensions are art-directed metres, not a nuclear yield simulation.
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

GENERATOR_ID = 'torus-explosion'
GENERATOR_VERSION = '1.1.0'


def build_variant(context):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = context['id']
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 1, 144
    scene.eevee.taa_render_samples = 24
    scene.eevee.volumetric_samples = 96
    scene.eevee.volumetric_tile_size = '2'
    scene.eevee.volumetric_start = 10
    scene.eevee.volumetric_end = 48
    scene.eevee.use_volumetric_shadows = True
    scene.eevee.volumetric_shadow_samples = 24
    scene.world = bpy.data.worlds.new('Charcoal studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.09, .11, .14, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .4
    scene.view_settings.view_transform = 'AgX'
    style = int(context['parameters']['style'])
    # Major radius, tube radius, final altitude, smoke, initial heat.
    settings = {
        1: (3.6, 1.1, 6.5, (.24, .18, .13, 1), 5.5),
        2: (4.5, 1.25, 6.1, (.37, .28, .19, 1), 1.5),
        3: (3.7, 1.2, 8.4, (.62, .66, .7, 1), .2),
        4: (3.8, 1.4, 6.8, (.095, .082, .073, 1), 2.5),
    }
    radius, tube, altitude, color, heat = settings[style]
    mat = bpy.data.materials.new('Torus smoke | animated physical coordinates')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    def node(kind, name):
        n = nodes.new(kind)
        n.name = n.label = name
        return n

    def connect(value, socket):
        if isinstance(value, (float, int, tuple)):
            socket.default_value = value
        else:
            links.new(value, socket)

    def calc(op, a, b=0):
        n = node('ShaderNodeMath', op)
        n.operation = op
        connect(a, n.inputs[0]); connect(b, n.inputs[1])
        return n.outputs[0]

    def vector(x, y, z):
        n = node('ShaderNodeCombineXYZ', 'Coordinates')
        for value, socket in zip((x, y, z), n.inputs):
            connect(value, socket)
        return n.outputs[0]

    def length(v):
        n = node('ShaderNodeVectorMath', 'Distance')
        n.operation = 'LENGTH'
        connect(v, n.inputs[0])
        return n.outputs['Value']

    def keyed(name, samples):
        n = node('ShaderNodeValue', name)
        for frame, value in samples:
            n.outputs[0].default_value = value
            n.outputs[0].keyframe_insert('default_value', frame=frame)
        return n.outputs[0]

    r = keyed('01 Major radius', [(1,.06),(20,1.5),(55,radius*.73),(100,radius*.94),(144,radius)])
    h = keyed('02 Altitude', [(1,.55),(20,1.9),(55,altitude*.55),(100,altitude*.84),(144,altitude)])
    minor = keyed('03 Tube radius', [(1,.4),(20,.65),(55,tube*.88),(100,tube),(144,tube*1.08)])
    # Inverse texture advection: positive sampling angle makes gas roll down
    # the outer rim and up the inner face. Circulation slows with entrainment.
    roll = keyed('04 Poloidal roll', [(1,0),(20,2.8),(55,5.6),(100,7.8),(144,8.8)])
    temperature = keyed('05 Cooling glow', [(1,heat*1.6),(20,heat),(55,heat*.09),(100,heat*.006),(144,0)])
    coords = node('ShaderNodeTexCoord','World coordinates')
    # An unscaled coordinate empty prevents domain-size-dependent coordinates.
    empty = bpy.data.objects.new('Smoke coordinates (metres)', None)
    scene.collection.objects.link(empty)
    coords.object = empty
    separate = node('ShaderNodeSeparateXYZ','XYZ')
    links.new(coords.outputs['Object'], separate.inputs[0])
    x, y, z = separate.outputs
    rho = length(vector(x,y,0))
    radial = calc('SUBTRACT',rho,r)
    vertical = calc('SUBTRACT',z,h)
    distance = length(vector(radial,0,vertical))
    # Advect noise around the tube cross-section, not just around the vertical axis.
    c, s = calc('COSINE',roll), calc('SINE',roll)
    rr = calc('ADD', r, calc('SUBTRACT',calc('MULTIPLY',radial,c),calc('MULTIPLY',vertical,s)))
    zz = calc('ADD',calc('MULTIPLY',radial,s),calc('MULTIPLY',vertical,c))
    safe_rho = calc('MAXIMUM',rho,.001)
    flow = vector(calc('MULTIPLY',calc('DIVIDE',x,safe_rho),rr),
                  calc('MULTIPLY',calc('DIVIDE',y,safe_rho),rr),zz)
    noise = node('ShaderNodeTexNoise','Rolling billows')
    noise.noise_dimensions = '4D'
    links.new(flow,noise.inputs['Vector'])
    noise.inputs['Scale'].default_value = 1.7
    noise.inputs['Detail'].default_value = 4
    noise.inputs['Roughness'].default_value = .72
    noise.inputs['W'].default_value = context['seed'] % 1000 / 30
    fine = node('ShaderNodeTexNoise','Fine turbulent erosion')
    links.new(flow,fine.inputs['Vector'])
    fine.inputs['Scale'].default_value = 8
    fine.inputs['Detail'].default_value = 3
    billow = calc('MULTIPLY',calc('SUBTRACT',noise.outputs['Fac'],.5),2.6)
    tube_distance = calc('ADD',distance,billow)
    torus = calc('MAXIMUM',calc('MULTIPLY',calc('SUBTRACT',minor,tube_distance),4.5),0)
    # The toroidal circulation is normally partly hidden by entrained cloud.
    # A turbulent upper dome bridges the centre, retaining the rolled lower rim.
    dome_r = calc('MAXIMUM',calc('MULTIPLY',r,1.04),.35)
    dome_z = calc('SUBTRACT',z,calc('ADD',h,calc('MULTIPLY',minor,.48)))
    dome_distance = length(vector(calc('DIVIDE',rho,dome_r),0,calc('DIVIDE',dome_z,calc('MULTIPLY',minor,1.15))))
    dome = calc('MAXIMUM',calc('MULTIPLY',calc('SUBTRACT',1,calc('ADD',dome_distance,calc('MULTIPLY',billow,.28))),4),0)
    column_height = calc('ADD',h,calc('MULTIPLY',minor,.4))
    relative_z = calc('DIVIDE',z,calc('MAXIMUM',column_height,.1))
    stem_radius = calc('MULTIPLY',minor,calc('ADD',.5,calc('ADD',calc('MULTIPLY',calc('POWER',relative_z,4),1.2),calc('MULTIPLY',calc('POWER',calc('SUBTRACT',1,relative_z),2),.55))))
    upflow = keyed('06 Updraft displacement',[(1,0),(20,2),(55,5),(100,8),(144,10)])
    plume_noise = node('ShaderNodeTexNoise','Rising entrained plume')
    links.new(vector(x,y,calc('SUBTRACT',z,upflow)),plume_noise.inputs['Vector'])
    plume_noise.inputs['Scale'].default_value = 2.5
    plume_noise.inputs['Detail'].default_value = 4
    stem_billow = calc('MULTIPLY',calc('SUBTRACT',plume_noise.outputs['Fac'],.5),1.8)
    stem = calc('MAXIMUM',calc('MULTIPLY',calc('SUBTRACT',stem_radius,calc('ADD',rho,stem_billow)),5),0)
    stem = calc('MULTIPLY',stem,calc('MINIMUM',calc('MAXIMUM',calc('MULTIPLY',calc('SUBTRACT',column_height,z),3),0),1))
    stem = calc('MULTIPLY',stem,calc('GREATER_THAN',z,.08))
    # Low outward dust ring, with its own expansion and flattened cross-section.
    dust_r = calc('MULTIPLY',r,1.25)
    dust_distance = length(vector(calc('SUBTRACT',rho,dust_r),0,calc('MULTIPLY',calc('SUBTRACT',z,.18),3)))
    dust = calc('MAXIMUM',calc('MULTIPLY',calc('SUBTRACT',.85,calc('ADD',dust_distance,billow)),2),0)
    base_distance = length(vector(calc('DIVIDE',rho,calc('MAXIMUM',dust_r,.2)),0,calc('DIVIDE',z,.45)))
    base = calc('MAXIMUM',calc('MULTIPLY',calc('SUBTRACT',1,calc('ADD',base_distance,calc('MULTIPLY',billow,.3))),2),0)
    density = calc('MAXIMUM',calc('MAXIMUM',torus,dome),calc('MAXIMUM',stem,calc('MAXIMUM',dust,base)))
    density = calc('MULTIPLY',density,calc('MULTIPLY',fine.outputs['Fac'],2.2))
    volume = node('ShaderNodeVolumePrincipled','Smoke and fire')
    links.new(density,volume.inputs['Density'])
    volume.inputs['Color'].default_value = color
    volume.inputs['Anisotropy'].default_value = .15
    volume.inputs['Emission Color'].default_value = (1,.18,.012,1)
    flame = calc('MAXIMUM',calc('MULTIPLY',calc('SUBTRACT',noise.outputs['Fac'],.48),5),0)
    glow = calc('MULTIPLY',calc('MULTIPLY',flame,temperature),calc('MINIMUM',density,1))
    links.new(glow,volume.inputs['Emission Strength'])
    out = node('ShaderNodeOutputMaterial','Volume output')
    links.new(volume.outputs['Volume'],out.inputs['Volume'])
    for i, n in enumerate(nodes):
        n.location = ((i % 10)*210, -(i // 10)*210)
    for curve in mat.node_tree.animation_data.action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    bpy.ops.mesh.primitive_cube_add(size=2,location=(0,0,6))
    domain = bpy.context.object
    domain.name = 'Animated torus volume'
    domain.scale = (8,8,6)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    domain.data.materials.append(mat)
    domain['asset_role'] = 'animated-volume'
    domain['major_radius_final'] = radius
    domain['tube_radius_final'] = tube*1.08
    domain['altitude_final'] = altitude
    domain['seed'] = context['seed']
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.name = 'Studio ground'
    ground = bpy.data.materials.new('Matte graphite')
    ground.diffuse_color = (.055,.065,.08,1)
    ground.use_nodes = True
    ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.055,.065,.08,1)
    ground.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .9
    floor.data.materials.append(ground)
    for name, pos, energy, tint, size in [
        ('Large warm key',(-6,-6,13),2200,(1,.86,.7),8),
        ('Cool rim',(4,6,12),3000,(.65,.78,1),7),
        ('Front fill',(1,-8,6),1000,(1,.95,.88),6),
    ]:
        light = bpy.data.lights.new(name,'AREA')
        light.energy, light.color, light.shape, light.size = energy,tint,'DISK',size
        obj = bpy.data.objects.new(name,light)
        scene.collection.objects.link(obj)
        obj.location = pos
        obj.rotation_euler = (Vector((0,0,4))-obj.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(15,-23,18))
    camera = bpy.context.object
    camera.name = 'Three-quarter | torus opening'
    camera.rotation_euler = (Vector((0,0,4.5))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 16
    scene.camera = camera
    scene['description'] = 'Time-compressed cloud development: spherical ignition, buoyant torus, entrainment, cooling and slowing circulation. Procedural VFX, not a CFD or yield simulation.'
    scene['physics_reference'] = 'Glasstone & Dolan, The Effects of Nuclear Weapons, 1977, sections 2.05-2.15.'
    for frame, name in [(1,'Ignition'),(20,'Torus formation'),(55,'Expansion'),(100,'Ascent'),(144,'Cooling')]:
        scene.timeline_markers.new(name,frame=frame)
    scene.frame_set(100)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.shading.type = 'MATERIAL'
    output = Path(context['output_dir'])
    output.mkdir(parents=True,exist_ok=True)
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.filepath = '//animation.mp4'
    path = output/'source.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    return {'outputs':[{'role':'editable','path':str(path)}],
            'metrics':{'triangles':14,'materials':2,'file_size_bytes':path.stat().st_size},
            'metadata':{'frames':144,'fps':24,'torus_hole_radius':radius-tube*1.08}}


if __name__ == '__main__':
    import argparse
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--variant', type=int, choices=range(1,5))
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    seeds = [1769923817,483116456,614008427,1075105527]
    for index in ([args.variant] if args.variant else range(1,5)):
        identity = f'torus-explosion-v{index:02d}'
        build_variant({'id':identity,'seed':seeds[index-1],
                       'parameters':{'style':index},
                       'output_dir':str(args.output_dir.resolve()/identity)})

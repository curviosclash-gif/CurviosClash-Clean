"""Bake four softly lit smoke lobes from the authored Blender volume noise.
Run with Blender 4.2 in background mode. Outputs a 512px RGBA atlas and editable source.
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/vfx/torus-explosions/smoke'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/vfx/torus-explosions/torus-explosion-v01/source.blend'))
    source = bpy.data.materials['Torus smoke | animated physical coordinates']
    roughness = source.node_tree.nodes['Rolling billows'].inputs['Roughness'].default_value
    detail = source.node_tree.nodes['Rolling billows'].inputs['Detail'].default_value
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 32
    scene.eevee.volumetric_samples = 64
    scene.eevee.volumetric_tile_size = '2'
    scene.eevee.volumetric_start, scene.eevee.volumetric_end = .1, 12
    scene.eevee.use_volumetric_shadows = True
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new('Neutral bake world'); scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.3,.3,.3,1)
    mat = bpy.data.materials.new('Baked smoke | source billow noise'); mat.use_nodes = True
    n,l = mat.node_tree.nodes,mat.node_tree.links; n.clear()
    coord=n.new('ShaderNodeTexCoord')
    def calc(op,a,b=0):
        node=n.new('ShaderNodeMath');node.operation=op
        for v,s in zip((a,b),node.inputs):
            if isinstance(v,(int,float)): s.default_value=v
            else:l.new(v,s)
        return node.outputs[0]
    tex=n.new('ShaderNodeTexNoise');tex.name='Rolling billows';tex.noise_dimensions='4D'
    l.new(coord.outputs['Object'],tex.inputs['Vector'])
    tex.inputs['Scale'].default_value=2.6;tex.inputs['Detail'].default_value=detail
    tex.inputs['Roughness'].default_value=roughness
    dist=n.new('ShaderNodeVectorMath');dist.operation='LENGTH';l.new(coord.outputs['Object'],dist.inputs[0])
    noisy=calc('ADD',dist.outputs['Value'],calc('MULTIPLY',calc('SUBTRACT',tex.outputs['Fac'],.5),.75))
    density=calc('MULTIPLY',calc('MAXIMUM',calc('SUBTRACT',1,noisy),0),9)
    volume=n.new('ShaderNodeVolumePrincipled');volume.inputs['Color'].default_value=(.75,.75,.75,1)
    l.new(density,volume.inputs['Density']);out=n.new('ShaderNodeOutputMaterial');l.new(volume.outputs['Volume'],out.inputs['Volume'])
    bpy.ops.mesh.primitive_cube_add(size=3);bpy.context.object.name='Smoke bake domain';bpy.context.object.data.materials.append(mat)
    bpy.ops.object.camera_add(location=(0,-5,0));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=3;scene.camera=cam
    for pos,power in [((-3,-4,5),650),((3,-2,1),180)]:
        data=bpy.data.lights.new('Soft smoke key','AREA');data.energy=power;data.size=4
        obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj);obj.location=pos
        obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
    atlas=bpy.data.images.new('Smoke atlas',width=512,height=512,alpha=True)
    pixels=[0.0]*(512*512*4)
    for tile in range(4):
        tex.inputs['W'].default_value=tile*2.73+3
        # Render result is saved outside the repository; load the written PNG because
        # background EEVEE does not expose Render Result pixels reliably.
        import tempfile
        tile_path=Path(tempfile.gettempdir())/f'curvios-smoke-bake-{tile}.png'
        scene.render.filepath=str(tile_path);bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(str(tile_path),check_existing=False);rgba=list(image.pixels[:])
        alpha=rgba[3::4]
        assert max(alpha[:256]+alpha[-256:]+alpha[::256]+alpha[255::256]) < .001, 'Atlas tile touches its border'
        assert sum(.02 < a < .94 for a in alpha) > 1000, 'Smoke needs graded transparency'
        for y in range(256):
            src=y*256*4;dst=((y+(tile//2)*256)*512+(tile%2)*256)*4
            pixels[dst:dst+1024]=rgba[src:src+1024]
        bpy.data.images.remove(image)
    atlas.pixels[:]=pixels;atlas.filepath_raw=str(OUT/'smoke-atlas.png');atlas.file_format='PNG';atlas.save()
    atlas.pack();scene['atlas_layout']='2x2, four 256px lobes; straight alpha; neutral lit smoke'
    scene.render.filepath='//smoke-preview.png'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'smoke-bake.blend'),compress=True)

if __name__=='__main__':main()

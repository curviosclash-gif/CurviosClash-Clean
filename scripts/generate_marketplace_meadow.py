"""Build an editable static meadow from the self-authored plant catalogue.

Run inside Blender: --python this.py -- --output-dir <new external folder>.
The meadow uses linked mesh copies, metre units and a deterministic layout.
Individual animated plant assets remain separate; this scene is static.
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_marketplace_plants as plants


def layout(seed=300926):
    """Correlated flower patches over a jittered grass grid, inside 8x8m."""
    rng = random.Random(seed)
    rows = []
    for x in range(22):
        for y in range(22):
            rows.append(dict(species='grass', x=-3.675+x*.35+rng.uniform(-.09,.09),
                             y=-3.675+y*.35+rng.uniform(-.09,.09),
                             scale=rng.uniform(.80,1.05), angle=rng.uniform(0,math.tau)))
    names = ['daisy','lavender','poppy','sunflower','cornflower','red_clover',
             'buttercup','chicory','yarrow','ribwort_plantain','wild_strawberry']
    centres = []
    for species in names:
        for attempt in range(1000):
            cx, cy = rng.uniform(-2.7,2.7), rng.uniform(-2.7,2.7)
            if all(math.hypot(cx-x,cy-y)>1.15 for x,y in centres):
                break
        else:
            raise RuntimeError('Cannot place separated flower patches')
        centres.append((cx,cy))
        for _ in range(6 if species == 'sunflower' else 10):
            rows.append(dict(species=species, x=cx+rng.uniform(-.65,.65),
                             y=cy+rng.uniform(-.65,.65), scale=rng.uniform(.72,1.05),
                             angle=rng.uniform(0,math.tau)))
    return rows


def main():
    import bpy
    from mathutils import Vector
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = args.output_dir.resolve()
    if out.exists():
        raise FileExistsError(out)
    out = plants.prepare_variant_output_dir(out)
    scene, asset, presentation = plants.reset_scene(bpy, 'meadow')
    materials = plants.build_plant_materials(bpy)
    prototypes = {}
    rows = layout()
    for species in sorted({row['species'] for row in rows}):
        height = plants.SPECIES_HEIGHT_M[species]
        plan = (plants.build_lod_geometry(species,height,300926,2) if species=='grass'
                else plants.build_geometry(species,height,300926))
        obj = plants.build_plant_object(bpy,plan,materials)
        # No morph keys or action: the shared static scene is compact and portable.
        obj['wind_morph'] = 'static meadow; use individual assets for wind'
        prototypes[species] = obj
    instances = []
    for index,row in enumerate(rows):
        obj = prototypes[row['species']].copy()
        obj.name = f"{row['species']}_{index:03d}"
        asset.objects.link(obj)
        obj.location = (row['x'],row['y'],0)
        obj.rotation_euler.z = row['angle']
        obj.scale = (row['scale'],)*3
        instances.append(obj)
    # Unlinked construction objects must not appear in the editable source.
    for obj in prototypes.values():
        bpy.data.objects.remove(obj)
    ground_mesh = bpy.data.meshes.new('MeadowGround_mesh')
    ground_mesh.from_pydata([(-4,-4,-.015),(4,-4,-.015),(4,4,-.015),(-4,4,-.015)],[],[(0,1,2,3)])
    ground = bpy.data.objects.new('MeadowGround',ground_mesh)
    asset.objects.link(ground)
    mat = bpy.data.materials.new('MeadowSoil'); mat.diffuse_color=(.085,.12,.035,1)
    mat.use_nodes=True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=mat.diffuse_color
    mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.95
    ground.data.materials.append(mat)
    instances.append(ground)
    cameras = {}
    for name,pos in [('overview',(10,-12,10)),('low',(9,-11,3.8)),('side',(-11,-8,6))]:
        data=bpy.data.cameras.new('Camera_'+name); data.type='ORTHO'; data.ortho_scale=12
        camera=bpy.data.objects.new('Camera_'+name,data); presentation.objects.link(camera)
        camera.location=pos
        camera.rotation_euler=(Vector((0,0,.4))-camera.location).to_track_quat('-Z','Y').to_euler()
        cameras[name]=camera
    light_data=bpy.data.lights.new('MeadowSun','SUN');light_data.energy=3;light_data.angle=.35
    light=bpy.data.objects.new('MeadowSun',light_data);presentation.objects.link(light)
    light.rotation_euler=(.5,-.5,-.6)
    fill_data=bpy.data.lights.new('MeadowFill','AREA')
    fill_data.energy=700;fill_data.size=9
    fill=bpy.data.objects.new('MeadowFill',fill_data);presentation.objects.link(fill)
    fill.location=(1,-4,8)
    fill.rotation_euler=(Vector((0,0,.3))-fill.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=cameras['overview']
    bpy.context.view_layer.update()
    before=plants.snapshot(bpy,instances)
    if before['triangles']>1500000: raise RuntimeError('Meadow triangle budget exceeded')
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'Meadow.blend'),check_existing=False)
    plants.export_glb(bpy,out/'meadow.glb',instances,animations=False)
    for name,camera in cameras.items():
        scene.camera=camera;scene.render.filepath=str(out/f'meadow_{name}.png')
        bpy.ops.render.render(write_still=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(out/'meadow.glb'))
    imported=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
    after=plants.snapshot(bpy,imported)
    plants.compare_snapshots('Meadow', before, after)
    bpy.ops.wm.open_mainfile(filepath=str(out/'Meadow.blend'))
    if len([o for o in bpy.context.scene.objects if o.type=='MESH'])!=len(instances):
        raise RuntimeError('Editable meadow instance count drift')
    if bpy.data.libraries or bpy.data.images:raise RuntimeError('External meadow dependencies')
    report={'seed':300926,'area_m':[8,8],'plants':len(rows),
            'species':sorted({r['species'] for r in rows}),'layout':rows,
            'source':before,'roundtrip':after,'roundtrip_import':True,'animation':'static',
            'file_size_bytes':(out/'meadow.glb').stat().st_size}
    (out/'QA.json').write_text(json.dumps(report,indent=2))
    (out/'README.txt').write_text('8 x 8 metre self-authored decorative meadow. Editable linked plant meshes plus static GLB. No wind clip or engine controller in this assembled scene; individual plants provide wind animation. No external textures or libraries. Z-up Blender / Y-up GLB.\n')
    print('MEADOW_OK',len(rows),before['triangles'])


if __name__=='__main__':main()

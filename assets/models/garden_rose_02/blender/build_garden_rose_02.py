"""Build an editable, render-ready garden rose specimen in Blender 4.2.

Run from the repository root with Blender in background mode. No external assets.
"""

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
PREVIEWS = ROOT / "previews"
SEED = 314159
rng = random.Random(SEED)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != "Collection":
        bpy.data.collections.remove(collection)

scene = bpy.context.scene
bpy.context.preferences.filepaths.save_version = 0
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.color_depth = "8"
scene.world.color = (0.15, 0.15, 0.15)


def collection(name):
    group = bpy.data.collections.new(name)
    scene.collection.children.link(group)
    return group


stems = collection("01 Stems and prickles")
foliage = collection("02 Compound leaves")
flower = collection("03 Open flower")
bud_group = collection("04 Bud")
studio = collection("05 Studio")


def material(name, color, roughness=0.7, subsurface=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Subsurface Weight"].default_value = subsurface
    return mat


stem_mat = material("Stem | olive green", (0.105, 0.205, 0.055), 0.68)
thorn_mat = material("Prickles | warm olive", (0.28, 0.25, 0.09), 0.8)
leaf_mats = [
    material("Leaf | mature", (0.045, 0.15, 0.042), 0.49, 0.04),
    material("Leaf | light", (0.075, 0.205, 0.056), 0.53, 0.04),
    material("Leaf | shaded", (0.035, 0.115, 0.04), 0.57, 0.04),
]
vein_mat = material("Leaf midrib", (0.12, 0.235, 0.075), 0.62)
calyx_mat = material("Calyx", (0.12, 0.22, 0.055), 0.71)
petal_mats = [
    material("Petal | carmine", (0.48, 0.018, 0.045), 0.57, 0.07),
    material("Petal | lit crimson", (0.62, 0.025, 0.055), 0.54, 0.07),
    material("Petal | inner ruby", (0.35, 0.008, 0.025), 0.6, 0.07),
    material("Petal | warm edge", (0.58, 0.032, 0.048), 0.56, 0.07),
]


def mesh_object(name, vertices, faces, mat, group, solidify=0.0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    group.objects.link(obj)
    obj.data.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if solidify:
        mod = obj.modifiers.new("Petal or leaf membrane", "SOLIDIFY")
        mod.thickness = solidify
        mod.offset = 0
    return obj


def tube(name, points, radii, mat, group, sides=10):
    points = [Vector(p) for p in points]
    verts, faces = [], []
    for i, center in enumerate(points):
        tangent = (points[min(i + 1, len(points)-1)] - points[max(i - 1, 0)]).normalized()
        reference = Vector((0, 0, 1))
        if abs(tangent.dot(reference)) > 0.9:
            reference = Vector((0, 1, 0))
        right = tangent.cross(reference).normalized()
        up = tangent.cross(right).normalized()
        for k in range(sides):
            angle = 2 * math.pi * k / sides
            verts.append(tuple(center + radii[i] * (math.cos(angle)*right + math.sin(angle)*up)))
    faces.append(tuple(reversed(range(sides))))
    for i in range(len(points)-1):
        for k in range(sides):
            j = (k+1) % sides
            faces.append((i*sides+k, i*sides+j, (i+1)*sides+j, (i+1)*sides+k))
    faces.append(tuple((len(points)-1)*sides+k for k in range(sides)))
    return mesh_object(name, verts, faces, mat, group)


stem_path = [
    (0.0, 0.0, 0.0), (0.006, 0.003, 0.11), (0.018, 0.006, 0.23),
    (0.034, 0.005, 0.35), (0.052, 0.012, 0.47),
    (0.073, 0.025, 0.57), (0.099, 0.044, 0.665),
]
tube("Main arching cane", stem_path, [0.0075, 0.0072, 0.0066, 0.0058, 0.005, 0.0042, 0.0033], stem_mat, stems, 12)


def leaf_blade(name, base, tip, width, normal_hint, mat, group, serration=7, curl=0.003):
    base, tip = Vector(base), Vector(tip)
    axis = (tip-base).normalized()
    normal = Vector(normal_hint).normalized()
    side = axis.cross(normal).normalized()
    normal = side.cross(axis).normalized()
    length = (tip-base).length
    verts, faces = [], []
    steps, across = 24, 6
    for i in range(steps+1):
        t = i/steps
        envelope = max(0.025, max(0, math.sin(math.pi * t)) ** 0.77)
        for j in range(across+1):
            u = 2*j/across-1
            teeth = 1 + (0.09 if j in (0, across) else 0) * math.sin(t*serration*2*math.pi)
            local_width = width*envelope*teeth*u
            arch = (1-u*u)*0.004*math.sin(math.pi*t) + curl*u*u*math.sin(math.pi*t)
            p = base + axis*(length*t) + side*local_width + normal*arch
            verts.append(tuple(p))
    for i in range(steps):
        for j in range(across):
            a = i*(across+1)+j
            faces.append((a, a+1, a+across+2, a+across+1))
    obj = mesh_object(name, verts, faces, mat, group, 0.00055)
    tube(name + " | midrib", [base, base.lerp(tip, 0.5)+normal*0.004, tip], [0.00075, 0.00055, 0.00012], vein_mat, group, 6)
    return obj


leaf_specs = [
    ((0.022, 0.004, 0.25), (-0.19, -0.045, 0.28), 0.92),
    ((0.046, 0.01, 0.42), (0.22, -0.065, 0.47), 1.02),
    ((0.066, 0.02, 0.535), (-0.145, 0.08, 0.575), 0.78),
]
for group_index, (root, tip, scale) in enumerate(leaf_specs):
    root, tip = Vector(root), Vector(tip)
    direction = (tip-root).normalized()
    side = Vector((-direction.y, direction.x, 0)).normalized()
    rachis = [root, root.lerp(tip, 0.35)+Vector((0, 0, 0.014)), root.lerp(tip, 0.68)+Vector((0, 0, 0.013)), tip]
    tube(f"Leaf {group_index+1} rachis", rachis, [0.002, 0.0017, 0.0012, 0.00045], stem_mat, foliage, 8)
    for pair in range(2):
        t = 0.34 + pair*0.28
        anchor = root.lerp(tip, t)+Vector((0, 0, 0.013))
        for sign in (-1, 1):
            blade_length = (0.079 if pair == 0 else 0.068)*scale
            outward = (direction*0.46 + side*sign*0.89).normalized()
            petiole_end = anchor + outward*0.018 + Vector((0, 0, 0.007))
            blade_tip = petiole_end + outward*blade_length + Vector((0, 0, -0.008+0.006*pair))
            tube(f"Leaf {group_index+1} petiole {pair}-{sign}", [anchor, petiole_end], [0.0011, 0.0005], stem_mat, foliage, 6)
            leaf_blade(f"Leaf {group_index+1} leaflet {pair}-{sign}", petiole_end, blade_tip,
                       0.022*scale*(1-0.08*pair), (0, 0, 1), leaf_mats[(group_index+pair+(sign+1)//2)%3], foliage,
                       curl=0.0025*sign)
    terminal_tip = tip + direction*0.062*scale + Vector((0, 0, -0.005))
    leaf_blade(f"Leaf {group_index+1} terminal leaflet", tip-0.009*direction, terminal_tip,
               0.023*scale, (0, 0, 1), leaf_mats[group_index%3], foliage)


for i, (height, angle) in enumerate([(0.095, 0.2), (0.18, 2.4), (0.315, 4.4), (0.395, 1.1), (0.505, 3.2)]):
    base = Vector((0.004+0.13*height, 0.015*height, height))
    radial = Vector((math.cos(angle), math.sin(angle), 0))
    base += radial*0.0045
    tube(f"Curved prickle {i+1}", [base, base+radial*0.010+Vector((0, 0, 0.005)),
         base+radial*0.018+Vector((0, 0, -0.004))], [0.0032, 0.0017, 0.0001], thorn_mat, stems, 7)


def organ_frame(origin, direction):
    direction = Vector(direction).normalized()
    rotation = Vector((0, 0, 1)).rotation_difference(direction)
    return lambda point: tuple(Vector(origin) + rotation @ Vector(point))


def petal(name, frame, angle, root_radius, length, half_width, zbase, ztip, twist, mat, group):
    vertices, faces = [], []
    rows, cols = 14, 10
    for i in range(rows+1):
        t = i/rows
        width_shape = max(0, math.sin(math.pi*(0.08+0.88*t)))**0.7
        for j in range(cols+1):
            u = 2*j/cols-1
            theta = angle + twist*t + 0.09*u*t
            radial = root_radius + length*t - 0.006*(1-u*u)*math.sin(math.pi*t)
            tangential = half_width*width_shape*u
            x = math.cos(theta)*radial - math.sin(theta)*tangential
            y = math.sin(theta)*radial + math.cos(theta)*tangential
            z = zbase + (ztip-zbase)*(t*t*(3-2*t))
            z += 0.006*(1-u*u)*math.sin(math.pi*t) + 0.005*u*u*t*t
            vertices.append(frame((x, y, z)))
    for i in range(rows):
        for j in range(cols):
            a = i*(cols+1)+j
            faces.append((a, a+1, a+cols+2, a+cols+1))
    return mesh_object(name, vertices, faces, mat, group, 0.0008)


flower_origin = Vector(stem_path[-1])
flower_axis = Vector((0.13, -0.49, 0.86)).normalized()
ff = organ_frame(flower_origin, flower_axis)

# A tapered receptacle supports the petals; sepals radiate from its underside.
tube("Flower peduncle", [stem_path[-2], flower_origin], [0.0042, 0.0032], stem_mat, stems, 10)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=ff((0, 0, -0.028)))
receptacle = bpy.context.object
receptacle.name = "Flower receptacle"
receptacle.scale = (0.025, 0.025, 0.018)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for coll in list(receptacle.users_collection): coll.objects.unlink(receptacle)
flower.objects.link(receptacle)
receptacle.data.materials.append(calyx_mat)

for k in range(5):
    angle = 2*math.pi*k/5+0.11
    direction = Vector((math.cos(angle), math.sin(angle), -0.2)).normalized()
    base = Vector(ff((0.012*math.cos(angle), 0.012*math.sin(angle), -0.037)))
    tip = Vector(ff((0.065*math.cos(angle), 0.065*math.sin(angle), -0.045)))
    leaf_blade(f"Sepal {k+1}", base, tip, 0.010, flower_axis, calyx_mat, flower, 3, 0.002)

ring_specs = [
    # count, root radius, length, half width, base height, tip height, phase
    (8, 0.013, 0.077, 0.036, -0.017, -0.005, 0.05),
    (10, 0.009, 0.064, 0.029, -0.008, 0.007, 0.33),
    (11, 0.006, 0.048, 0.022, 0.004, 0.025, 0.06),
    (12, 0.003, 0.032, 0.015, 0.013, 0.037, 0.21),
]
for ring, (count, root_r, length, width, zbase, ztip, phase) in enumerate(ring_specs):
    for k in range(count):
        angle = 2*math.pi*(k+phase)/count + rng.uniform(-0.075, 0.075)
        petal(f"Open rose | layer {ring+1} petal {k+1:02}", ff, angle,
              root_r, length*rng.uniform(0.92, 1.08), width*rng.uniform(0.91, 1.08),
              zbase, ztip+rng.uniform(-0.005, 0.005), rng.uniform(-0.09, 0.09),
              petal_mats[(ring+k//3)%len(petal_mats)], flower)
for k in range(7):
    petal(f"Heart curl {k+1}", ff, 2*math.pi*k/7, 0.001, 0.021, 0.011, 0.025, 0.049,
          0.2, petal_mats[2 if k%3 else 1], flower)


bud_root = Vector((0.055, 0.015, 0.48))
bud_mid = Vector((0.13, -0.036, 0.545))
bud_origin = Vector((0.207, -0.056, 0.603))
tube("Bud lateral shoot", [bud_root, bud_mid, bud_origin], [0.0031, 0.0025, 0.0019], stem_mat, stems, 9)
bud_axis = Vector((0.47, -0.13, 0.87)).normalized()
bf = organ_frame(bud_origin, bud_axis)
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=bf((0, 0, 0.017)))
bud_core = bpy.context.object
bud_core.name = "Bud closed petal core"
bud_core.scale = (0.019, 0.019, 0.039)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for coll in list(bud_core.users_collection): coll.objects.unlink(bud_core)
bud_group.objects.link(bud_core)
bud_core.data.materials.append(petal_mats[2])
for k in range(5):
    petal(f"Bud wrapped petal {k+1}", bf, 2*math.pi*k/5, 0.006, 0.029, 0.014,
          -0.014, 0.051, 0.08, petal_mats[k%3], bud_group)
    angle = 2*math.pi*k/5
    base = Vector(bf((0.007*math.cos(angle), 0.007*math.sin(angle), -0.01)))
    tip = Vector(bf((0.022*math.cos(angle), 0.022*math.sin(angle), 0.034)))
    leaf_blade(f"Bud sepal {k+1}", base, tip, 0.005, bud_axis, calyx_mat, bud_group, 2, 0.001)


def aim(obj, target):
    direction = Vector(target)-obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(name, position, target):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    studio.objects.link(cam)
    cam.location = position
    aim(cam, target)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.9
    return cam


target = (0.025, 0.0, 0.36)
cameras = {
    "hero": add_camera("Camera | hero", (0.95, -1.35, 0.96), target),
    "front": add_camera("Camera | front", (0.0, -1.65, 0.53), target),
    "side": add_camera("Camera | side", (1.65, 0.0, 0.53), target),
    "back": add_camera("Camera | back", (0.0, 1.65, 0.53), target),
}


def area_light(name, position, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    obj.location = position
    aim(obj, target)


area_light("Key | broad softbox", (0.7, -0.7, 1.3), 230, 1.0)
area_light("Fill | neutral", (-0.7, -0.35, 0.85), 105, 0.85)
area_light("Rim | rear", (0.1, 0.8, 1.0), 160, 0.65)

scene.camera = cameras["hero"]
scene["asset_name"] = "Garden rose | carmine hero specimen"
scene["seed"] = SEED
scene["source_up_axis"] = "Z"
scene["origin"] = "cut end of main stem"
scene["runtime_export"] = "none requested"

PREVIEWS.mkdir(parents=True, exist_ok=True)
blend_path = ROOT / "garden_rose_02.blend"
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
for view, camera in cameras.items():
    scene.camera = camera
    scene.render.filepath = str(PREVIEWS / f"{view}.png")
    bpy.ops.render.render(write_still=True)
scene.camera = cameras["hero"]
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
print(f"ROSE_OUTPUT {blend_path}")

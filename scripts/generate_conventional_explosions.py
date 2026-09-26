"""Five editable, deterministic conventional explosion studies for Blender 4.2.

These are cinematic volumetric Blender scenes, not glTF runtime assets: glTF
cannot preserve Blender's procedural volume material. No physics or weapon data
is encoded here. Run: blender -b --python scripts/generate_conventional_explosions.py
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "vfx" / "conventional-explosions"
FPS = 24
STUDIES = (
    dict(name="01_tnt_ground", label="TNT ground burst", seed=5101, scale=1.0,
         fire=(1.0, .22, .035), smoke=(.105, .095, .082), dust=(.26, .225, .18),
         lobes=16, height=3.8, spread=3.1, shock=5.8, lean=0.0, sparks=18),
    dict(name="02_grenade", label="Fragmentation grenade", seed=5102, scale=.64,
         fire=(1.0, .34, .08), smoke=(.12, .125, .12), dust=(.22, .20, .17),
         lobes=11, height=2.6, spread=2.1, shock=3.7, lean=.12, sparks=32),
    dict(name="03_rocket_impact", label="Rocket impact", seed=5103, scale=1.12,
         fire=(1.0, .16, .025), smoke=(.09, .09, .095), dust=(.27, .22, .17),
         lobes=17, height=6.2, spread=2.45, shock=6.4, lean=.65, sparks=24),
    dict(name="04_fuel_flash", label="Fuel flash", seed=5104, scale=1.22,
         fire=(1.0, .43, .085), smoke=(.115, .105, .10), dust=(.19, .17, .145),
         lobes=18, height=2.8, spread=4.6, shock=5.1, lean=.08, sparks=12),
    dict(name="05_breaching_charge", label="Directional breaching charge", seed=5105, scale=.84,
         fire=(1.0, .28, .05), smoke=(.105, .11, .115), dust=(.24, .22, .20),
         lobes=14, height=1.9, spread=2.55, shock=4.3, lean=2.0, sparks=25),
)


def material(name, color, *, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Roughness"].default_value = .92
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    mat.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return mat


def smoke_material(name, color, seed, density):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    tex = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 4.2
    noise.inputs["Detail"].default_value = 4.5
    noise.inputs["Roughness"].default_value = .72
    noise.inputs["W"].default_value = seed / 37
    contrast = nodes.new("ShaderNodeMapRange")
    contrast.inputs["From Min"].default_value = .38
    contrast.inputs["From Max"].default_value = .72
    contrast.inputs["To Min"].default_value = 0
    contrast.inputs["To Max"].default_value = density
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = (*color, 1)
    volume.inputs["Anisotropy"].default_value = .32
    links.new(tex.outputs["Generated"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], contrast.inputs["Value"])
    links.new(contrast.outputs["Result"], volume.inputs["Density"])
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return mat


def fire_material(name, seed):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    tex = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 7.2
    noise.inputs["Detail"].default_value = 6
    noise.inputs["Roughness"].default_value = .75
    noise.inputs["W"].default_value = seed / 29
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for position, color in ((.20, (.025, .008, .003, 1)),
                            (.39, (.22, .025, .004, 1)),
                            (.52, (1, .14, .012, 1)),
                            (.65, (1, .58, .095, 1)),
                            (.79, (1, .87, .48, 1))):
        element = ramp.color_ramp.elements[0] if position == .20 else ramp.color_ramp.elements.new(position)
        element.position = position
        element.color = color
    glow = nodes.new("ShaderNodeMapRange")
    glow.inputs["From Min"].default_value = .35
    glow.inputs["From Max"].default_value = .70
    glow.inputs["To Min"].default_value = .05
    glow.inputs["To Max"].default_value = 9
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Density"].default_value = .45
    volume.inputs["Color"].default_value = (.12, .025, .01, 1)
    links.new(tex.outputs["Generated"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(noise.outputs["Fac"], glow.inputs["Value"])
    links.new(ramp.outputs["Color"], volume.inputs["Emission Color"])
    links.new(glow.outputs["Result"], volume.inputs["Emission Strength"])
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return mat


def uv_ball(name, location, radius, mat, *, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if "billow" in name or "dust front" in name:
        phase = sum(ord(c) for c in name) * .017
        for vertex in obj.data.vertices:
            p = vertex.co
            a = math.atan2(p.y, p.x)
            r = 1 + .28 * math.sin(3 * a + phase + p.z * 2.4) + .15 * math.sin(7 * a - phase + p.z * 5.1)
            vertex.co *= max(.58, r)
    return obj


def animate(obj, keyframes):
    for frame, location, scale in keyframes:
        obj.location = location
        obj.scale = scale
        obj.keyframe_insert("location", frame=frame)
        obj.keyframe_insert("scale", frame=frame)
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            for key in fc.keyframe_points:
                key.interpolation = "BEZIER"


def emission_sphere(name, origin, color, size, seed, times, lean):
    rng = random.Random(seed)
    mat = fire_material(name + " | turbulent flame", seed)
    obj = uv_ball(name, origin, 1, mat, segments=24, rings=16)
    # Hand-broken silhouette; low-frequency deformation avoids polygonal spikes.
    for v in obj.data.vertices:
        p = v.co
        angle = math.atan2(p.y, p.x)
        r = 1 + .10 * math.sin(5 * angle + seed) + .06 * math.sin(9 * angle + p.z * 3)
        v.co *= r * (.96 + .08 * rng.random())
    f0, f1, f2, f3 = times
    animate(obj, ((f0, origin, (.015,) * 3),
                  (f1, (origin[0] + lean * .2, origin[1], origin[2] + size * .16), (size, size * .88, size * .78)),
                  (f2, (origin[0] + lean * .5, origin[1], origin[2] + size * .28), (size * 1.16, size, size * .85)),
                  (f3, (origin[0] + lean, origin[1], origin[2] + size * .45), (.001,) * 3)))
    return obj


def make_study(cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(cfg["seed"])
    scene = bpy.context.scene
    scene.name = cfg["label"]
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 760
    scene.render.resolution_y = 570
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, 72
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.world = bpy.data.worlds.new("charcoal studio")
    scene.world.color = (.025, .028, .034)
    scene["generator"] = "generate_conventional_explosions.py"
    scene["seed"] = cfg["seed"]
    scene["study"] = cfg["label"]
    scene["scope"] = "Blender visual study; no gameplay or blast physics"

    ground = material("charcoal ground", (.095, .10, .105))
    bpy.ops.mesh.primitive_plane_add(size=200)
    bpy.context.object.name = "Studio ground"
    bpy.context.object.data.materials.append(ground)

    # Low, irregular blast rather than a stem and cap. Lateral bias is strongest
    # on the breaching charge, while fuel has the broadest, longest flame front.
    smoke = smoke_material("charred turbulent smoke", cfg["smoke"], cfg["seed"], 3.3)
    dust = smoke_material("ground dust", cfg["dust"], cfg["seed"] + 2, 2.1)
    core = emission_sphere("hot pressure core", (0, 0, .45), cfg["fire"], cfg["scale"] * 1.55,
                           cfg["seed"], (1, 5, 10 if "fuel" not in cfg["name"] else 15, 22), cfg["lean"])
    core["role"] = "fireball"
    for i in range(5):
        a = math.tau * i / 5 + rng.uniform(-.2, .2)
        tongue = emission_sphere(f"turbulent flame {i:02d}", (0, 0, .4), cfg["fire"],
                                 cfg["scale"] * rng.uniform(.42, .72), cfg["seed"] + i + 1,
                                 (1, 6 + i % 3, 13, 21), cfg["lean"])
        shift = Vector((math.cos(a) * .85 * cfg["scale"], math.sin(a) * .85 * cfg["scale"],
                        rng.uniform(.5, 1.3) * cfg["scale"]))
        for key in tongue.animation_data.action.fcurves:
            if key.data_path == "location":
                for point in key.keyframe_points:
                    point.co.y += shift[key.array_index] * min(1, point.co.x / 13)
    for i in range(cfg["lobes"]):
        a = math.tau * (i + rng.uniform(-.22, .22)) / cfg["lobes"]
        reach = rng.uniform(.35, 1.0) * cfg["spread"]
        x = math.cos(a) * reach + cfg["lean"] * reach
        y = math.sin(a) * reach
        z = rng.uniform(.38, cfg["height"])
        radius = rng.uniform(.50, 1.05) * cfg["scale"]
        obj = uv_ball(f"smoke billow {i:02d}", (0, 0, .3), radius, smoke)
        obj["role"] = "volumetric smoke"
        animate(obj, ((1, (0, 0, .3), (.01,) * 3),
                      (8 + i % 5, (x * .40, y * .40, z * .38), (.40, .40, .36)),
                      (22 + i % 6, (x, y, z), (1.0, 1.0, .85)),
                      (72, (x * 1.40, y * 1.40, z + 1.3), (1.65, 1.65, 1.28))))
    for i in range(24):
        a = math.tau * i / 24 + rng.uniform(-.1, .1)
        dist = rng.uniform(.60, 1) * cfg["shock"]
        obj = uv_ball(f"dust front {i:02d}", (0, 0, .15), rng.uniform(.42, .78), dust)
        obj["role"] = "ground dust"
        animate(obj, ((1, (0, 0, .12), (.01,) * 3),
                      (9, (math.cos(a) * dist * .45, math.sin(a) * dist * .45, .15), (.45, .55, .28)),
                      (24, (math.cos(a) * dist, math.sin(a) * dist, .22), (1.2, 1.0, .55)),
                      (72, (math.cos(a) * dist * 1.2, math.sin(a) * dist * 1.2, .25), (1.65, 1.4, .72))))

    ember_mat = material("flying incandescent fragments", cfg["fire"], emission=6)
    for i in range(cfg["sparks"]):
        a = rng.uniform(0, math.tau)
        speed = rng.uniform(1.3, 3.8) * cfg["scale"]
        lift = rng.uniform(.8, 3.2) * cfg["scale"]
        obj = uv_ball(f"fragment {i:02d}", (0, 0, .3), rng.uniform(.022, .065), ember_mat, segments=8, rings=5)
        obj["role"] = "visual fragment"
        animate(obj, ((1, (0, 0, .3), (.001,) * 3),
                      (8, (math.cos(a) * speed * .42 + cfg["lean"], math.sin(a) * speed * .42, lift), (1, 1, 1)),
                      (22, (math.cos(a) * speed + cfg["lean"], math.sin(a) * speed, lift * .55), (.75,) * 3),
                      (35, (math.cos(a) * speed * 1.18 + cfg["lean"], math.sin(a) * speed * 1.18, .05), (.001,) * 3)))

    bpy.ops.object.light_add(type="AREA", location=(0, -4, 7))
    bpy.context.object.name = "soft studio fill"
    bpy.context.object.data.energy = 430
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 9
    bpy.ops.object.light_add(type="POINT", location=(.2, 0, 2.2))
    bpy.context.object.name = "fire bounce"
    bpy.context.object.data.energy = 950
    bpy.context.object.data.color = cfg["fire"]
    bpy.context.object.data.shadow_soft_size = 2

    bpy.ops.object.camera_add(location=(8, -11, 5.5))
    camera = bpy.context.object
    camera.name = "three-quarter preview camera"
    direction = Vector((cfg["lean"] * 1.1, 0, 1.35)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 11.8
    scene.camera = camera
    for f, label in ((1, "ignition"), (8, "blast"), (22, "developed cloud"), (72, "dispersal")):
        scene.timeline_markers.new(label, frame=f)
    scene.frame_set(14)
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    blend = OUT / (cfg["name"] + ".blend")
    image = OUT / (cfg["name"] + ".png")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    scene.render.filepath = str(image)
    bpy.ops.render.render(write_still=True)
    print(f"STUDY {cfg['name']} {blend.stat().st_size} bytes {image.stat().st_size} bytes")


if __name__ == "__main__":
    choice = None
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1:]
        if len(args) == 2 and args[0] == "--variant":
            choice = int(args[1])
    for item in (STUDIES[choice - 1:choice] if choice else STUDIES):
        make_study(item)

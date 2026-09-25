#!/usr/bin/env python3
"""Build the editable sunflower source, shootable GLB, and reference-led QA views.

Run with Blender 4.2 LTS:

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/generate_sunflower_asset.py

The mesh layout, kernel identities, and palettes are deterministic. The only exported
interactive nodes are the 220 individual achenes; their empty sockets stay on the shared
receptacle mesh so removing one achene exposes a real opening.
"""

from __future__ import annotations

from math import cos, pi, sin, sqrt
from pathlib import Path
import json
import random
import struct

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "models" / "sunflower"
SOURCE_DIR = ASSET_DIR / "blender"
PREVIEW_DIR = SOURCE_DIR / "previews"
BLEND_PATH = SOURCE_DIR / "sunflower.blend"
GLB_PATH = ASSET_DIR / "sunflower_shootable.glb"

SEED = 240917
KERNEL_COUNT = 220
GOLDEN_ANGLE = pi * (3.0 - sqrt(5.0))
PLANT_HEIGHT = 4.8
HEAD_DIAMETER = 2.3
HEAD_CENTER = Vector((0.22, -0.13, 4.04))
HEAD_NORMAL = Vector((0.0, -0.82, 0.57)).normalized()
DISK_RADIUS = 0.70
HEAD_KERNEL_RADIUS = 0.82
KERNEL_RADII = (0.029, 0.048, 0.025)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights,
                       bpy.data.curves, bpy.data.collections):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.eevee.taa_render_samples = 24
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_DIR / "sunflower_front.png")
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.35
    scene.view_settings.gamma = 1.0
    scene.world.color = (0.16, 0.19, 0.17)
    scene.render.resolution_percentage = 100
    scene["asset"] = "helianthus_annuus_shootable"
    scene["generator"] = "scripts/generate_sunflower_asset.py"
    scene["seed"] = SEED
    scene["plant_height_m"] = PLANT_HEIGHT
    scene["head_diameter_m"] = HEAD_DIAMETER
    scene["shootable_kernel_count"] = KERNEL_COUNT

    asset_collection = bpy.data.collections.new("Sunflower_RuntimeAsset")
    scene.collection.children.link(asset_collection)
    studio_collection = bpy.data.collections.new("Presentation_and_QA")
    scene.collection.children.link(studio_collection)
    return scene, asset_collection, studio_collection


def rgba(hex_color, alpha=1.0):
    value = int(hex_color)
    return (((value >> 16) & 255) / 255.0,
            ((value >> 8) & 255) / 255.0,
            (value & 255) / 255.0,
            alpha)


def make_material(name, color, roughness=0.75, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.use_backface_culling = False
    return mat


def create_materials():
    return {
        "stem": make_material("Stalk | olive green", 0x35431F, 0.91),
        "stem_light": make_material("Stalk ridges | soft green", 0x596A2C, 0.91),
        "leaf": make_material("Leaf | matte sage", 0x354E28, 0.92),
        "leaf_light": make_material("Leaf sunward surface | pale sage", 0x536B39, 0.92),
        "vein": make_material("Leaf veins | warm green", 0x81904B, 0.9),
        "bract": make_material("Phyllaries | deep green", 0x2F4928, 0.86),
        "bract_light": make_material("Phyllary ridges | fresh green", 0x60753C, 0.84),
        "ray": make_material("Ray florets | sunflower gold", 0xD99A12, 0.76),
        "ray_light": make_material("Ray florets | sunlit gold", 0xE9B920, 0.74),
        "ray_age": make_material("Ray tips | late-season amber", 0xA95C1A, 0.8),
        "disc": make_material("Receptacle | warm umber", 0x291C18, 0.86),
        "disk_flower": make_material("Disc florets | rusty brown", 0x75401F, 0.74),
        "seed_shell_a": make_material("Achene shell | charcoal brown", 0x39352E, 0.78),
        "seed_shell_b": make_material("Achene shell | chestnut brown", 0x463229, 0.8),
        "seed_stripe": make_material("Achene stripe | muted warm grey", 0x897B61, 0.84),
        "socket_rim": make_material("Empty socket | ochre rim", 0x87602F, 0.83),
        "socket_well": make_material("Empty socket | shadowed well", 0x221A14, 0.92),
        "ground": make_material("Studio ground", 0x29352B, 0.98),
    }


def link_object(obj, collection):
    collection.objects.link(obj)
    return obj


def create_mesh_object(name, vertices, faces, materials, face_materials=None, collection=None):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.clear()
    for material in materials:
        mesh.materials.append(material)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    if collection is not None:
        link_object(obj, collection)
    if face_materials is not None:
        for polygon, material_index in zip(mesh.polygons, face_materials):
            polygon.material_index = material_index
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def append_tube_path(vertices, faces, points, radii, sides=10):
    points = [Vector(point) for point in points]
    rings = []
    for index, point in enumerate(points):
        if index == 0:
            tangent = (points[1] - point).normalized()
        elif index == len(points) - 1:
            tangent = (point - points[index - 1]).normalized()
        else:
            tangent = (points[index + 1] - points[index - 1]).normalized()
        reference = Vector((0.0, 0.0, 1.0))
        if abs(tangent.dot(reference)) > 0.92:
            reference = Vector((0.0, 1.0, 0.0))
        axis_x = tangent.cross(reference).normalized()
        axis_y = tangent.cross(axis_x).normalized()
        ring = []
        for side in range(sides):
            angle = 2.0 * pi * side / sides
            vertex = point + radii[index] * (cos(angle) * axis_x + sin(angle) * axis_y)
            ring.append(len(vertices))
            vertices.append(tuple(vertex))
        rings.append(ring)
    for ring_index in range(len(rings) - 1):
        lower = rings[ring_index]
        upper = rings[ring_index + 1]
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((lower[side], lower[nxt], upper[nxt], upper[side]))
    faces.append(tuple(reversed(rings[0])))
    faces.append(tuple(rings[-1]))


def append_uv_sphere(vertices, faces, center, radii, segments=24, rings=12):
    center = Vector(center)
    top = len(vertices)
    vertices.append((center.x, center.y, center.z + radii[2]))
    rows = []
    for ring in range(1, rings):
        latitude = pi * ring / rings
        row = []
        for segment in range(segments):
            longitude = 2.0 * pi * segment / segments
            vertex = (
                center.x + radii[0] * sin(latitude) * cos(longitude),
                center.y + radii[1] * sin(latitude) * sin(longitude),
                center.z + radii[2] * cos(latitude),
            )
            row.append(len(vertices))
            vertices.append(vertex)
        rows.append(row)
    bottom = len(vertices)
    vertices.append((center.x, center.y, center.z - radii[2]))
    for segment in range(segments):
        nxt = (segment + 1) % segments
        faces.append((top, rows[0][segment], rows[0][nxt]))
        faces.append((rows[-1][nxt], rows[-1][segment], bottom))
    for ring in range(len(rows) - 1):
        for segment in range(segments):
            nxt = (segment + 1) % segments
            faces.append((rows[ring][segment], rows[ring + 1][segment],
                          rows[ring + 1][nxt], rows[ring][nxt]))


def make_head_basis():
    normal = HEAD_NORMAL.normalized()
    right = Vector((1.0, 0.0, 0.0))
    plane_up = normal.cross(right).normalized()
    rotation = Matrix((right, plane_up, normal)).transposed().to_quaternion()
    return right, plane_up, normal, rotation


def head_point(x, y, z, basis):
    right, plane_up, normal, _ = basis
    return HEAD_CENTER + right * x + plane_up * y + normal * z


def disk_height(radius):
    ratio = min(1.0, max(0.0, radius / DISK_RADIUS))
    return 0.105 * (1.0 - ratio * ratio) - 0.012 * ratio


def build_stem_and_hairs(collection, mats, rng):
    stem_points = [
        Vector((0.0, 0.0, 0.0)),
        Vector((-0.035, 0.025, 0.82)),
        Vector((0.065, -0.025, 1.8)),
        Vector((0.19, -0.10, 2.8)),
        Vector((0.24, -0.13, 3.42)),
        Vector((0.16, -0.10, 3.83)),
    ]
    stem_radii = [0.086, 0.083, 0.077, 0.071, 0.067, 0.073]
    vertices, faces = [], []
    append_tube_path(vertices, faces, stem_points, stem_radii, sides=14)
    stem = create_mesh_object("SunflowerStalk_nocol", vertices, faces, [mats["stem"]], collection=collection)
    stem["role"] = "sunflower_stalk"

    hair_vertices, hair_faces = [], []
    for index in range(52):
        fraction = 0.16 + 0.8 * ((index * 0.61803398875) % 1.0)
        path_index = min(len(stem_points) - 2, int(fraction * (len(stem_points) - 1)))
        local_t = fraction * (len(stem_points) - 1) - path_index
        point = stem_points[path_index].lerp(stem_points[path_index + 1], local_t)
        tangent = (stem_points[path_index + 1] - stem_points[path_index]).normalized()
        reference = Vector((0.0, 0.0, 1.0))
        side = tangent.cross(reference).normalized()
        if side.length < 0.1:
            side = tangent.cross(Vector((1.0, 0.0, 0.0))).normalized()
        angle = index * GOLDEN_ANGLE
        normal = (side * cos(angle) + tangent.cross(side) * sin(angle)).normalized()
        length = rng.uniform(0.018, 0.038)
        append_tube_path(hair_vertices, hair_faces,
                         [point + normal * stem_radii[path_index],
                          point + normal * (stem_radii[path_index] + length)],
                         [0.0022, 0.0005], sides=4)
    hairs = create_mesh_object("StalkFineHairs_nocol", hair_vertices, hair_faces,
                               [mats["stem_light"]], collection=collection)
    hairs["role"] = "sunflower_stem_detail"


def leaf_surface_height(t, across, curl, teeth_phase):
    envelope = leaf_width_profile(t)
    margin_wave = abs(across) ** 1.5 * sin(t * 16.0 * pi + teeth_phase) * 0.012
    return (0.105 * sin(pi * t) - curl * t * t
            - 0.085 * across * across * envelope
            + 0.015 * sin(t * 2.0 * pi + teeth_phase) * across + margin_wave)


def leaf_width_profile(t):
    """Broad, lower-weighted ovate blade with a pointed petiole and tip."""
    t = max(0.0, min(1.0, t))
    return (t ** 0.48) * ((1.0 - t) ** 0.88) / 0.405


def leaf_surface(length, width, curl, teeth_phase=0.0, rows=56, columns=12):
    vertices, faces = [], []
    for row in range(rows + 1):
        t = row / rows
        envelope = leaf_width_profile(t)
        tooth = 1.0 + 0.105 * cos(t * 26.0 * pi + teeth_phase) + 0.025 * sin(t * 38.0 * pi + teeth_phase * 0.73)
        half_width = width * envelope * tooth
        for column in range(columns + 1):
            across = column / columns * 2.0 - 1.0
            asymmetry = 1.0 + 0.105 * across * sin(pi * t * 1.8 + teeth_phase)
            vertices.append((length * t, half_width * across * asymmetry,
                             leaf_surface_height(t, across, curl, teeth_phase)))
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            b = a + columns + 1
            faces.append((a, b, b + 1, a + 1))
    return vertices, faces


def build_leaves(collection, mats, rng):
    levels = [
        (0.53, 1.15, 0.61, -0.38),
        (0.91, 1.14, 0.60, -0.31),
        (1.31, 1.08, 0.58, -0.25),
        (1.73, 1.02, 0.56, -0.21),
        (2.16, 0.95, 0.54, -0.17),
        (2.56, 0.88, 0.51, -0.14),
        (2.94, 0.79, 0.48, -0.10),
        (3.29, 0.69, 0.44, -0.07),
    ]
    blades_vertices, blades_faces, blade_materials = [], [], []
    vein_vertices, vein_faces = [], []
    hair_vertices, hair_faces = [], []
    for leaf_index, (height, length, width, droop) in enumerate(levels):
        # Mature sunflower leaves alternate along the stalk; neighboring nodes share a
        # golden-angle turn rather than forming the conspicuous opposite pairs in the old mesh.
        azimuth = -1.52 + leaf_index * GOLDEN_ANGLE + rng.uniform(-0.055, 0.055)
        horizontal = Vector((cos(azimuth), sin(azimuth), 0.0))
        direction = horizontal.copy()
        direction.z = sin(droop)
        direction.normalize()
        sideward = Vector((-sin(azimuth), cos(azimuth), 0.0))
        leaf_normal = (sideward * rng.uniform(0.68, 0.84)
                       + horizontal * rng.uniform(-0.2, 0.2)
                       + Vector((0.0, 0.0, rng.uniform(0.38, 0.56)))).normalized()
        lateral = leaf_normal.cross(direction).normalized()
        attach = Vector((0.012 * height, -0.045 * height, height))
        petiole_end = attach + direction * length * 0.28 + Vector((0.0, 0.0, 0.07))
        blade_origin = petiole_end
        basis = Matrix((direction, lateral, direction.cross(lateral))).transposed()
        leaf_curl = rng.uniform(0.1, 0.23)
        leaf_phase = rng.uniform(0, 2 * pi)
        local_vertices, local_faces = leaf_surface(length * 0.9, width, leaf_curl, leaf_phase)
        offset = len(blades_vertices)
        for x, y, z in local_vertices:
            point = blade_origin + basis @ Vector((x, y, z))
            blades_vertices.append(tuple(point))
        blades_faces.extend(tuple(offset + index for index in face) for face in local_faces)
        blade_materials.extend([1 if leaf_index in (1, 4, 6) else 0] * len(local_faces))

        petiole_points = [attach,
                          attach.lerp(petiole_end, 0.45) + Vector((0.0, 0.0, 0.035)),
                          petiole_end]
        append_tube_path(vein_vertices, vein_faces, petiole_points,
                         [0.023, 0.014, 0.008], sides=7)
        # A raised midrib and six paired lateral veins keep the blade from reading as a flat card.
        midrib = []
        for step in range(8):
            t = step / 7
            local = basis @ Vector((length * 0.9 * t, 0.0,
                                    leaf_surface_height(t, 0.0, leaf_curl, leaf_phase) + 0.01))
            midrib.append(blade_origin + local)
        append_tube_path(vein_vertices, vein_faces, midrib,
                         [0.006, 0.005, 0.0045, 0.004, 0.0035, 0.003, 0.0025, 0.0018], sides=5)
        for vein_index in range(1, 8):
            t = vein_index / 8
            envelope = leaf_width_profile(t)
            center = blade_origin + basis @ Vector((length * 0.9 * t, 0.0,
                                                    leaf_surface_height(t, 0.0,
                                                                        leaf_curl,
                                                                        leaf_phase) + 0.012))
            for side_sign in (-1, 1):
                edge_t = min(1.0, t + 0.11)
                edge_across = side_sign * 0.86
                edge = blade_origin + basis @ Vector((length * 0.9 * edge_t,
                                                       edge_across * width * envelope * (1.0 + 0.105 * edge_across * sin(pi * edge_t * 1.8 + leaf_phase)),
                                                       leaf_surface_height(edge_t, edge_across,
                                                                           leaf_curl,
                                                                           leaf_phase) + 0.008))
                append_tube_path(vein_vertices, vein_faces,
                                 [center, center.lerp(edge, 0.5)
                                  + basis @ Vector((0.0, 0.0, 0.005)), edge],
                                 [0.0032, 0.0022, 0.001], sides=4)

        # Fine marginal setae break the blade outline at close range without turning it into fur.
        for side_sign in (-1, 1):
            for hair_index in range(2, 15):
                t = hair_index / 16
                local_envelope = leaf_width_profile(t)
                local_tooth = 1.0 + 0.105 * cos(t * 26.0 * pi + leaf_phase)
                edge_across = side_sign * 0.99
                edge = blade_origin + basis @ Vector((length * 0.9 * t,
                                                       edge_across * width * local_envelope * local_tooth,
                                                       leaf_surface_height(t, edge_across, leaf_curl, leaf_phase) + 0.004))
                direction_sign = -1.0 if (hair_index + leaf_index) % 2 else 1.0
                tip = edge + basis @ Vector((0.004 * direction_sign,
                                             side_sign * rng.uniform(0.006, 0.012),
                                             rng.uniform(0.004, 0.009)))
                append_tube_path(hair_vertices, hair_faces, [edge, tip],
                                 [0.0014, 0.00025], sides=3)

    blades = create_mesh_object("SunflowerLeaves_nocol", blades_vertices, blades_faces,
                                [mats["leaf"], mats["leaf_light"]], blade_materials, collection)
    blades["role"] = "sunflower_leaves"
    veins = create_mesh_object("SunflowerLeafStemsAndVeins_nocol", vein_vertices, vein_faces,
                               [mats["leaf_light"], mats["vein"]], collection=collection)
    veins["role"] = "sunflower_leaf_veins"
    hairs = create_mesh_object("LeafMarginalSetae_nocol", hair_vertices, hair_faces,
                               [mats["vein"]], collection=collection)
    hairs["role"] = "sunflower_leaf_surface_hairs"


def append_head_dish(vertices, faces, face_materials, radius=DISK_RADIUS, radial_steps=12, sides=64):
    rows = []
    for ring in range(radial_steps + 1):
        r = radius * ring / radial_steps
        row = []
        for side in range(sides):
            angle = 2.0 * pi * side / sides
            z = disk_height(r)
            row.append(len(vertices))
            vertices.append((r * cos(angle), r * sin(angle), z))
        rows.append(row)
    for ring in range(radial_steps):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((rows[ring][side], rows[ring + 1][side],
                          rows[ring + 1][nxt], rows[ring][nxt]))
            face_materials.append(0)


def build_head_receptacle(collection, mats, basis):
    vertices, faces, face_materials = [], [], []
    append_head_dish(vertices, faces, face_materials)
    sphere_vertices, sphere_faces = [], []
    append_uv_sphere(sphere_vertices, sphere_faces, (0.0, 0.0, -0.20), (0.73, 0.73, 0.29),
                     segments=48, rings=18)
    sphere_offset = len(vertices)
    vertices.extend(sphere_vertices)
    faces.extend(tuple(sphere_offset + index for index in face) for face in sphere_faces)
    face_materials.extend([1] * len(sphere_faces))
    obj = create_mesh_object("SunflowerHeadInteractive_nocol", vertices, faces,
                             [mats["disc"], mats["bract"]], face_materials, collection)
    obj.location = HEAD_CENTER
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = basis[3]
    obj["role"] = "shootable_sunflower_head"
    obj["kernel_hit_radius"] = HEAD_KERNEL_RADIUS
    obj["kernel_count"] = KERNEL_COUNT
    return obj


def build_kernels(collection, mats, basis, rng):
    shell_vertices, shell_faces = [], []
    stations = [-1.0, -0.78, -0.42, 0.0, 0.42, 0.78, 1.0]
    body_half_length = KERNEL_RADII[1]
    body_half_width = KERNEL_RADII[0]
    body_half_height = KERNEL_RADII[2]
    ring_sides = 16
    rings = []
    for station in stations:
        taper = sqrt(max(0.0, 1.0 - station * station))
        ring = []
        for side in range(ring_sides):
            angle = 2.0 * pi * side / ring_sides
            x = body_half_width * taper * cos(angle)
            z = body_half_height * taper * sin(angle)
            ring.append(len(shell_vertices))
            shell_vertices.append((x, station * body_half_length, z))
        rings.append(ring)
    for ring_index in range(len(rings) - 1):
        for side in range(ring_sides):
            nxt = (side + 1) % ring_sides
            shell_faces.append((rings[ring_index][side], rings[ring_index][nxt],
                                rings[ring_index + 1][nxt], rings[ring_index + 1][side]))
    shell_faces.append(tuple(reversed(rings[0])))
    shell_faces.append(tuple(rings[-1]))

    shell_data = []
    for variant, shell_material in enumerate((mats["seed_shell_a"], mats["seed_shell_b"])):
        # A raised, narrow longitudinal shell stripe reads as a seed marking and stays a
        # separate primitive under the same logical kernel node when GLTFLoader splits materials.
        stripe_vertices, stripe_faces = [], []
        stripe_rows = []
        stripe_half_width = body_half_width * (0.135 + variant * 0.035)
        stripe_offset = 0.0 if variant == 0 else 0.001
        for station in [-0.84, -0.58, -0.28, 0.0, 0.28, 0.58, 0.84]:
            taper = sqrt(max(0.0, 1.0 - station * station))
            half_width = stripe_half_width * taper
            z = body_half_height * taper + 0.0015 + stripe_offset
            y = station * body_half_length
            stripe_rows.append((
                len(stripe_vertices), len(stripe_vertices) + 1,
                len(stripe_vertices) + 2, len(stripe_vertices) + 3,
            ))
            stripe_vertices.extend([(-half_width, y, z), (half_width, y, z),
                                    (-half_width, y, z + 0.001), (half_width, y, z + 0.001)])
        for row in range(len(stripe_rows) - 1):
            low = stripe_rows[row]
            high = stripe_rows[row + 1]
            stripe_faces.append((low[2], low[3], high[3], high[2]))
            stripe_faces.append((low[0], high[0], high[1], low[1]))

        vertices = shell_vertices + stripe_vertices
        stripe_vertex_offset = len(shell_vertices)
        faces = shell_faces + [tuple(stripe_vertex_offset + index for index in face) for face in stripe_faces]
        mesh = bpy.data.meshes.new("SunflowerAcheneMesh_" + str(variant))
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(shell_material)
        mesh.materials.append(mats["seed_stripe"])
        mesh.update()
        for face_index, polygon in enumerate(mesh.polygons):
            polygon.material_index = 0 if face_index < len(shell_faces) else 1
            polygon.use_smooth = True
        shell_data.append(mesh)

    positions = []
    for kernel_index in range(1, KERNEL_COUNT + 1):
        radius = DISK_RADIUS * 0.94 * sqrt((kernel_index - 0.5) / KERNEL_COUNT)
        angle = (kernel_index - 1) * GOLDEN_ANGLE + rng.uniform(-0.012, 0.012)
        x = radius * cos(angle)
        y = radius * sin(angle)
        z = disk_height(radius) + 0.024 + 0.004 * sin(kernel_index * 1.7)
        center = head_point(x, y, z, basis)
        local_rotation = Euler((rng.uniform(-0.11, 0.11), rng.uniform(-0.11, 0.11),
                                angle + rng.uniform(-0.24, 0.24)), "XYZ").to_quaternion()
        obj = bpy.data.objects.new("SunflowerKernel_" + str(kernel_index).zfill(3)
                                   + "_SHOOTABLE_nocol", shell_data[kernel_index % 2])
        link_object(obj, collection)
        obj.location = center
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = basis[3] @ local_rotation
        size = rng.uniform(0.89, 1.11)
        obj.scale = (size, size, size)
        obj["role"] = "shootable_kernel"
        obj["kernel_index"] = kernel_index
        obj["hit_radius_x"] = KERNEL_RADII[0]
        obj["hit_radius_y"] = KERNEL_RADII[1]
        obj["hit_radius_z"] = KERNEL_RADII[2]
        obj["flight_profile"] = "heavy_achene_v1"
        positions.append((x, y, z, angle))
    return positions


def build_kernel_sockets(collection, mats, basis, positions):
    vertices, faces, face_materials = [], [], []
    sides = 10
    for x, y, _z, angle in positions:
        radius = sqrt(x * x + y * y)
        z = disk_height(radius) + 0.006
        phase = angle + 0.1 * sin(angle * 2.0)
        outer = []
        inner = []
        for side in range(sides):
            local_angle = phase + 2.0 * pi * side / sides
            outer.append(len(vertices))
            vertices.append((x + 0.032 * cos(local_angle), y + 0.032 * sin(local_angle), z))
            inner.append(len(vertices))
            vertices.append((x + 0.013 * cos(local_angle), y + 0.013 * sin(local_angle), z + 0.001))
        center = len(vertices)
        vertices.append((x, y, z - 0.001))
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((outer[side], outer[nxt], inner[nxt], inner[side]))
            face_materials.append(0)
            faces.append((center, inner[side], inner[nxt]))
            face_materials.append(1)
    sockets = create_mesh_object("SunflowerKernelSockets_nocol", vertices, faces,
                                 [mats["socket_rim"], mats["socket_well"]],
                                 face_materials, collection)
    sockets.location = HEAD_CENTER
    sockets.rotation_mode = "QUATERNION"
    sockets.rotation_quaternion = basis[3]
    sockets["role"] = "kernel_sockets"
    sockets["socket_count"] = len(positions)


def build_ray_florets(collection, mats, basis, rng):
    vertices, faces, face_materials = [], [], []
    radial_rows = 16
    across_rows = 8
    for layer in range(2):
        petal_count = 34 if layer == 0 else 28
        phase = 0.12 if layer == 0 else pi / petal_count + 0.04
        for petal_index in range(petal_count):
            angle = 2.0 * pi * petal_index / petal_count + phase + rng.uniform(-0.045, 0.045)
            start = rng.uniform(0.60, 0.69) + layer * 0.025
            length = rng.uniform(0.35, 0.59) if layer == 0 else rng.uniform(0.42, 0.68)
            width = rng.uniform(0.071, 0.102)
            curve = rng.uniform(-0.055, 0.055)
            tip_phase = rng.uniform(0.0, 2.0 * pi)
            age_tip = rng.random() < 0.15
            rows = []
            for row in range(radial_rows + 1):
                t = row / radial_rows
                envelope = (0.27 + 0.73 * min(1.0, t * 3.8))
                envelope *= 1.0 - 0.34 * max(0.0, (t - 0.82) / 0.18) ** 1.7
                half_width = width * envelope
                center_r = start + length * t + 0.018 * cos(2.5 * pi + tip_phase) * t ** 12
                center_angle = angle + curve * t * t
                z_center = 0.018 + 0.031 * sin(pi * t) - 0.042 * t * t + 0.009 * layer
                row_indices = []
                for column in range(across_rows + 1):
                    across = column / across_rows * 2.0 - 1.0
                    # Ray florets terminate in several shallow lobes instead of one needle point.
                    r = center_r + 0.016 * cos(across * 2.5 * pi + tip_phase) * t ** 12
                    r += curve * across * t * 0.15
                    theta = center_angle + across * half_width / max(0.2, center_r)
                    z = z_center + 0.018 * (1.0 - across * across) * sin(pi * min(1.0, t * 1.4))
                    z += 0.004 * sin(t * 4.0 * pi + tip_phase) * across
                    row_indices.append(len(vertices))
                    vertices.append((r * cos(theta), r * sin(theta), z))
                rows.append(row_indices)
            for row in range(radial_rows):
                for column in range(across_rows):
                    faces.append((rows[row][column], rows[row][column + 1],
                                  rows[row + 1][column + 1], rows[row + 1][column]))
                    if age_tip and row >= radial_rows - 2:
                        face_materials.append(2)
                    else:
                        face_materials.append(1 if (petal_index + layer) % 5 == 0 else 0)
    rays = create_mesh_object("SunflowerRayFlorets_nocol", vertices, faces,
                              [mats["ray"], mats["ray_light"], mats["ray_age"]],
                              face_materials, collection)
    rays.location = HEAD_CENTER
    rays.rotation_mode = "QUATERNION"
    rays.rotation_quaternion = basis[3]
    rays["role"] = "sunflower_ray_florets"


def build_phyllaries(collection, mats, basis, rng):
    vertices, faces, face_materials = [], [], []
    vein_vertices, vein_faces = [], []
    hair_vertices, hair_faces = [], []
    for row in range(3):
        count = 22 + row * 2
        phase = row * 0.17 + pi / count
        for index in range(count):
            angle = 2.0 * pi * index / count + phase + rng.uniform(-0.03, 0.03)
            start_radius = 0.51 + row * 0.045
            length = rng.uniform(0.29, 0.47) + row * 0.035
            width = rng.uniform(0.061, 0.089)
            rows = []
            for step in range(10):
                t = step / 9
                envelope = max(0.0, sin(pi * (0.08 + 0.84 * t))) ** 0.7
                half_width = width * envelope * (1.1 - 0.45 * t)
                radius = start_radius + length * t
                z_center = -0.31 - row * 0.06 - 0.20 * t * t
                row_indices = []
                for across_index in range(5):
                    across = across_index / 4 * 2.0 - 1.0
                    theta = angle + across * half_width / max(0.2, radius)
                    z = z_center + 0.01 * (1.0 - across * across)
                    row_indices.append(len(vertices))
                    vertices.append((radius * cos(theta), radius * sin(theta), z))
                rows.append(row_indices)
            for step in range(len(rows) - 1):
                for across in range(4):
                    faces.append((rows[step][across], rows[step][across + 1],
                                  rows[step + 1][across + 1], rows[step + 1][across]))
                    face_materials.append(1 if across in (1, 2) and index % 3 == 0 else 0)
            line = []
            for step in range(8):
                t = step / 7
                radius = start_radius + length * t
                line.append(Vector((radius * cos(angle), radius * sin(angle),
                                    -0.30 - row * 0.06 - 0.20 * t * t + 0.014)))
            append_tube_path(vein_vertices, vein_faces, line,
                             [0.0048, 0.0045, 0.0042, 0.0038, 0.0034, 0.0029, 0.0022, 0.0013],
                             sides=4)

    # The smooth receptacle cap used to remain exposed on the back. Four overlapping
    # involucre ranks now follow its ellipsoid and read as real, ribbed phyllaries.
    back_rows = (
        (12, 0.025, 0.40, 0.052),
        (17, 0.17, 0.48, 0.062),
        (22, 0.33, 0.53, 0.071),
        (28, 0.49, 0.48, 0.075),
    )
    for row, (count, start_radius, length_base, width_base) in enumerate(back_rows):
        phase = GOLDEN_ANGLE * row * 0.43 + 0.11
        for index in range(count):
            angle = 2.0 * pi * index / count + phase + rng.uniform(-0.045, 0.045)
            length = length_base * rng.uniform(0.88, 1.12)
            width = width_base * rng.uniform(0.88, 1.12)
            steps, across_steps = 12, 6
            rows = []
            for step in range(steps + 1):
                t = step / steps
                radius = start_radius + length * t
                envelope = max(0.0, sin(pi * (0.08 + 0.84 * t))) ** 0.64
                half_width = width * envelope * (0.92 - 0.18 * t)
                clipped_radius = min(0.73, radius)
                cap_z = -0.20 - 0.29 * sqrt(max(0.02, 1.0 - (clipped_radius / 0.73) ** 2))
                row_indices = []
                for across_index in range(across_steps + 1):
                    across = across_index / across_steps * 2.0 - 1.0
                    theta = angle + across * half_width / max(0.15, radius)
                    z = cap_z - 0.008 - 0.024 * (1.0 - across * across) * envelope
                    z -= 0.014 * t * t
                    row_indices.append(len(vertices))
                    vertices.append((radius * cos(theta), radius * sin(theta), z))
                rows.append(row_indices)
            for step in range(steps):
                for across in range(across_steps):
                    faces.append((rows[step][across], rows[step][across + 1],
                                  rows[step + 1][across + 1], rows[step + 1][across]))
                    face_materials.append(1 if across in (2, 3) and (index + row) % 3 == 0 else 0)

            midline = []
            for step in range(7):
                t = step / 6
                radius = start_radius + length * t
                clipped_radius = min(0.73, radius)
                cap_z = -0.20 - 0.29 * sqrt(max(0.02, 1.0 - (clipped_radius / 0.73) ** 2))
                midline.append(Vector((radius * cos(angle), radius * sin(angle), cap_z - 0.044 - 0.014 * t * t)))
            append_tube_path(vein_vertices, vein_faces, midline,
                             [0.0042, 0.004, 0.0037, 0.0032, 0.0027, 0.002, 0.0012], sides=4)

            for t in (0.28, 0.52, 0.76, 0.93):
                radius = start_radius + length * t
                clipped_radius = min(0.73, radius)
                cap_z = -0.20 - 0.29 * sqrt(max(0.02, 1.0 - (clipped_radius / 0.73) ** 2))
                envelope = max(0.0, sin(pi * (0.08 + 0.84 * t))) ** 0.64
                half_width = width * envelope * (0.92 - 0.18 * t)
                for side_sign in (-1, 1):
                    theta = angle + side_sign * half_width / max(0.15, radius)
                    edge = Vector((radius * cos(theta), radius * sin(theta), cap_z - 0.012 - 0.014 * t * t))
                    tangent = Vector((-sin(theta) * side_sign, cos(theta) * side_sign, 0.0))
                    hair_tip = edge + tangent * rng.uniform(0.009, 0.016) + Vector((0.0, 0.0, -0.006))
                    append_tube_path(hair_vertices, hair_faces, [edge, hair_tip],
                                     [0.0016, 0.00025], sides=3)
    bracts = create_mesh_object("SunflowerInvolucre_nocol", vertices, faces,
                                [mats["bract"], mats["bract_light"]], face_materials, collection)
    bracts.location = HEAD_CENTER
    bracts.rotation_mode = "QUATERNION"
    bracts.rotation_quaternion = basis[3]
    bracts["role"] = "sunflower_involucre"
    veins = create_mesh_object("SunflowerInvolucreRibs_nocol", vein_vertices, vein_faces,
                               [mats["bract_light"]], collection=collection)
    veins.location = HEAD_CENTER
    veins.rotation_mode = "QUATERNION"
    veins.rotation_quaternion = basis[3]
    veins["role"] = "sunflower_bract_veins"
    hairs = create_mesh_object("InvolucreCilia_nocol", hair_vertices, hair_faces,
                               [mats["bract_light"]], collection=collection)
    hairs.location = HEAD_CENTER
    hairs.rotation_mode = "QUATERNION"
    hairs.rotation_quaternion = basis[3]
    hairs["role"] = "sunflower_bract_cilia"


def build_disc_floret_collar(collection, mats, basis):
    vertices, faces, face_materials = [], [], []
    count = 34
    for index in range(count):
        angle = index * GOLDEN_ANGLE
        radius = 0.735 + 0.025 * sin(index * 2.3)
        x, y = radius * cos(angle), radius * sin(angle)
        z = disk_height(DISK_RADIUS) + 0.012
        base = len(vertices)
        vertices.extend([
            (x - 0.013 * cos(angle), y - 0.013 * sin(angle), z),
            (x + 0.013 * cos(angle), y + 0.013 * sin(angle), z),
            (x + 0.003 * cos(angle), y + 0.003 * sin(angle), z + 0.045),
            (x - 0.003 * cos(angle), y - 0.003 * sin(angle), z + 0.045),
        ])
        faces.extend([(base, base + 1, base + 2, base + 3)])
        face_materials.append(index % 3 == 0 and 1 or 0)
    florets = create_mesh_object("PeripheralDiscFlorets_nocol", vertices, faces,
                                 [mats["disk_flower"], mats["ray_age"]], face_materials, collection)
    florets.location = HEAD_CENTER
    florets.rotation_mode = "QUATERNION"
    florets.rotation_quaternion = basis[3]
    florets["role"] = "nonshootable_disc_florets"


def add_camera(collection, name, location, target, lens=52, ortho=6.4):
    camera_data = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, camera_data)
    link_object(camera, collection)
    camera.location = Vector(location)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ortho
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = lens
    return camera


def add_area_light(collection, name, location, target, power, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    link_object(light, collection)
    light.location = location
    light.rotation_euler = (Vector(target) - light.location).to_track_quat("-Z", "Y").to_euler()
    return light


def build_studio(scene, collection):
    ground_vertices = [(-12, -12, -0.03), (12, -12, -0.03),
                       (12, 12, -0.03), (-12, 12, -0.03)]
    ground = create_mesh_object("StudioGround_nocol", ground_vertices, [(0, 1, 2, 3)],
                                [bpy.data.materials["Studio ground"]], collection=collection)
    ground.location.z = 0.0
    ground["role"] = "presentation_only"

    cameras = {
        "front": add_camera(collection, "QA_Front", (0.0, -11.5, 2.55), (0.0, 0.0, 2.35), ortho=5.8),
        "quarter": add_camera(collection, "QA_Quarter", (8.0, -9.0, 3.0), (0.0, 0.0, 2.3), ortho=6.1),
        "side": add_camera(collection, "QA_Side", (11.5, 0.0, 2.55), (0.0, 0.0, 2.35), ortho=5.8),
        "back": add_camera(collection, "QA_Back", (0.0, 11.5, 2.55), (0.0, 0.0, 2.35), ortho=5.8),
        "game": add_camera(collection, "QA_GameCamera", (0.0, -10.0, 3.0), (0.15, -0.1, 3.85), ortho=3.45),
        "bloom": add_camera(collection, "QA_BloomClose", HEAD_CENTER + HEAD_NORMAL * 3.5,
                            HEAD_CENTER, ortho=3.15),
    }
    add_area_light(collection, "Key | warm", (-4.5, -5.5, 8.5), (0, 0, 2.5), 570, 5.0, (1.0, 0.83, 0.58))
    add_area_light(collection, "Fill | cool", (5.0, -3.0, 4.5), (0, 0, 2.6), 300, 4.0, (0.63, 0.78, 1.0))
    add_area_light(collection, "Rim | soft", (1.5, 4.5, 6.5), (0, 0, 2.9), 700, 3.5, (1.0, 0.92, 0.72))
    add_area_light(collection, "Low fill", (-4.0, 2.0, 2.4), (0, 0, 2.0), 180, 3.0, (0.72, 0.88, 0.62))
    scene.camera = cameras["front"]
    return cameras


def render_previews(scene, cameras):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    for view in ("front", "quarter", "side", "back", "bloom", "game"):
        scene.camera = cameras[view]
        scene.render.filepath = str(PREVIEW_DIR / ("sunflower_" + view + ".png"))
        bpy.ops.render.render(write_still=True)
        print("rendered", scene.render.filepath)


def export_glb(scene, collection):
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    asset_objects = [obj for obj in collection.objects if obj.type == "MESH"]
    for obj in asset_objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    if not asset_objects:
        raise RuntimeError("no sunflower asset meshes were created")
    bpy.context.view_layer.objects.active = asset_objects[0]
    scene.frame_set(1)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=False,
    )


def read_glb_json(path):
    data = path.read_bytes()
    if data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise RuntimeError("invalid GLB header")
    json_size, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A:
        raise RuntimeError("the GLB JSON chunk is missing")
    return json.loads(data[20:20 + json_size].decode("utf-8").rstrip(" \t\r\n\0")), data


def validate_glb(path):
    document, data = read_glb_json(path)
    nodes = document.get("nodes", [])
    kernels = [node for node in nodes if node.get("extras", {}).get("role") == "shootable_kernel"]
    indices = [node.get("extras", {}).get("kernel_index") for node in kernels]
    if len(kernels) != KERNEL_COUNT or len(set(indices)) != KERNEL_COUNT:
        raise RuntimeError("shootable kernel identity count or uniqueness validation failed")
    if any(node.get("mesh") is None for node in kernels):
        raise RuntimeError("a shootable kernel exported without real mesh geometry")
    if document.get("animations"):
        raise RuntimeError("the sunflower must not autoplay a kernel release animation")
    head = next((node for node in nodes
                 if node.get("extras", {}).get("role") == "shootable_sunflower_head"), None)
    if not head or head.get("mesh") is None:
        raise RuntimeError("shootable head bounds node is missing")
    triangles = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor_index = primitive.get("indices")
            if accessor_index is None:
                continue
            triangles += document["accessors"][accessor_index]["count"] // 3
    stats = {
        "glb_bytes": len(data),
        "nodes": len(nodes),
        "kernels": len(kernels),
        "meshes": len(document.get("meshes", [])),
        "triangles": triangles,
        "materials": len(document.get("materials", [])),
        "textures": len(document.get("textures", [])),
        "animations": len(document.get("animations", [])),
    }
    print("SUNFLOWER_GLB_METRICS=" + json.dumps(stats, sort_keys=True))
    return document


def main():
    random.seed(SEED)
    rng = random.Random(SEED)
    scene, asset_collection, studio_collection = reset_scene()
    mats = create_materials()
    basis = make_head_basis()

    build_stem_and_hairs(asset_collection, mats, rng)
    build_leaves(asset_collection, mats, rng)
    build_head_receptacle(asset_collection, mats, basis)
    positions = build_kernels(asset_collection, mats, basis, rng)
    build_kernel_sockets(asset_collection, mats, basis, positions)
    build_ray_florets(asset_collection, mats, basis, rng)
    build_phyllaries(asset_collection, mats, basis, rng)
    build_disc_floret_collar(asset_collection, mats, basis)
    cameras = build_studio(scene, studio_collection)

    if abs(PLANT_HEIGHT - 4.8) > 0.001 or len(positions) != KERNEL_COUNT:
        raise RuntimeError("plant parameter validation failed")
    ids = [obj["kernel_index"] for obj in asset_collection.objects
           if obj.get("role") == "shootable_kernel"]
    if len(ids) != KERNEL_COUNT or len(set(ids)) != KERNEL_COUNT:
        raise RuntimeError("Blender kernel IDs are not unique")

    render_previews(scene, cameras)
    export_glb(scene, asset_collection)
    validate_glb(GLB_PATH)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print("saved", BLEND_PATH)


if __name__ == "__main__":
    main()

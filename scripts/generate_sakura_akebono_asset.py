#!/usr/bin/env python3
"""Generate a deterministic, editable Akebono flowering cherry tree for Blender 4.2.

Run from the repository root:
    blender --background --factory-startup --python-exit-code 1 --python scripts/generate_sakura_akebono_asset.py

The tree geometry is generated from an explicit leader/scaffold hierarchy. Flower organs,
lenticels, and foliage are consolidated into a handful of material-bound meshes.
"""

from __future__ import annotations

from math import cos, pi, sin, sqrt
from pathlib import Path
import json
import os
import random

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "assets" / "models" / "sakura_akebono"
PREVIEWS = ASSET / "previews"
SEED = 270425
BLOOM_SEED = 811907
GOLDEN = pi * (3.0 - sqrt(5.0))
HEIGHT_TARGET = 9.8
WIDTH_TARGET = 10.2
BLOOM_PREVIEW_SAMPLE = None
PREVIEW_ONLY = os.environ.get("SAKURA_AKEBONO_PREVIEW_ONLY") == "1"
SKIP_PREVIEW_RENDER = os.environ.get("SAKURA_AKEBONO_SKIP_PREVIEWS") == "1"


def material(name, color, roughness=0.8, subsurface=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = subsurface
    m["finish"] = "matte"
    return m


def new_mesh_obj(name, verts, faces, mats, indices=None, collection=None):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    for m in mats:
        mesh.materials.append(m)
    if indices:
        for poly, index in zip(mesh.polygons, indices):
            poly.material_index = index
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def curve_mesh(name, branches, mat, collection, bevel_res=2):
    curve = bpy.data.curves.new(name + "Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = 1
    curve.bevel_resolution = bevel_res
    curve.use_fill_caps = True
    for points, radii in branches:
        spline = curve.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for i, (p, r) in enumerate(zip(points, radii)):
            bp = spline.bezier_points[i]
            bp.co = p
            bp.radius = r
            bp.handle_left_type = "AUTO"
            bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj["role"] = "wood"
    return obj


def make_materials():
    bark = material("Akebono | silver-grey bark", (0.30, 0.285, 0.27), 0.91)
    bark_dark = material("Akebono | lenticels", (0.16, 0.135, 0.12), 0.97)
    petal = material("Akebono | petals, blush to ivory", (0.96, 0.61, 0.68), 0.78, 0.08)
    petal_light = material("Akebono | petal highlights", (0.99, 0.83, 0.81), 0.76, 0.07)
    sepal = material("Akebono | calyx and young growth", (0.24, 0.37, 0.19), 0.86)
    gold = material("Akebono | stamens", (0.86, 0.59, 0.20), 0.66)
    leaf = material("Akebono | sparse spring leaves", (0.39, 0.51, 0.25), 0.78, 0.03)
    # Procedural detail is retained in the editable scene; GLB exporters carry the base tint.
    nodes, links = bark.node_tree.nodes, bark.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.2
    noise.inputs["Detail"].default_value = 4.0
    noise.inputs["Roughness"].default_value = 0.72
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.055
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return {"bark": bark, "dark": bark_dark, "petal": petal, "light": petal_light,
            "sepal": sepal, "gold": gold, "leaf": leaf}


def add_surface(vertices, faces, material_indices, points, new_faces, material_index):
    base = len(vertices)
    vertices.extend(points)
    faces.extend(tuple(base + i for i in face) for face in new_faces)
    material_indices.extend([material_index] * len(new_faces))


def blossom_geometry(rng, sites, scale, mats, collection, profile):
    global BLOOM_PREVIEW_SAMPLE
    petals_v, petals_f, petals_i = [], [], []
    centers_v, centers_f, centers_i = [], [], []
    foliage_v, foliage_f = [], []

    def basis(normal):
        n = Vector(normal).normalized()
        u = n.cross(Vector((0, 0, 1)))
        if u.length < 0.01:
            u = n.cross(Vector((0, 1, 0)))
        u.normalize()
        return u, n.cross(u).normalized(), n

    flower_count = 0
    for site in sites:
        pos, direction, branch_order = site[:3]
        dense_cluster = len(site) > 3 and site[3]
        # Most terminal groups have 3-5 flowers; a few unopened buds and young leaves
        # reflect full bloom's short overlap with early foliage.
        if dense_cluster:
            bloom_count = rng.randint(10, 13) if profile == "hero" else rng.randint(7, 9) if profile == "lod1" else rng.randint(5, 7)
        else:
            bloom_count = rng.randint(3, 5) if profile == "hero" else rng.randint(3, 4) if profile == "lod1" else 3
        u, v, n = basis(direction)
        # Keep added flowers close to the twig-borne anchor: longer pedicels read as
        # straight green spokes in the macro view. Hero retains the fullest spray;
        # lower LODs keep its volume while reducing the number of flower heads.
        spread = (rng.uniform(.12, .16) if profile == "hero" else
                  rng.uniform(.11, .145) if profile == "lod1" else
                  rng.uniform(.095, .13)) if dense_cluster else .048
        center = Vector(pos)
        for j in range(bloom_count):
            az = GOLDEN * (j + rng.random() * 0.25)
            if dense_cluster:
                # A true 3D spray around its branch anchor, with bounded spherical radius.
                z = rng.uniform(-0.58, 0.78)
                radial = sqrt(max(0.0, 1.0 - z * z)) * spread * rng.uniform(.48, 1.0)
                azimuth = rng.uniform(0, 2 * pi)
                offset = u * (cos(azimuth) * radial) + v * (sin(azimuth) * radial) + n * (z * spread)
                c = center + offset
                outward = Vector(offset).normalized() if offset.length > 1e-5 else n
                axis = (outward * .52 + Vector((0, 0, .34)) +
                        u * rng.uniform(-.30, .30) + v * rng.uniform(-.30, .30)).normalized()
            else:
                offset = u * (cos(az) * spread) + v * (sin(az) * spread)
                c = center + offset + n * (rng.uniform(-0.015, 0.025) * scale)
                axis = (n + u * rng.uniform(-0.18, 0.18) + v * rng.uniform(-0.18, 0.18)).normalized()
            if BLOOM_PREVIEW_SAMPLE is None:
                BLOOM_PREVIEW_SAMPLE = (c.copy(), axis.copy())
            bu, bv, bn = basis(axis)
            radius = (rng.uniform(.037, .046) if dense_cluster else
                      rng.uniform(0.032, 0.043)) * scale
            # A slim, tapered pedicel connects every flower back to its twig-borne cluster site.
            stem_axis = c - center
            if stem_axis.length > 0.004:
                stem_axis.normalize()
                stem_side = stem_axis.cross(Vector((0, 0, 1)))
                if stem_side.length < .03:
                    stem_side = stem_axis.cross(Vector((0, 1, 0)))
                stem_side.normalize()
                stem_other = stem_axis.cross(stem_side).normalized()
                stem_end = c - bn * radius * .20
                stem_base = len(centers_v)
                for stem_center, stem_radius in ((center, .0018 * scale), (stem_end, .0010 * scale)):
                    for side_idx in range(4):
                        theta = side_idx * pi / 2
                        centers_v.append(stem_center + (stem_side * cos(theta) + stem_other * sin(theta)) * stem_radius)
                for side_idx in range(4):
                    nxt = (side_idx + 1) % 4
                    centers_f.append((stem_base + side_idx, stem_base + nxt,
                                      stem_base + 4 + nxt, stem_base + 4 + side_idx))
                    centers_i.append(0)
            # Five cupped petals with rounded shoulders and a heart-shaped tip notch.
            for k in range(5):
                angle = 2 * pi * k / 5 + rng.uniform(-0.07, 0.07)
                radial = bu * cos(angle) + bv * sin(angle)
                tangent = -bu * sin(angle) + bv * cos(angle)
                outline = [
                    radial * (radius * 0.10) - tangent * radius * 0.20,
                    radial * (radius * 0.25) - tangent * radius * 0.32,
                    radial * (radius * 0.45) - tangent * radius * 0.43,
                    radial * (radius * 0.68) - tangent * radius * 0.47,
                    radial * (radius * 0.86) - tangent * radius * 0.42,
                    radial * (radius * 0.99) - tangent * radius * 0.27,
                    radial * (radius * 1.03) - tangent * radius * 0.13,
                    radial * (radius * 0.89),
                    radial * (radius * 1.03) + tangent * radius * 0.13,
                    radial * (radius * 0.99) + tangent * radius * 0.27,
                    radial * (radius * 0.86) + tangent * radius * 0.42,
                    radial * (radius * 0.68) + tangent * radius * 0.47,
                    radial * (radius * 0.45) + tangent * radius * 0.43,
                    radial * (radius * 0.25) + tangent * radius * 0.32,
                    radial * (radius * 0.10) + tangent * radius * 0.20,
                ]
                rim_height = (0, 0.001, 0.003, 0.006, 0.010, 0.013, 0.014,
                              0.010, 0.014, 0.013, 0.010, 0.006, 0.003, 0.001, 0)
                if profile == "hero":
                    local = [c + q + bn * (rim_height[idx] * scale) for idx, q in enumerate(outline)]
                    local.append(c + radial * radius * 0.32 + bn * 0.001 * scale)
                    local.append(c + radial * radius * 0.55 - bn * 0.006 * scale)
                    faces = [(15, idx, (idx + 1) % 15) for idx in (*range(3), *range(11, 15))]
                    faces.extend(((15, 3, 16), (15, 16, 11)))
                    faces.extend((16, idx, idx + 1) for idx in range(3, 11))
                else:
                    sample_ids = ((0, 2, 4, 6, 7, 8, 10, 12, 14) if profile == "lod1"
                                  else (0, 3, 6, 7, 9, 12, 14))
                    low_outline = [outline[idx] for idx in sample_ids]
                    low_height = [rim_height[idx] for idx in sample_ids]
                    local = [c + q + bn * (low_height[idx] * scale)
                             for idx, q in enumerate(low_outline)]
                    local.append(c + radial * radius * 0.32 + bn * 0.001 * scale)
                    faces = [(len(low_outline), idx, (idx + 1) % len(low_outline))
                             for idx in range(len(low_outline))]
                add_surface(petals_v, petals_f, petals_i, local, faces,
                            rng.choices((0, 1), (0.66, 0.34))[0])
            # One calyx per blossom, beneath the five petals.
            for s in range(5):
                a0, a1 = 2 * pi * s / 5, 2 * pi * (s + 1) / 5
                ring = []
                for a, h, rr in ((a0, -0.13, 0.075), (a1, -0.13, 0.075),
                                 (a1, -0.02, 0.12), (a0, -0.02, 0.12)):
                    centers_v.append(c + bu * cos(a) * radius * rr + bv * sin(a) * radius * rr + bn * radius * h)
                    ring.append(len(centers_v) - 1)
                centers_f.append(tuple(ring))
                centers_i.append(0)
            # Central receptacle as a small faceted disc.
            center_base = len(centers_v)
            centers_v.append(c + bn * 0.004)
            for s in range(6):
                a = 2 * pi * s / 6
                centers_v.append(c + bu * cos(a) * radius * 0.17 + bv * sin(a) * radius * 0.17 + bn * 0.006)
            for s in range(6):
                centers_f.append((center_base, center_base + 1 + s, center_base + 1 + (s + 1) % 6))
                centers_i.append(0)
            # Stamens as fine crossed triangles radiating over the petal cup.
            stamen_count = 8 if profile == "hero" else 4 if profile == "lod1" else 3
            for s in range(stamen_count):
                a = 2 * pi * s / stamen_count
                axis2 = bu * cos(a) + bv * sin(a)
                tip = c + bn * radius * 0.45 + axis2 * radius * 0.17
                base = len(centers_v)
                centers_v.extend((c + axis2 * radius * 0.035,
                                  c + bn * radius * 0.22 + axis2 * radius * 0.055,
                                  tip))
                centers_f.append((base, base + 1, base + 2))
                centers_i.append(1)
            flower_count += 1
        # Sparse, early spring leaves only on the more vigorous outer tips.
        if profile == "hero" and branch_order <= 3 and rng.random() < 0.23:
            for _ in range(rng.randint(1, 2)):
                a = rng.uniform(0, 2 * pi)
                axis = (u * cos(a) + v * sin(a) + n * 0.38).normalized()
                side = axis.cross(n).normalized() * 0.018
                tip = center + axis * 0.075
                base = len(foliage_v)
                foliage_v.extend((center, center + side, tip, center - side))
                foliage_f.extend(((base, base + 1, base + 2), (base, base + 2, base + 3)))

    petal_obj = new_mesh_obj("Akebono_Petals_Consolidated", petals_v, petals_f,
                             (mats["petal"], mats["light"]), petals_i, collection)
    petal_obj["role"] = "blossoms"
    # split centers into calyx/gold by polygon index, preserving consolidated batches
    center_obj = new_mesh_obj("Akebono_Calyx_and_Stamens", centers_v, centers_f,
                              (mats["sepal"], mats["gold"]), centers_i, collection)
    center_obj["role"] = "blossom_details"
    leaf_obj = new_mesh_obj("Akebono_Sparse_Young_Leaves", foliage_v, foliage_f,
                            (mats["leaf"],), collection=collection)
    leaf_obj["role"] = "foliage"
    return flower_count, petal_obj, center_obj, leaf_obj


def add_lenticels(rng, trunk_samples, mat, collection):
    verts, faces = [], []
    # Short, mostly horizontal lens marks that wrap only partially around the smooth young bark.
    for z in [0.55 + i * 0.052 for i in range(76)]:
        if z > 4.45:
            continue
        x = 0.02 * sin(z * 0.9)
        y = 0.015 * cos(z * 0.7)
        trunk_r = max(0.115, 0.34 * (1 - z / 7.9) ** 0.83)
        count = rng.randint(2, 5)
        for _ in range(count):
            a = rng.uniform(0, 2 * pi)
            length = rng.uniform(0.018, 0.047) * max(0.42, 1 - z / 5.5)
            height = rng.uniform(0.0035, 0.008)
            center = Vector((x + cos(a) * (trunk_r + 0.002), y + sin(a) * (trunk_r + 0.002), z + rng.uniform(-0.024, 0.024)))
            tangent = Vector((-sin(a), cos(a), 0))
            up = Vector((0, 0, 1))
            base = len(verts)
            verts.extend((center - tangent * length / 2,
                          center + tangent * length / 2 + up * height,
                          center + tangent * length / 2 - up * height,
                          center - tangent * length / 2 + up * height))
            faces.extend(((base, base + 1, base + 2), (base, base + 3, base + 1)))
    obj = new_mesh_obj("Akebono_Horizontal_Lenticels", verts, faces, (mat,), collection=collection)
    obj["role"] = "bark_detail"
    return obj


def make_tree(profile="hero"):
    global BLOOM_PREVIEW_SAMPLE
    BLOOM_PREVIEW_SAMPLE = None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.context.preferences.filepaths.save_version = 0
    scene["asset"] = "Prunus x yedoensis 'Akebono'"
    scene["generator"] = "scripts/generate_sakura_akebono_asset.py"
    scene["seed"] = SEED
    scene["bloom_seed"] = BLOOM_SEED
    scene["profile"] = profile
    tree = bpy.data.collections.new("SakuraAkebono_Render")
    collision = bpy.data.collections.new("SakuraAkebono_Collision")
    presentation = bpy.data.collections.new("Presentation_Studio")
    scene.collection.children.link(tree)
    scene.collection.children.link(collision)
    scene.collection.children.link(presentation)
    rng = random.Random(SEED)
    bloom_site_rng = random.Random(BLOOM_SEED)
    mats = make_materials()

    # Branch paths are grouped by order, then converted once per order to bound object count.
    splines = [[] for _ in range(5)]
    flower_sites = []
    extra_flower_sites = []
    dense_flower_sites = []
    branch_counts = [0, 0, 0, 0, 0]
    radius_scale = {"hero": 1.0, "lod1": 0.95, "lod2": 0.90, "collision": 1.0}[profile]
    child_factor = {"hero": 1.0, "lod1": 1.0, "lod2": 1.0, "collision": 0.0}[profile]
    # LODs thin the bloom footprint before mesh consolidation; geometry density is
    # intentionally budgeted per profile instead of carrying nearly all Hero flowers.
    flower_scale = {"hero": 1.0, "lod1": 0.13, "lod2": 0.07, "collision": 0.0}[profile]
    dense_site_count = {"hero": (2, 4), "lod1": (1, 2), "lod2": (0, 1), "collision": (0, 0)}[profile]

    def spline(points, radii, order):
        branch_counts[order] += 1
        splines[order].append((points, radii))

    def path_points(start, direction, length, order):
        d = Vector(direction).normalized()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 0.04:
            side = d.cross(Vector((0, 1, 0)))
        side.normalize()
        bend = rng.uniform(-0.07, 0.07) * length
        sag = (0.025 + order * 0.012) * length
        pts = []
        for t in (0, 0.25, 0.5, 0.75, 1):
            q = Vector(start) + d * length * t + side * sin(pi * t) * bend
            q.z += 0.11 * length * t * t - sag * sin(pi * t)
            # A softly ellipsoidal envelope keeps the outer canopy broad and rounded.
            crown_center_z = 6.45
            limit = max(0.5, 5.15 * sqrt(max(0.02, 1 - ((q.z - crown_center_z) / 3.55) ** 2)))
            radial = sqrt(q.x * q.x + q.y * q.y)
            if radial > limit:
                q.x *= limit / radial
                q.y *= limit / radial
            pts.append(q)
        return pts

    def terminal(point, direction, order):
        if profile == "collision":
            return
        # 1-2 cluster sites per fine twig, positioned just behind the visible tip.
        p = Vector(point)
        d = Vector(direction).normalized()
        flower_sites.append((p - d * rng.uniform(0.025, 0.12), d + Vector((0, 0, 0.45)), order))
        if order >= 3 and rng.random() < 0.45:
            flower_sites.append((p - d * rng.uniform(0.12, 0.21), d + Vector((0, 0, 0.35)), order))

    def branch(start, direction, length, radius, order, parent_azimuth=0.0, allow_blooms=True):
        if order > 4 or radius < 0.007 or length < 0.12:
            if allow_blooms:
                terminal(start, direction, order)
            return
        pts = path_points(start, direction, length, order)
        taper = (0.27 if order == 0 else 0.40 if order == 1 else 0.44 if order == 2 else 0.46)
        radii = [radius * (1 - t * (1 - taper)) ** 1.12 for t in (0, .25, .5, .75, 1)]
        spline(pts, radii, order)
        axis = (pts[-1] - pts[-2]).normalized()
        # Akebono flowers form on short spurs distributed along young outer twigs,
        # not only at the very end of a branch. Keep clusters tied to this hierarchy.
        if allow_blooms and order >= 2:
            fractions = (0.68,) if order == 2 else (0.36, 0.70) if order == 3 else (0.27, 0.52, 0.77)
            for frac in fractions:
                segment = min(3, int(frac * 4))
                local = frac * 4 - segment
                site_pos = pts[segment].lerp(pts[segment + 1], local)
                tangent = (pts[segment + 1] - pts[segment]).normalized()
                side = tangent.cross(Vector((0, 0, 1)))
                if side.length < .03:
                    side = tangent.cross(Vector((0, 1, 0)))
                side.normalize()
                site_pos += side * rng.uniform(-.04, .04) + Vector((0, 0, rng.uniform(.015, .055)))
                flower_sites.append((site_pos, tangent + Vector((0, 0, .42)), order))
            if profile != "collision" and order in (3, 4):
                # Fill outer and inner crown gaps without consuming growth RNG or LOD budget.
                for frac in ((.17, .45, .87) if order == 3 else (.14, .40, .65)):
                    segment = min(3, int(frac * 4))
                    site_pos = pts[segment].lerp(pts[segment + 1], frac * 4 - segment)
                    tangent = (pts[segment + 1] - pts[segment]).normalized()
                    side = tangent.cross(Vector((0, 0, 1)))
                    if side.length < .03:
                        side = tangent.cross(Vector((0, 1, 0)))
                    side.normalize()
                    stagger = .055 if len(extra_flower_sites) % 2 else -.055
                    spur = site_pos + side * stagger + Vector((0, 0, .035))
                    extra_flower_sites.append((spur, tangent + Vector((0, 0, .42)), order))
            # A second, independent stream distributes short flower-bearing spurs along
            # tertiary and fine twigs. Each attachment starts at the real branch surface.
            if profile != "collision" and order in (3, 4):
                count = dense_site_count[0] if order == 3 else dense_site_count[1]
                for site_index in range(count):
                    frac = (site_index + .5 + bloom_site_rng.uniform(-.22, .22)) / count
                    segment = min(3, int(frac * 4))
                    site_pos = pts[segment].lerp(pts[segment + 1], frac * 4 - segment)
                    tangent = (pts[segment + 1] - pts[segment]).normalized()
                    side = tangent.cross(Vector((0, 0, 1)))
                    if side.length < .03:
                        side = tangent.cross(Vector((0, 1, 0)))
                    side.normalize()
                    local_radius = radius * (1 - frac * (1 - taper)) ** 1.12
                    side_sign = -1 if bloom_site_rng.random() < .5 else 1
                    anchor = site_pos + side * (side_sign * local_radius * .82)
                    anchor += Vector((0, 0, local_radius * bloom_site_rng.uniform(.12, .36)))
                    dense_flower_sites.append((anchor, tangent + Vector((0, 0, .42)), order, True))
        if order >= 4:
            if allow_blooms:
                terminal(pts[-1], axis, order)
            return
        # Child sites are staggered around the parent; fewer interior shoots preserve open forks.
        child_n = (3 if order == 1 else 2 if order == 2 else 2)
        if rng.random() > child_factor:
            if allow_blooms:
                terminal(pts[-1], axis, order + 1)
            return
        if order == 1:
            fractions = (0.30, 0.54, 0.77, 0.94)
        else:
            fractions = (0.43, 0.76, 0.96)
        for idx, frac in enumerate(fractions):
            pos = pts[1].lerp(pts[3], max(0, min(1, (frac - .25) / .5))) if frac <= .75 else pts[3].lerp(pts[4], (frac - .75) / .25)
            angle = parent_azimuth + GOLDEN * (idx + order * 0.51) + rng.uniform(-0.32, 0.32)
            outward = Vector((cos(angle), sin(angle), rng.uniform(0.2, 0.55)))
            spread = 0.58 if order == 1 else 0.70 if order == 2 else 0.90
            child_dir = (axis * (1 - spread) + outward * spread + Vector((0, 0, 0.10))).normalized()
            child_len = length * rng.uniform(0.40, 0.57)
            child_rad = radius * rng.uniform(0.41, 0.56)
            branch(pos, child_dir, child_len, child_rad, order + 1, angle, allow_blooms)
        # One leader continuation on each scaffold carries the crown outward/upward.
        if order == 1:
            child_dir = (axis * 0.78 + Vector((0, 0, 0.62))).normalized()
            branch(pts[-1], child_dir, length * 0.60, radius * 0.52, order + 1, parent_azimuth, allow_blooms)

    # Root flare and gently irregular main trunk, with a true continuing leader.
    trunk = [((0.0, 0.0, 0.02), 0.48), ((0.025, -0.02, 0.65), 0.39),
             ((-0.04, 0.035, 1.55), 0.31), ((0.025, 0.07, 2.6), 0.245),
             ((-0.015, 0.10, 3.65), 0.19), ((0.035, 0.06, 4.75), 0.145),
             ((0.0, 0.0, 5.85), 0.10), ((0.04, -0.025, 6.75), 0.073)]
    spline([Vector(p) for p, _ in trunk], [r * radius_scale for _, r in trunk], 0)
    leader = [(Vector((0.04, -0.025, 6.68)), 0.077), (Vector((0.08, 0.04, 7.65)), 0.058),
              (Vector((-0.035, 0.01, 8.52)), 0.039), (Vector((0.08, 0.08, 9.25)), 0.021),
              (Vector((0.10, 0.08, 9.78)), 0.009)]
    spline([p for p, _ in leader], [r * radius_scale for _, r in leader], 1)
    # Five mature scaffolds emerge at varied heights and occupy distinct 3D sectors.
    for i in range(5):
        az = 2 * pi * i / 5 + rng.uniform(-0.18, 0.18)
        z = 3.25 + i * 0.40 + rng.uniform(-0.11, 0.11)
        origin = Vector((0.01 * sin(i), 0.02 * cos(i), z))
        d = Vector((cos(az), sin(az), rng.uniform(0.16, 0.38))).normalized()
        branch(origin, d, rng.uniform(3.4, 4.35), rng.uniform(0.17, 0.205) * radius_scale, 1, az)
    # Leader's upper shoots create crown fullness without a hard topiary cap.
    for i, z in enumerate((7.25, 7.85, 8.4, 8.85)):
        az = i * GOLDEN
        branch(Vector((0.03, 0.02, z)), Vector((cos(az), sin(az), 0.42)), 1.35 - i * .10,
                .052 * radius_scale, 2, az)
    flower_sites.extend(extra_flower_sites)
    flower_sites.extend(dense_flower_sites)

    # A handful of spreading, partly buried surface roots give the trunk a planted transition.
    if profile != "collision":
        for i in range(8):
            az = 2 * pi * i / 8 + rng.uniform(-0.3, 0.3)
            d = Vector((cos(az), sin(az), -0.05))
            branch(Vector((0, 0, .25)), d, rng.uniform(.75, 1.35), rng.uniform(.055, .085), 1, az, False)

    wood = []
    for order, group in enumerate(splines):
        if not group:
            continue
        if profile == "collision" and order >= 2:
            continue
        bevel = 0 if order <= 1 or profile in ("lod1", "lod2", "collision") else 1
        name = ("Trunk_and_Scaffolds" if order <= 1 else f"Branch_Order_{order}")
        obj = curve_mesh("Akebono_" + name, group, mats["bark"], tree, bevel_res=bevel)
        wood.append(obj)

    # Add a few visible lenticels to the trunk; use the same coarse proxy for collision.
    lenticels = add_lenticels(rng, trunk, mats["dark"], tree if profile != "collision" else collision) if profile != "lod2" and profile != "collision" else None
    flower_count = 0
    if flower_scale:
        # Distant LODs sparsify by deterministic selection instead of shrinking each organ.
        if profile != "hero":
            keep = {id(site) for site in flower_sites if rng.random() < flower_scale}
            flower_sites = [s for s in flower_sites if id(s) in keep]
        blossom_rng = random.Random(BLOOM_SEED + 29)
        flower_count, petals, details, leaves = blossom_geometry(
            blossom_rng, flower_sites, 1.0, mats, tree, profile)

    # Distinct, low-poly collision representation containing trunk plus five scaffolds only.
    if profile == "collision":
        for obj in list(tree.objects):
            tree.objects.unlink(obj)
            collision.objects.link(obj)
        for obj in collision.objects:
            obj["role"] = "collision"

    return scene, tree, collision, presentation, mats, branch_counts, flower_count


def point_bounds(objects):
    coords = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            coords.append(obj.matrix_world @ v.co)
    if not coords:
        return {"min": [0, 0, 0], "max": [0, 0, 0], "size": [0, 0, 0]}
    lo = [min(v[i] for v in coords) for i in range(3)]
    hi = [max(v[i] for v in coords) for i in range(3)]
    return {"min": [round(v, 4) for v in lo], "max": [round(v, 4) for v in hi],
            "size": [round(hi[i] - lo[i], 4) for i in range(3)]}


def stats(objects):
    meshes = [o for o in objects if o.type == "MESH"]
    tris = sum(sum(max(0, len(p.vertices) - 2) for p in o.data.polygons) for o in meshes)
    return {"objects": len(meshes), "vertices": sum(len(o.data.vertices) for o in meshes),
            "triangles": tris, "bounds_m": point_bounds(meshes),
            "materials": sorted({m.name for o in meshes for m in o.data.materials if m})}


def studio(scene, collection):
    world = bpy.data.worlds.new("Akebono_StudioWorld")
    world.use_nodes = True
    world.node_tree.nodes.get("Background").inputs["Color"].default_value = (.22, .28, .34, 1)
    world.node_tree.nodes.get("Background").inputs["Strength"].default_value = .35
    scene.world = world
    groundmat = material("Studio | warm grey", (.27, .29, .31), .82)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.03))
    ground = bpy.context.object
    ground.name = "Studio_Ground"
    ground.data.materials.append(groundmat)
    for c in list(ground.users_collection): c.objects.unlink(ground)
    collection.objects.link(ground)
    ground.hide_viewport = True
    ground.hide_render = True
    def area(name, loc, energy, size, color):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size = energy, "DISK", size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 5)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    area("Key_Softbox", (7, -10, 13), 1700, 8, (1.0, .83, .72))
    area("Fill_Softbox", (-9, -2, 8), 1150, 7, (.73, .83, 1.0))
    area("Rim_Softbox", (2, 8, 11), 2000, 6, (1.0, .72, .78))


def camera(scene, collection, name, location, target, ortho=12.6, lens=55):
    data = bpy.data.cameras.new(name)
    data.type = "ORTHO"
    data.ortho_scale = ortho
    data.lens = lens
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def render_previews(scene, tree, presentation):
    studio(scene, presentation)
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    center = (0, 0, 4.95)
    for index in range(8):
        az = 2 * pi * index / 8
        cam = camera(scene, presentation, f"Camera_Azimuth_{index * 45:03d}",
                     (18 * cos(az), 18 * sin(az), 6.3), center)
        scene.camera = cam
        scene.render.filepath = str(PREVIEWS / f"azimuth_{index * 45:03d}.png")
        bpy.ops.render.render(write_still=True)
    # Macro view of actual grouped blossom geometry, and a grazing-light bark close-up.
    petals = bpy.data.objects.get("Akebono_Petals_Consolidated")
    if petals and BLOOM_PREVIEW_SAMPLE is not None:
        flower, site_axis = BLOOM_PREVIEW_SAMPLE
        cam = camera(scene, presentation, "Camera_Blossom_Macro", flower + site_axis * .75, flower, .46, 75)
        scene.camera = cam
        scene.render.resolution_x = scene.render.resolution_y = 900
        scene.render.filepath = str(PREVIEWS / "macro_blossom.png")
        wood_objects = [o for o in tree.objects if o.get("role") == "wood"]
        for o in wood_objects: o.hide_render = True
        bpy.ops.render.render(write_still=True)
        for o in wood_objects: o.hide_render = False
    bark_target = Vector((.15, -.34, 2.2))
    cam = camera(scene, presentation, "Camera_Bark_Macro", bark_target + Vector((.74, -1.2, .55)), bark_target, 1.15, 75)
    scene.camera = cam
    scene.render.filepath = str(PREVIEWS / "macro_bark.png")
    for o in tree.objects:
        if o.name.startswith(("Akebono_Petals", "Akebono_Calyx", "Akebono_Sparse")):
            o.hide_render = True
    bpy.ops.render.render(write_still=True)
    for o in tree.objects:
        o.hide_render = False


def export_glb(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        if obj.type == "MESH": obj.select_set(True)
    bpy.context.view_layer.objects.active = next((o for o in objects if o.type == "MESH"), None)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)


def build_scene(profile, save_blend=False, render=False):
    scene, tree, collision, presentation, mats, branches, flowers = make_tree(profile)
    tree_objects = list(tree.objects)
    collision_objects = list(collision.objects)
    metrics = stats(tree_objects if profile != "collision" else collision_objects)
    metrics["profile"] = profile
    metrics["seed"] = SEED
    metrics["branch_counts_by_order"] = branches
    metrics["flower_count"] = flowers
    if profile == "hero":
        if render:
            if SKIP_PREVIEW_RENDER:
                studio(scene, presentation)
                azimuth_cameras = []
                for index in range(8):
                    az = 2 * pi * index / 8
                    azimuth_cameras.append(camera(
                        scene, presentation, f"Camera_Azimuth_{index * 45:03d}",
                        (18 * cos(az), 18 * sin(az), 6.3), (0, 0, 4.95)))
                if BLOOM_PREVIEW_SAMPLE is not None:
                    flower, site_axis = BLOOM_PREVIEW_SAMPLE
                    camera(scene, presentation, "Camera_Blossom_Macro",
                           flower + site_axis * .75, flower, .46, 75)
                bark_target = Vector((.15, -.34, 2.2))
                camera(scene, presentation, "Camera_Bark_Macro",
                       bark_target + Vector((.74, -1.2, .55)), bark_target, 1.15, 75)
                scene.camera = azimuth_cameras[0]
            else:
                render_previews(scene, tree, presentation)
        if save_blend:
            scene.camera = bpy.data.objects.get("Camera_Azimuth_000")
            bpy.ops.wm.save_as_mainfile(filepath=str(ASSET / "sakura_akebono.blend"), check_existing=False)
    out = ASSET / ({"hero": "sakura_akebono.glb", "lod1": "sakura_akebono_lod1.glb",
                    "lod2": "sakura_akebono_lod2.glb", "collision": "sakura_akebono_collision.glb"}[profile])
    if not PREVIEW_ONLY:
        export_glb(collision_objects if profile == "collision" else tree_objects, out)
        metrics["file_bytes"] = out.stat().st_size
    return metrics


def main():
    ASSET.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    report = {"species": "Prunus × yedoensis 'Akebono'", "generator": "scripts/generate_sakura_akebono_asset.py",
              "blender": bpy.app.version_string, "seed": SEED, "target_dimensions_m": [WIDTH_TARGET, WIDTH_TARGET, HEIGHT_TARGET],
              "profiles": {}}
    profiles = ("hero",) if PREVIEW_ONLY else ("hero", "lod1", "lod2", "collision")
    for profile in profiles:
        print(f"[sakura] building {profile}", flush=True)
        report["profiles"][profile] = build_scene(
            profile, save_blend=(profile == "hero" and not PREVIEW_ONLY), render=(profile == "hero"))
    if PREVIEW_ONLY:
        print("[sakura] preview-only complete; existing blend and GLBs were preserved", flush=True)
        return
    report["files"] = {p.name: p.stat().st_size for p in sorted(ASSET.iterdir())
                       if p.is_file() and p.name != "qa_metrics.json"}
    (ASSET / "qa_metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()

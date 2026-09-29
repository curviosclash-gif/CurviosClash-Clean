"""PBR materials for the mercenary scout.

Stage 1 (this module as written) gives every part a correct Principled BSDF with
plausible factors, which is what the geometry review renders need. Stage 2 wires
the painted image maps into the same materials; the node graph is therefore built
by one function that the painter extends instead of a second material set.
"""

from __future__ import annotations

import bpy

from . import spec

#: Hand-picked albedo for the plain stage; the painted maps replace these later.
PALETTE = {
    "Skin": (0.62, 0.44, 0.34),
    "Hair": (0.075, 0.055, 0.042),
    #: The sclera has to sit clearly below skin brightness, otherwise the eye reads
    #: as one pale slit instead of an eyeball in a lid opening.
    "Eye": (0.58, 0.58, 0.60),
    "Jacket": (0.145, 0.160, 0.140),
    "Trousers": (0.085, 0.092, 0.105),
    "Leather": (0.070, 0.052, 0.042),
    "Metal": (0.62, 0.63, 0.66),
    "Accent": (0.520, 0.180, 0.062),
}

PREFIX = "merc_scout_"


def build_materials(variant: spec.Variant) -> dict[str, bpy.types.Material]:
    materials: dict[str, bpy.types.Material] = {}
    for material_spec in spec.MATERIALS:
        if material_spec.name not in variant.materials:
            continue
        material = bpy.data.materials.new(PREFIX + material_spec.name)
        material.use_nodes = True
        bsdf = material.node_tree.nodes["Principled BSDF"]
        colour = PALETTE[material_spec.name]
        bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
        bsdf.inputs["Metallic"].default_value = material_spec.metallic
        bsdf.inputs["Roughness"].default_value = material_spec.roughness
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.5
        material.diffuse_color = (*colour, 1.0)
        material["mercScoutNote"] = material_spec.note
        materials[material_spec.name] = material
    return materials


def material_of(obj: bpy.types.Object, materials: dict[str, bpy.types.Material],
                name: str) -> bpy.types.Object:
    """Append a material from the set, replacing whatever the object carried."""
    obj.data.materials.clear()
    obj.data.materials.append(materials[name])
    return obj


def slot_usage(objects: list[bpy.types.Object]) -> dict[str, set[str]]:
    """Which atlas slot each material is actually sampled with.

    A hand-maintained "regions per material" list drifts the moment geometry is
    added: the eyebrows asked for the brow slot in the hair atlas and the sleeve
    cuffs for the cuff slot in the leather atlas, and neither was ever painted.
    Both looked merely dark, because both materials are dark, so nobody noticed.
    The painter therefore fills the union of its own list and what the meshes
    really sample.
    """
    slots = {name: spec.region_uv(name) for name in spec.REGION_SLOTS}
    usage: dict[str, set[str]] = {}
    for obj in objects:
        uv_layer = obj.data.uv_layers.active
        if uv_layer is None:
            continue
        for polygon in obj.data.polygons:
            index = polygon.material_index
            if index >= len(obj.material_slots):
                continue
            material = obj.material_slots[index].material
            if material is None:
                continue
            name = material.name.replace(PREFIX, "")
            us = [uv_layer.data[loop].uv[0] for loop in polygon.loop_indices]
            vs = [uv_layer.data[loop].uv[1] for loop in polygon.loop_indices]
            centre_u = (min(us) + max(us)) * 0.5
            centre_v = (min(vs) + max(vs)) * 0.5
            for slot, (u0, v0, u1, v1) in slots.items():
                if u0 <= centre_u <= u1 and v0 <= centre_v <= v1:
                    usage.setdefault(name, set()).add(slot)
                    break
    return usage

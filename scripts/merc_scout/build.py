"""Orchestration: build a variant, rig it, export it, report the numbers.

The generator is the truth. Nothing here is meant to be edited by hand in
Blender afterwards: a rerun overwrites the ``.blend`` and the ``.glb``.
"""

from __future__ import annotations

from pathlib import Path

import bpy

from . import (animation, body, clothing, glb_post, materials as material_lib,
               mesh_utils as mu, painting, preview, rig as rigging, spec)

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "assets/models/characters/merc_scout"
TEXTURE_DIR = MODEL_DIR / "textures"
GENERATOR = "scripts/generate_merc_scout_character.py"


def variant_by_key(key: str) -> spec.Variant:
    for variant in spec.VARIANTS:
        if variant.key == key:
            return variant
    raise KeyError(f"unknown variant {key!r}")


def prepare_scene(variant: spec.Variant) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = spec.FPS
    scene.frame_start = 1
    scene.frame_end = max(animation.frames for animation in spec.ANIMATIONS)
    scene["generator"] = GENERATOR
    scene["product"] = "Mercenary Scout (Kestrel)"
    scene["variant"] = variant.key
    scene["licence"] = "royalty free, commercial use, no redistribution of the model"


def build_character(variant_key: str, *, do_actions: bool = True) -> dict:
    variant = variant_by_key(variant_key)
    prepare_scene(variant)
    material_set = material_lib.build_materials(variant)
    report: dict = {"variant": variant.key, "label": variant.label, "note": variant.note}

    deformable: list[bpy.types.Object] = [
        body.build_body(variant, material_set),
        body.build_head(material_set),
    ]
    deformable.extend(body.build_hair(material_set, variant.detail))
    deformable.extend(clothing.build_clothing(variant, material_set))
    rigid: list[tuple[bpy.types.Object, str]] = [
        (eye, "Head") for eye in body.build_eyes(material_set)
    ]

    rig = rigging.build_rig(variant)
    rigging.bind_auto(rig, deformable)
    for obj, bone in rigid:
        rigging.bind_rigid(rig, obj, bone)
    meshes = deformable + [obj for obj, _ in rigid]

    report["bones"] = len(rig.data.bones)
    report["mesh_count"] = len(meshes)
    report["mesh_names"] = sorted(obj.name for obj in meshes)
    report["vertices"] = {obj.name: len(obj.data.vertices) for obj in meshes}
    report["profile_body"] = body.profile_measurements(meshes, mesh_name=body.BODY)
    report["profile_clothed"] = body.profile_measurements(meshes)
    report["normalisation"] = body.normalise_to_contract(meshes, rig)
    rigging.limit_influences(meshes)
    report["weight_repairs"] = {obj.name: rigging.repair_unweighted(rig, obj) for obj in meshes}
    rigging.limit_influences(meshes)

    report["triangles"] = mu.triangles(meshes)
    report["measurements"] = body.measure(meshes)
    report["weights"] = {obj.name: rigging.weight_report(obj) for obj in meshes}
    report["deformation"] = rigging.deformation_report(rig, meshes,
                                                       rigging.extreme_poses(variant.finger_segments))
    report["budget_triangles"] = variant.max_triangles

    if do_actions:
        actions = animation.build_actions(rig, variant)
        report["actions"] = sorted(actions)
        report["clip_frames"] = {animation_spec.name: animation_spec.frames
                                 for animation_spec in spec.ANIMATIONS}
        report["looping_clips"] = list(spec.LOOPING_CLIPS)
    return {"report": report, "meshes": meshes, "rig": rig, "materials": material_set}


def export_fbx(path: Path) -> Path:
    """FBX with embedded textures, Y up, one take per action.

    The exporter names a take after its action, so the FBX clip names are already
    the contractual ones: no post-processing needed here, unlike the GLB.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=False,
        object_types={"ARMATURE", "MESH"},
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_actions=True,
        bake_anim_force_startend_keying=True,
        path_mode="AUTO",
        embed_textures=True,
        mesh_smooth_type="FACE",
        use_mesh_modifiers=False,
        axis_forward="-Z",
        axis_up="Y",
        global_scale=1.0,
        apply_unit_scale=True,
    )
    return path


def verify_export(glb_path: Path, expected_meshes: list[str] | None = None) -> dict:
    """Import the exported GLB into an empty scene and report what came back.

    This is the check that matters for the buyer: not "the export ran", but "the
    round trip still has the geometry, materials, rig and clips". The glTF importer
    spawns an icosphere as a bone display shape; that helper is filtered out, it is
    not part of the file.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    helpers = {bone.custom_shape.name
               for armature in armatures for bone in armature.pose.bones
               if bone.custom_shape is not None}
    meshes = [obj for obj in bpy.context.scene.objects
              if obj.type == "MESH" and obj.name not in helpers]
    names = sorted(obj.name for obj in meshes)
    report = {
        "meshes": names,
        "triangles": mu.triangles(meshes),
        "armatures": sorted(obj.name for obj in armatures),
        "bones": max((len(obj.data.bones) for obj in armatures), default=0),
        "actions": sorted(action.name for action in bpy.data.actions),
        "materials": sorted(material.name for material in bpy.data.materials),
        "images": sorted(image.name for image in bpy.data.images),
        "uv_layers": {obj.name: [layer.name for layer in obj.data.uv_layers] for obj in meshes},
        "vertex_groups": {obj.name: len(obj.vertex_groups) for obj in meshes},
        "helpers_filtered": sorted(helpers),
    }
    if expected_meshes is not None:
        report["missing"] = sorted(set(expected_meshes) - set(names))
        report["unexpected"] = sorted(set(names) - set(expected_meshes))
    return report


def export_glb(path: Path, *, animations: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_skins=True,
        export_animations=animations,
        export_animation_mode="ACTIONS",
        export_anim_slide_to_zero=True,
        export_image_format="AUTO",
    )
    return path


def run(variant_key: str, *, preview_dir: Path | None = None, blend_path: Path | None = None,
        glb_path: Path | None = None, do_preview: bool = True,
        resolution: tuple[int, int] = (520, 700), samples: int = 16,
        views: tuple[str, ...] = preview.VIEWS, engine: str = "CYCLES",
        do_painting: bool = True, do_fbx: bool = False, do_verify: bool = False,
        do_actions: bool = True) -> dict:
    variant = variant_by_key(variant_key)
    result = build_character(variant_key, do_actions=do_actions)
    report, meshes = result["report"], result["meshes"]

    if do_painting:
        # The texture directory is generator output: maps from an earlier run that
        # this variant no longer produces would otherwise be shipped as stale files.
        texture_dir = TEXTURE_DIR / variant.key
        if texture_dir.exists():
            for stale in texture_dir.glob("*.png"):
                stale.unlink()
        report["textures"] = painting.paint_and_wire(variant, result["materials"],
                                                     texture_dir=texture_dir)

    blend = Path(blend_path) if blend_path else MODEL_DIR / f"blender/merc_scout_{variant_key}.blend"
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
    report["files"] = {"blend": str(blend), "blend_bytes": blend.stat().st_size}

    glb = Path(glb_path) if glb_path else MODEL_DIR / f"glb/merc_scout_{variant_key}.glb"
    export_glb(glb, animations=do_actions)
    if do_actions:
        # Blender writes "<action>_<armature>"; buyers expect the bare clip name.
        report["clip_renames"] = glb_post.rename_animations(
            glb, known_clips=tuple(animation_spec.name for animation_spec in spec.ANIMATIONS))
    report["files"]["glb"] = str(glb)
    report["files"]["glb_bytes"] = glb.stat().st_size

    if do_fbx:
        fbx = MODEL_DIR / f"fbx/merc_scout_{variant_key}.fbx"
        export_fbx(fbx)
        report["files"]["fbx"] = str(fbx)
        report["files"]["fbx_bytes"] = fbx.stat().st_size

    if do_preview and preview_dir:
        written = preview.render_views(meshes, Path(preview_dir),
                                       prefix=f"merc_scout_{variant_key}_",
                                       resolution=resolution, samples=samples, views=views,
                                       engine=engine)
        report["previews"] = [str(path) for path in written]

    if do_verify:
        report["round_trip"] = verify_export(glb, expected_meshes=report["mesh_names"])
    report["glb_summary"] = glb_post.summarise(glb)
    return report

#!/usr/bin/env python3
"""Build a reviewed Ancient Tree sale package outside every repository checkout.

Run with Python, not Blender. Requires an explicit Blender executable and a new
output directory. Only the pinned, locally authored canonical tree is accepted.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ASSET = "assets/models/ancient_tree/"
SOURCES = {
    "scripts/generate_ancient_tree_asset.py": "6546b76ca383c98e5d6a057b0ff0a763c3d7ee46200060b3d67ff788e106da46",
    ASSET + "blender/ancient_tree.blend": "2ebd3c5385feb7be8e3688e484bbf1f0b40d6f9c0a0d1df748432ff8e6d6f49c",
    ASSET + "ancient_tree.glb": "312c5db3323a08e4a2404630f8ebadce8f6376acf09b905c9640510f28c9f264",
    ASSET + "ancient_tree_lod1.glb": "6221d5c51e60074877b4c8b6816bad16c8c23ee4fb24b560193c2d1475489c55",
    ASSET + "ancient_tree_lod2.glb": "4f9f6734afa13d3f0b82b85310ab87404261c50521502aa2927d5a791ad4e32c",
    ASSET + "ancient_tree_collision.glb": "95ab123e13c3062f28dd92c589897ef23ec2ed2635c01348ad6f186bd247312e",
}
MODEL_NAMES = [Path(p).name for p in SOURCES if p.endswith(".glb")]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_sources(root):
    for relative, expected in SOURCES.items():
        source = root / relative
        if source.is_symlink() or not source.is_file() or digest(source) != expected:
            raise ValueError(f"Unreviewed source: {relative}; review provenance before updating its pin")


def prepare_output(root, output):
    common = subprocess.check_output(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=root, text=True,
    ).strip()
    main_root = Path(common).resolve().parent
    output = output.resolve()
    worktree_list = subprocess.check_output(
        ["git", "worktree", "list", "--porcelain"], cwd=root, text=True)
    roots = [main_root, root, *[Path(line[9:]).resolve() for line in
        worktree_list.splitlines() if line.startswith("worktree ")]]
    if any(output == folder or folder in output.parents for folder in roots):
        raise ValueError("Generated sale files must be outside the repository and its worktrees")
    # Atomic creation prevents accidental replacement of a previous delivery.
    output.mkdir(parents=True, exist_ok=False)
    return output


def glb_document(path):
    data = path.read_bytes()
    if len(data) < 20 or struct.unpack_from("<III", data) != (0x46546C67, 2, len(data)):
        raise ValueError("Invalid GLB header")
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A or length % 4 or 20 + length > len(data):
        raise ValueError("Missing GLB JSON chunk")
    return json.loads(data[20:20 + length])


def restore_lod_transforms(hero_path, lod_path, label):
    """Restore authoring transforms in the sale copy; preserve its mesh buffers."""
    hero = glb_document(hero_path)
    lod = glb_document(lod_path)
    reference = {node["name"]: node for node in hero["nodes"]}
    if len(reference) != 6 or len(lod["nodes"]) != 6 or label not in ("LOD1", "LOD2"):
        raise ValueError("Unexpected LOD node layout")
    expected = {name + "_" + label for name in reference}
    if {node["name"] for node in lod["nodes"]} != expected:
        raise ValueError("Unexpected LOD node names")
    transforms = ("matrix", "translation", "rotation", "scale")
    adjusted = []
    for node in lod["nodes"]:
        source = reference[node["name"].removesuffix("_" + label)]
        if "children" in node or "children" in source or "mesh" not in node:
            raise ValueError("Unexpected LOD hierarchy")
        before = {key: node[key] for key in transforms if key in node}
        after = {key: source[key] for key in transforms if key in source}
        if before != after:
            adjusted.append(node["name"])
        for key in transforms:
            node.pop(key, None)
        node.update(after)
    data = lod_path.read_bytes()
    old_length = struct.unpack_from("<I", data, 12)[0]
    remainder = data[20 + old_length:]
    encoded = json.dumps(lod, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    lod_path.write_bytes(struct.pack("<III", 0x46546C67, 2, 20 + len(encoded) + len(remainder))
        + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + remainder)
    return adjusted


def load_validator():
    path = ROOT / ".codex/skills/blender-workflows/scripts/validate_glb.py"
    spec = importlib.util.spec_from_file_location("market_glb_validator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bounds(bpy, meshes):
    from mathutils import Vector
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    return {
        "min": [min(p[i] for p in points) for i in range(3)],
        "max": [max(p[i] for p in points) for i in range(3)],
        "size": [max(p[i] for p in points) - min(p[i] for p in points) for i in range(3)],
    }


def render(bpy, scene, camera, path, size=(1920, 1080)):
    scene.camera = camera
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def frame_set(scene, frame):
    integer = int(frame)
    scene.frame_set(integer, subframe=frame-integer)


def imported_studio(bpy, blend, meshes):
    for obj in meshes:
        obj.name = "Imported_" + obj.name
    with bpy.data.libraries.load(str(blend), link=False) as (src, dst):
        dst.collections = ["Presentation"]
    bpy.context.scene.collection.children.link(dst.collections[0])
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    world = bpy.data.worlds.new("NeutralWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.08, 0.10, 0.12, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    scene.world = world
    camera = bpy.data.objects["Camera_front"]
    camera.data.ortho_scale *= 1920/1080
    return scene, camera


def blender_worker(output):
    import bpy

    validator = load_validator()
    reports = {}
    package = output / "AncientTree"
    media = output / "Media"
    media.mkdir()
    bpy.ops.wm.open_mainfile(filepath=str(package / "Blender/AncientTree.blend"))
    if bpy.data.libraries or any(image.filepath for image in bpy.data.images):
        raise ValueError("The scene has external dependencies")
    if bpy.data.texts:
        raise ValueError("Review embedded scripts before selling the scene")
    scene = bpy.context.scene
    if tuple(bpy.app.version[:2]) != (4, 2):
        raise ValueError("This reviewed source requires Blender 4.2 LTS")
    asset_objects = list(bpy.data.collections["AncientTree"].objects)
    scene.frame_set(1)
    bpy.context.view_layer.update()
    source_bounds = bounds(bpy, asset_objects)

    for name in MODEL_NAMES:
        filepath = package / "Game" / name
        hero = name == "ancient_tree.glb"
        collision = "collision" in name
        args = argparse.Namespace(require_animation=hero, require_morphs=hero,
            max_triangles=120000, expect_meshes=7 if collision else 6)
        result = validator.inspect(filepath, args)
        if result["errors"]:
            raise ValueError(f"{name}: {result['errors']}")
        document = glb_document(filepath)
        if "lod" in name:
            reference = {node["name"]: node for node in glb_document(package / "Game/ancient_tree.glb")["nodes"]}
            label = "_LOD1" if "lod1" in name else "_LOD2"
            for node in document["nodes"]:
                source = reference[node["name"].removesuffix(label)]
                if any(node.get(key) != source.get(key) for key in ("matrix", "translation", "rotation", "scale")):
                    raise ValueError("LOD placement differs from the hero")
            result["node_transforms_match_hero"] = True
        if document.get("images") or document.get("textures"):
            raise ValueError("This texture-free tree must not acquire image dependencies")
        for mesh in document.get("meshes", []):
            for primitive in mesh["primitives"]:
                if collision:
                    continue
                material = document["materials"][primitive["material"]]
                factor = material.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1,1,1,1])
                if "COLOR_0" not in primitive["attributes"] and all(c >= 0.999 for c in factor[:3]):
                    raise ValueError(f"{name}: no effective material color")

        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = 30
        bpy.ops.import_scene.gltf(filepath=str(filepath))
        bpy.context.view_layer.update()
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        triangles = 0
        for obj in meshes:
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
        if triangles != result["triangles"]:
            raise ValueError(f"{name}: roundtrip changed triangles")
        if len(bpy.data.materials) != len(document.get("materials", [])) and not collision:
            raise ValueError(f"{name}: roundtrip changed materials")
        result["roundtrip_triangles"] = triangles
        if hero:
            keyed = [obj for obj in meshes if obj.data.shape_keys]
            if len(keyed) != 2 or len(document.get("animations", [])) != 2:
                raise ValueError("Both wind morph animations must survive")
            # Blender selects just one glTF clip on import. Activate the distinct
            # action of each mesh to test the documented simultaneous playback.
            for obj in keyed:
                for key in obj.data.shape_keys.key_blocks[1:]:
                    # glTF supports negative weights; Blender's importer can
                    # clamp them to the mesh's initial weight. Restore the
                    # reviewed authoring range before evaluating the clips.
                    key.slider_min = -1.0
                    key.slider_max = 1.0
                animation = obj.data.shape_keys.animation_data
                actions = {strip.action for track in animation.nla_tracks for strip in track.strips}
                if animation.action:
                    actions.add(animation.action)
                if len(actions) != 1:
                    raise ValueError("Expected one independent wind action per mesh")
                animation.use_nla = False
                animation.action = actions.pop()
            bpy.context.scene.frame_set(1)
            bpy.context.view_layer.update()
            result["bounds_m"] = bounds(bpy, meshes)
            result["source_bounds_m"] = source_bounds
            if max(abs(a-b) for key in ("min", "max") for a,b in
                   zip(result["bounds_m"][key], source_bounds[key])) > 0.002:
                raise ValueError("Hero roundtrip differs from authoring scene bounds")
            ranges = [tuple(action.frame_range) for action in bpy.data.actions]
            first = min(pair[0] for pair in ranges)
            last = max(pair[1] for pair in ranges)
            poses = []
            for index in range(9):
                frame_set(bpy.context.scene, first + (last-first)*index/8)
                poses.append([key.value for obj in keyed for key in obj.data.shape_keys.key_blocks[1:]])
            if any(max(p[i] for p in poses) - min(p[i] for p in poses) < 0.01
                   for i in range(len(poses[0]))):
                raise ValueError("A wind morph stays frozen through the imported animation")
            if any(min(p[i] for p in poses) > -0.35 or max(p[i] for p in poses) < 0.65
                   for i in range(len(poses[0]))):
                raise ValueError("Imported wind lost its positive or negative authored gust")
            if max(abs(a-b) for a,b in zip(poses[0], poses[-1])) > 0.001:
                raise ValueError("Wind loop endpoints do not match")
            result["wind_poses"] = poses
            result["wind_duration_seconds"] = (last-first)/30
            peak_index = max(range(1, 8), key=lambda i:sum(abs(value) for value in poses[i]))
            result["wind_peak_fraction"] = peak_index/8
            # Inspect material parity visually using the imported geometry in the source studio.
            for index in (0, peak_index, 8):
                frame_set(bpy.context.scene, first + (last-first)*index/8)
                depsgraph = bpy.context.evaluated_depsgraph_get()
                result.setdefault("evaluated_wind_bounds", []).append(bounds(
                    bpy, [obj.evaluated_get(depsgraph) for obj in meshes]))
            scene, camera = imported_studio(bpy, package / "Blender/AncientTree.blend", meshes)
            for label, fraction in (("wind_rest",0), ("wind_peak",peak_index/8), ("wind_loop",1)):
                frame_set(scene, first+(last-first)*fraction)
                render(bpy, scene, camera, media / (label+".png"))
        else:
            result["bounds_m"] = bounds(bpy, meshes)
            if not collision:
                if abs(result["bounds_m"]["min"][2] - source_bounds["min"][2]) > 0.1:
                    raise ValueError("LOD root base moved during export")
                scene, camera = imported_studio(bpy, package / "Blender/AncientTree.blend", meshes)
                render(bpy, scene, camera, media / ("lod1.png" if "lod1" in name else "lod2.png"))
        reports[name] = result
    bpy.ops.wm.open_mainfile(filepath=str(package / "Blender/AncientTree.blend"))
    scene = bpy.context.scene
    scene.frame_set(1)
    for label in ("front", "side", "rear", "three_quarter_left"):
        camera = bpy.data.objects["Camera_" + label]
        camera.data.ortho_scale *= 1920 / 1080
        render(bpy, scene, camera, media / (label + ".png"))
    (output / "QA.json").write_text(json.dumps(reports, indent=2)+"\n", encoding="utf-8")


def write_documents(output, reports):
    hero = reports["ancient_tree.glb"]
    dims = " x ".join(f"{n:.3f}" for n in hero["bounds_m"]["size"])
    rows = "\n".join(f"{name}: {report['triangles']:,} triangles; {report['bytes']:,} bytes"
                     for name,report in reports.items())
    buyer = f"""ANCIENT TREE - VERSION 1.0.0

One stylized, old broadleaf tree for digital scenes and games.

Blender/AncientTree.blend is the editable Blender 4.2 LTS source and includes
studio lights and cameras. No add-ons, external textures or linked libraries
are needed. The tree is in AncientTree; presentation helpers are separate.
AncientTreeCollision is a separate proxy; hide it for presentation renders.

Game/ancient_tree.glb is the main tree with vertex colors and wind morphs.
Game/ancient_tree_lod1.glb and ancient_tree_lod2.glb are static distance models.
Game/ancient_tree_collision.glb contains seven coarse collision meshes only.
Do not use the collision model as visible tree geometry.

The source uses metres and Z-up; GLB uses metres and Y-up. Main-model extents
after Blender import: {dims} metres (X x Y x Z). Roots extend below the origin.
Place the root base at ground level and scale the complete model together.
There are eight materials, using vertex colors rather than image textures.
The Blender scene retains its procedural bark and leaf shaders. GLB uses
exported vertex colors and metallic/roughness materials; Blender procedural
bump details are not baked into texture maps, so shading differs by renderer.
Render geometry uses six logical mesh nodes, split into material primitives
by some importers. Preserve COLOR_0 when converting to another file format.

Wind consists of two simultaneous morph-weight clips, for foliage and fine
branches. Play BOTH clips together and loop them; duration is approximately
{hero['wind_duration_seconds']:.3f} seconds. GLB does not define autoplay or looping.
When importing GLB into Blender 4.2, activate both imported shape-key actions
and set each WindGust shape key's Min/Max to -1/+1 to retain the negative gust.
Opening the supplied .blend instead already has these ranges and actions set.
LODs are static. Blender uses shape keys; this is not an armature rig.
No native Unity/Unreal project, custom shaders, runtime controller or automatic
LOD switching is supplied. Engine-specific integration is the buyer's task.

MEASURED GEOMETRY AND SIZE
{rows}

To use in Blender: open the .blend or import a GLB using File > Import > glTF.
To use in a glTF-capable engine: load the desired Game file, retain materials
and vertex colors, and configure morph animation playback where supported.

This digital model has not been prepared or tested for 3D printing.
"""
    (output / "AncientTree/README.txt").write_text(buyer, encoding="utf-8")
    (output / "AncientTree/LICENSE.txt").write_text(
        "For purchases on Fab, usage is governed by the Fab Standard License\n"
        "and the purchase terms shown on your product page.\n"
        "https://www.fab.com/eula\n"
        "This notice does not grant an independent license before purchase.\n", encoding="utf-8")
    listing = f"""# Fab offer draft - Ancient Tree with Wind

One stylized old tree with exposed roots, a thick branching trunk, varied
foliage and subtle wind motion. Includes an editable Blender 4.2 LTS scene,
a GLB main model, two static LODs and a separate coarse collision model.
All presentation images show the supplied tree. The studio lights/cameras
are included in the Blender scene. The game, landscape and gameplay code
are not included.

## Technical details

- Main model: {hero['triangles']:,} triangles, 6 logical mesh nodes, 8 materials.
- LOD1: {reports['ancient_tree_lod1.glb']['triangles']:,} triangles.
- LOD2: {reports['ancient_tree_lod2.glb']['triangles']:,} triangles.
- Collision: 196 triangles, 7 separate coarse volumes.
- Dimensions: {dims} m; Blender axes X/Y/Z. Editable scene units: metres.
- No external image textures. Vertex colors must be retained by importers.
- Blender procedural shader details are not supplied as baked GLB texture maps.
- Two synchronized wind morph clips; approximately {hero['wind_duration_seconds']:.3f}s.
- Blender GLB import needs both actions and shape-key range -1/+1; see README.
- Static LODs. No armature, native engine project or custom runtime scripts.
- Blender 4.2.16 LTS and glTF roundtrip verified. Other engines not certified.

## Suggested seller settings

Category: 3D / Nature / Trees. Tags: Stylized, Tree, Nature, Animated, LOD.
Formats: Blender and GLB. License: Fab Standard.
Created with AI: yes (conservative disclosure for AI-assisted procedural modeling).
AI assistance was used for procedural Blender scripting and product text;
the product images are actual Blender renders of the included model.
Price proposal: US$4.99 Personal / US$9.99 Professional, subject to seller approval
and the current price choices in Fab. This is a starting proposal, not a market valuation.
Use manual activation after review. Account, tax/payout setup and publication
approval remain with the seller. No automatic upload or publication occurred.

## Upload files

AncientTree_GLB_1.0.0.zip for GLB; AncientTree_Blender_1.0.0.zip for Blender.
Media/*.png for the gallery; ancient_tree.glb can also serve as 3D preview.
front/side/rear/three_quarter_left show the Blender source. wind_* show the
imported GLB with both clips active and demonstrate its exported shading.
lod1/lod2 show the supplied distance models after import.
All images are 1920 x 1080. Confirm the portal's latest requirements at upload.

Sources checked 2026-09-29:
- https://dev.epicgames.com/documentation/fab/asset-file-format-and-structure-requirements-in-fab
- https://dev.epicgames.com/documentation/fab/publishing-assets-for-sale-or-free-download-in-fab
- https://www.fab.com/eula
"""
    (output / "Fab_Angebot.md").write_text(listing, encoding="utf-8")
    (output / "Start_Hier.md").write_text("""# Ancient-Tree-Verkaufspilot

## Fertige Lieferung

- AncientTree_Complete_1.0.0.zip: Blender-Szene und alle vier GLBs.
- AncientTree_GLB_1.0.0.zip / AncientTree_Blender_1.0.0.zip: getrennte Formate für Fab.
- Media/: tatsächliche Modellansichten, einschließlich importierter Windposen.
- Fab_Angebot.md: englischer Angebotsentwurf und unverbindlicher Preisvorschlag.
- Herkunft.json / QA.json / SHA256.json: interne Herkunfts- und Prüfnachweise.

Es wird nur der geprüfte, selbst erzeugte Hauptbaum geliefert. Die zehn bereits
vorhandenen Varianten sind noch kein Bestandteil dieses Verkaufsprodukts.
Die Spielquelldateien wurden nicht verändert. Keine Veröffentlichung erfolgte.
Die Verkaufskopien der LODs erhalten die Position und Drehung ihrer Details
aus dem Hauptmodell; die ursprünglichen Spielexporte bleiben erhalten.

## Nächster Schritt zum Verkauf

Verkäuferkonto samt Steuer- und Auszahlungsdaten selbst vervollständigen.
Danach Paket, Beschreibung, Preis und KI-Angabe prüfen und Veröffentlichung
freigeben. Die technische Herkunftsprüfung ist keine Garantie für sämtliche
vertraglichen Rechte; unbekannte Miturheber- oder Auftragsrechte offenlegen.

## Weitere Modelle

Bestand.json trennt diesen geprüften Piloten von heruntergeladenen und noch
nicht geprüften Modellfamilien. Weitere Pakete erst nach eigener Herkunfts-
und Qualitätsprüfung ableiten. Aufwand und Rückfragen nach dem ersten Angebot
erfassen, bevor eine größere Reihe produziert wird.
""", encoding="utf-8")
    (output / "KI_Briefing.md").write_text("""# KI-Ablauf für weitere digitale Varianten

## Auftrag

Nutze ausschließlich den geprüften Ancient-Tree-Generator mit seinem stabilen
Seed und seinen vorhandenen TreeParameters. Erstelle zuerst einen konkreten
Vorschlag für drei unterschiedliche Silhouetten. Leite Maße, Farbpalette,
LOD-Grenzen und Windstärke aus dem bestätigten Ausgangsmodell ab. Nutze keine
importierten Meshes, fremden Texturen, bezahlten Dienste oder Markenmotive.

## Durchführung und Abnahme

1. Parameter vor dem Erzeugen festhalten; Varianten deterministisch bauen.
2. In einem getrennten Arbeitsbereich schreiben und eigene Ausgaben verwenden.
3. Große Form und vier Ansichten prüfen; erst danach Materialdetails verändern.
4. Hero, LODs und Kollision separat exportieren und in leeren Szenen importieren.
5. Maße, Geometrie, effektive Farben, Ressourcen und Windposen messen.
6. Erst aus diesen Ergebnissen Beschreibung, Tags und Vorschaubilder ableiten.
7. Verkäufer gibt Erscheinungsbild und Veröffentlichung frei.

Die bestehende Zehnerreihe kann als Ausgangspunkt geprüft werden. Sie wird
nicht durch eine neue KI-Beschreibung automatisch als geprüft eingestuft.

## Modellnutzung

GPT-6 Sol high: Quellen, Generatoränderungen und visuelle/technische Abnahme.
GPT-6 Luna medium: begrenzte Parameterideen und Texte aus bestätigten Fakten.
Bei einem ungelösten Exportfehler oder widersprüchlichen Herkunftsdaten zu Sol
high wechseln und die Ursache klären, bevor weitere Varianten gebaut werden.
Die Empfehlung startet keine zusätzlichen Agenten.
""", encoding="utf-8")
    (output / "3D_Druck_Folgeplan.md").write_text("""# Folgeplan: Ancient Tree für 3D-Druck

Start nach dem digitalen Verkaufspiloten mit einem einzelnen Prototyp.

1. FDM oder Resin, Zielgröße und konkreten Drucker bestimmen.
2. Eine getrennte Druckkopie erstellen: geschlossene Körper, belastbare Äste,
   druckbare Blattmasse und eine standsichere Basis. Spielgeometrie erhalten.
3. Wandstärken passend zu Druckverfahren, Material und Maßstab festlegen;
   offene Kanten, Überschneidungen und schwebende Teile prüfen.
4. STL beziehungsweise 3MF im gewählten Slicer prüfen, mit Schichtansichten,
   Druckausrichtung und gegebenenfalls Support- oder Teilungsstrategie.
5. Einen Probedruck herstellen; fehlende Details, Bruchstellen und Montage
   bewerten und korrigieren. Slicer-Erfolg allein genügt nicht zur Freigabe.
6. Druckfassung erst nach bestandenem Probedruck separat anbieten, mit echten
   Druckfotos, Maßstab, Material und dokumentierten Einstellungen.

Der digitale Pilot ist nicht als druckfertig zertifiziert.

## Modellnutzung

GPT-6 Sol high: Druckkonzept, Geometrie und Abnahme des Probedrucks.
GPT-6 Luna medium: dokumentierte Einstellungen und Beschreibung aufbereiten.
Bei feinen Ästen, schwierigen Blattflächen oder fehlgeschlagenem Probedruck
Sol high für gezielte Formkorrektur einsetzen; physischer Druck bleibt das Gate.
""", encoding="utf-8")
    inventory = []
    for folder in sorted((ROOT / "assets/models").iterdir()):
        if not folder.is_dir():
            continue
        status = "unreviewed"
        if folder.name == "ancient_tree":
            status = "canonical_reviewed_variants_unreviewed"
        elif folder.name in ("downloaded_cc0", "optimized_cc0", "jets"):
            status = "excluded_downloaded_or_mixed_origin"
        inventory.append({"family":folder.name, "status":status})
    (output / "Bestand.json").write_text(json.dumps(inventory, indent=2)+"\n", encoding="utf-8")


def archive(output, name, files):
    with zipfile.ZipFile(output / name, "x", compression=zipfile.ZIP_DEFLATED) as target:
        for relative in sorted(files):
            target.write(output / "AncientTree" / relative, "AncientTree/"+relative)
    with zipfile.ZipFile(output / name) as target:
        if target.testzip() is not None or len(target.namelist()) != len(files):
            raise ValueError("Archive verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    verify_sources(ROOT)
    if not args.blender.is_file():
        raise ValueError("Blender executable not found")
    output = prepare_output(ROOT, args.output)
    package = output / "AncientTree"
    (package / "Game").mkdir(parents=True)
    (package / "Blender").mkdir()
    shutil.copy2(ROOT / (ASSET+"blender/ancient_tree.blend"), package / "Blender/AncientTree.blend")
    for name in MODEL_NAMES:
        shutil.copy2(ROOT / ASSET / name, package / "Game" / name)
    adjustments = {label: restore_lod_transforms(package / "Game/ancient_tree.glb",
        package / "Game" / f"ancient_tree_{label.lower()}.glb", label)
        for label in ("LOD1", "LOD2")}
    with (output / "Blender_QA.log").open("w", encoding="utf-8") as log:
        subprocess.run([str(args.blender), "--background", "--factory-startup", "--disable-autoexec",
            "--python-exit-code", "1", "--python", str(Path(__file__).resolve()), "--", "worker",
            str(output)], check=True, stdout=log, stderr=subprocess.STDOUT)
    reports = json.loads((output / "QA.json").read_text(encoding="utf-8"))
    write_documents(output, reports)
    common = ["README.txt", "LICENSE.txt"]
    game = ["Game/"+name for name in MODEL_NAMES]
    blend = ["Blender/AncientTree.blend"]
    for name,files in [("AncientTree_GLB_1.0.0.zip", common+game),
                       ("AncientTree_Blender_1.0.0.zip",common+blend),
                       ("AncientTree_Complete_1.0.0.zip",common+game+blend)]:
        archive(output, name, files)
    provenance = {"selection": "canonical Ancient Tree only", "generator_seed": 41073,
        "source_sha256": SOURCES, "source_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sale_adjustments": {"restored_hero_transforms_in_lod_copies": adjustments,
            "mesh_buffers_unchanged": True, "original_game_files_unchanged": True},
        "evidence": ["Procedural mesh generator creates all geometry from scratch",
                     "No linked libraries, embedded scripts or external images in source scene",
                     "No images/textures in the GLBs; colors carried as vertex attributes"],
        "excluded": ["downloaded_cc0", "optimized_cc0", "jets/cc0", "all unreviewed model families"],
        "legal_limit": "Technical provenance is verified; not an independent legal title opinion"}
    (output / "Herkunft.json").write_text(json.dumps(provenance, indent=2)+"\n", encoding="utf-8")
    all_files = [p for p in output.rglob("*") if p.is_file()]
    checksums = {p.relative_to(output).as_posix():digest(p) for p in all_files}
    (output / "SHA256.json").write_text(json.dumps(checksums, indent=2)+"\n", encoding="utf-8")
    print("Verified package:", output)


if __name__ == "__main__":
    if "--" in sys.argv and sys.argv[sys.argv.index("--")+1] == "worker":
        blender_worker(Path(sys.argv[sys.argv.index("--")+2]))
    else:
        main()

"""Contract guards for the marketplace nature generators.

These checks are pure standard library and deliberately do not import `bpy`:
they exercise the deterministic parameter preparation and the Blender-free
geometry of `scripts/generate_marketplace_trees.py` and
`scripts/generate_marketplace_plants.py`, plus their output-directory guards.
Blender rendering, export and roundtrip validation stay with the parent run.

Run directly (the dotted file name is not importable as a module):

    python -B tests/marketplace-nature.test.py
"""
import importlib.util
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]

# Neighbourhood of the 26 cells around a spatial-hash cell. Used by the
# attachment check so it does not compare every blossom against every vertex.
CELL_OFFSETS = tuple((dx, dy, dz)
                     for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1))

# Loading the generator modules must not leave `__pycache__` inside the repo,
# even when the suite is started without `python -B`.
sys.dont_write_bytecode = True


def load_module(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


trees = load_module("marketplace_trees_under_test", "scripts/generate_marketplace_trees.py")
plants = load_module("marketplace_plants_under_test", "scripts/generate_marketplace_plants.py")


def scratch_directory(label):
    """Create a writable scratch directory outside the repository.

    `tempfile.mkdtemp` is avoided on purpose: some sandboxes restrict writes
    below a freshly created 0700 directory, while `os.makedirs` works. The
    directories are retained for inspection, as required by the repository's
    cleanup rules.
    """
    path = Path(tempfile.gettempdir()) / f"curvios-nature-{label}-{uuid.uuid4().hex[:10]}"
    os.makedirs(path, exist_ok=False)
    return path


def leaf_components(plan, material="LeafGreen"):
    """Connected components of one material's surface: one per emitted leaf.

    Each blade is emitted as its own vertex island, so a union-find over shared
    vertices separates the leaflets without knowing anything about the builder.
    """
    parent = {}

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first, second):
        root_first, root_second = find(first), find(second)
        if root_first != root_second:
            parent[root_second] = root_first

    for face, material_index in zip(plan["faces"], plan["face_materials"]):
        if plants.MATERIAL_NAMES[material_index] != material:
            continue
        for index in face:
            parent.setdefault(index, index)
        for index in face[1:]:
            union(face[0], index)
    groups = {}
    for index in parent:
        groups.setdefault(find(index), []).append(index)
    return [[plan["vertices"][index] for index in indices] for indices in groups.values()]


def blade_aspect(points):
    """Longest dimension of one leaf divided by the widest dimension across it.

    A slender pinnule scores well above three; the rejected broad oval saucers
    stayed near two, so the ratio separates the two shapes without naming any
    builder detail.
    """
    count = len(points)
    if count < 3:
        return 0.0
    origin = None
    length_axis = None
    longest = 0.0
    for first in range(count):
        for second in range(first + 1, count):
            delta = plants._sub(points[second], points[first])
            distance = plants._length(delta)
            if distance > longest:
                longest = distance
                origin = points[first]
                length_axis = plants._scale(delta, 1.0 / distance)
    widest = 0.0
    for first in range(count):
        residual = plants._sub(points[first], origin)
        offset = plants._sub(residual, plants._scale(length_axis,
                                                     plants._dot(residual, length_axis)))
        for second in range(first + 1, count):
            residual2 = plants._sub(points[second], origin)
            offset2 = plants._sub(residual2, plants._scale(length_axis,
                                                           plants._dot(residual2, length_axis)))
            width = plants._length(plants._sub(offset, offset2))
            if width > widest:
                widest = width
    return longest / widest if widest > 1e-9 else 0.0


def leaf_axis(points):
    """The longest-axis direction of one leaf island."""
    longest = 0.0
    axis = (0.0, 0.0, 1.0)
    for first in range(len(points)):
        for second in range(first + 1, len(points)):
            delta = plants._sub(points[second], points[first])
            distance = plants._length(delta)
            if distance > longest:
                longest = distance
                axis = plants._scale(delta, 1.0 / distance)
    return axis


TREE_CONTEXT = {
    "id": "compact",
    "seed": 11,
    "parameters": {
        "height_scale": 0.92,
        "crown_scale": 1.10,
        "crown_aspect": 1.05,
        "branch_density_scale": 1.00,
        "foliage_density_scale": 0.95,
        "wind_scale": 1.20,
    },
}


def tree_context(**overrides):
    context = {key: (dict(value) if isinstance(value, dict) else value)
               for key, value in TREE_CONTEXT.items()}
    context["parameters"].update(overrides)
    return context


class MarketplaceTreeGenerator(unittest.TestCase):
    def test_pinned_source_hash_is_proven_before_generation(self):
        provenance = trees.verify_source_pin()
        self.assertEqual(provenance["sha256"], trees.SOURCE_SHA256)
        self.assertEqual(Path(provenance["path"]).name, "generate_ancient_tree_asset.py")

        folder = scratch_directory("pin")
        tampered = folder / "generate_ancient_tree_asset.py"
        tampered.write_text("# unreviewed rewrite\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "pin mismatch"):
            trees.verify_source_pin(tampered)
        # The pin is data, not a silent fallback: an explicit expectation is
        # only satisfied by the matching content.
        self.assertEqual(trees.verify_source_pin(tampered, expected=trees.digest(tampered))["sha256"],
                         trees.digest(tampered))

    def test_module_loader_registers_dataclass_modules(self):
        # The pinned source defines frozen dataclasses with postponed
        # annotations; dataclasses resolves them through sys.modules, so the
        # loader must register the module before executing it.
        folder = scratch_directory("dataclass")
        module_path = folder / "sample_dataclass_module.py"
        module_path.write_text(
            "from __future__ import annotations\n"
            "from dataclasses import dataclass\n"
            "@dataclass(frozen=True)\n"
            "class Sample:\n"
            "    value: float = 1.0\n"
            "def make(value: float) -> Sample:\n"
            "    return Sample(value)\n",
            encoding="utf-8")
        module = trees._load_module("nature_dataclass_probe", module_path)
        self.assertIs(sys.modules["nature_dataclass_probe"], module)
        self.assertEqual(module.make(2.5).value, 2.5)

    def test_parameters_are_read_exactly_from_the_context(self):
        prepared = trees.extract_tree_parameters(TREE_CONTEXT)
        self.assertEqual(prepared["name"], "compact")
        self.assertEqual(prepared["seed"], 11)
        for field in trees.PARAMETER_FIELDS:
            self.assertEqual(prepared[field], TREE_CONTEXT["parameters"][field])

    def test_parameters_reject_missing_non_numeric_and_non_positive_values(self):
        for field in trees.PARAMETER_FIELDS:
            with self.assertRaisesRegex(ValueError, "missing tree parameter"):
                trees.extract_tree_parameters(self._without(field))
        for field in trees.PARAMETER_FIELDS:
            for bad in ("1.0", True, 0.0, -0.5, float("nan"), float("inf")):
                with self.assertRaises(ValueError):
                    trees.extract_tree_parameters(tree_context(**{field: bad}))

    def _without(self, field):
        context = tree_context()
        del context["parameters"][field]
        return context

    def test_context_id_and_seed_are_required(self):
        for bad_id in (None, "", 7):
            context = tree_context()
            context["id"] = bad_id
            with self.assertRaises(ValueError):
                trees.extract_tree_parameters(context)
        for bad_seed in (None, "11", 1.5, True):
            context = tree_context()
            context["seed"] = bad_seed
            with self.assertRaises(ValueError):
                trees.extract_tree_parameters(context)

    def test_advisory_windows_warn_without_changing_values(self):
        prepared = trees.extract_tree_parameters(tree_context(height_scale=0.50))
        self.assertEqual(prepared["height_scale"], 0.50)
        warnings = trees.tree_parameter_warnings(prepared)
        self.assertTrue(any("height_scale" in message for message in warnings))
        self.assertEqual(trees.tree_parameter_warnings(
            trees.extract_tree_parameters(TREE_CONTEXT)), [])

    def test_output_inside_a_worktree_is_rejected_without_writing(self):
        folder = scratch_directory("tree-worktree")
        checkout = folder / "checkout"
        (checkout / ".git").mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, "Git worktree"):
            trees.prepare_variant_output_dir(checkout)
        for target in (checkout / "batch", checkout / "batch" / "variant-01"):
            with self.assertRaisesRegex(ValueError, "Git worktree"):
                trees.prepare_variant_output_dir(target)
            self.assertFalse(target.exists())

    def test_completed_tree_delivery_is_not_overwritten(self):
        folder = scratch_directory("tree-overwrite")
        output = folder / "variant-01"
        (output / "AncientTree" / "Game").mkdir(parents=True)
        marker = output / "AncientTree" / "Game" / "ancient_tree.glb"
        marker.write_bytes(b"existing delivery")
        with self.assertRaises(FileExistsError):
            trees.prepare_variant_output_dir(output)
        self.assertEqual(marker.read_bytes(), b"existing delivery")

    def test_fresh_external_output_directory_is_created(self):
        folder = scratch_directory("tree-fresh")
        output = folder / "batch" / "variant-01"
        resolved = trees.prepare_variant_output_dir(output)
        self.assertTrue(resolved.is_dir())
        self.assertEqual(resolved, output.resolve())
        # A relative path is refused so a variant can never land in the repo.
        with self.assertRaises(ValueError):
            trees.prepare_variant_output_dir(Path("relative") / "out")


class MarketplacePlantGenerator(unittest.TestCase):
    def test_species_height_pairs_are_exact(self):
        self.assertEqual(plants.SPECIES_HEIGHT_M,
                         {"daisy": 0.65, "lavender": 0.70, "fern": 0.75, "grass": 0.85,
                          "poppy": 0.72, "sunflower": 1.80, "cornflower": 0.70,
                          "red_clover": 0.40, "cattail": 1.60,
                          "buttercup": 0.45, "chicory": 0.90, "yarrow": 0.65,
                          "ribwort_plantain": 0.45, "wild_strawberry": 0.25})
        for species, height in plants.SPECIES_HEIGHT_M.items():
            self.assertEqual(plants.resolve_species({"species": species, "height_m": height}),
                             (species, height))
        # Every catalogued species has a builder, and each bloom species has an
        # explicit closeup extent so no closeup falls back to a guess.
        self.assertEqual(sorted(plants.BUILDERS), sorted(plants.SPECIES_HEIGHT_M))
        self.assertTrue(set(plants.BLOOM_EXTENT_M).issubset(plants.BLOOM_SPECIES))
        self.assertTrue(set(plants.BLOOM_SPECIES).issubset(plants.SPECIES_HEIGHT_M))

    def test_wrong_species_or_height_is_rejected(self):
        bad_inputs = (
            {"species": "rose", "height_m": 0.65},
            {"species": "daisy", "height_m": 0.70},
            {"species": "lavender", "height_m": 0.75},
            {"species": "fern"},
            {"species": "grass", "height_m": "0.85"},
            {"species": "grass", "height_m": True},
            {"species": "grass", "height_m": float("nan")},
            {"species": "grass", "height_m": -0.85},
        )
        for parameters in bad_inputs:
            with self.assertRaises(ValueError):
                plants.resolve_species(parameters)

    def test_unexpected_parameters_are_reported_not_silently_used(self):
        warnings = plants.parameter_warnings({"species": "daisy", "height_m": 0.65,
                                              "colour": "pink"})
        self.assertEqual(len(warnings), 1)
        self.assertIn("colour", warnings[0])
        self.assertEqual(plants.parameter_warnings({"species": "daisy", "height_m": 0.65}), [])

    def test_geometry_is_deterministic_per_seed(self):
        for species, height in plants.SPECIES_HEIGHT_M.items():
            first = plants.build_geometry(species, height, 20260101)
            second = plants.build_geometry(species, height, 20260101)
            self.assertEqual(first["vertices"], second["vertices"])
            self.assertEqual(first["faces"], second["faces"])
            self.assertEqual(first["flex"], second["flex"])
            self.assertEqual(first["fingerprint"], second["fingerprint"])
            other = plants.build_geometry(species, height, 20260102)
            self.assertNotEqual(first["fingerprint"], other["fingerprint"])

    def test_geometry_is_grounded_and_matches_the_declared_height(self):
        for seed in (20260101, 7, 424242):
            for species, height in plants.SPECIES_HEIGHT_M.items():
                plan = plants.enforce_plan_budgets(plants.build_geometry(species, height, seed))
                self.assertEqual(plan["bounds_min"][2], 0.0)
                measured = plan["bounds_max"][2] - plan["bounds_min"][2]
                self.assertGreaterEqual(measured, height * 0.85,
                                        f"{species} seed {seed} is too short")
                self.assertLessEqual(measured, height * 1.16,
                                     f"{species} seed {seed} is too tall")

    def test_geometry_stays_inside_the_hero_budgets(self):
        for species, height in plants.SPECIES_HEIGHT_M.items():
            plan = plants.enforce_plan_budgets(plants.build_geometry(species, height, 20260101))
            self.assertLessEqual(plan["triangles"], plants.BUDGETS["triangles_max"])
            self.assertLessEqual(len(plan["materials"]), plants.BUDGETS["materials_max"])
            self.assertTrue(set(plan["materials"]).issubset(set(plants.MATERIAL_NAMES)))
            self.assertEqual(len(plan["flex"]), len(plan["vertices"]))
            self.assertEqual(len(plan["face_materials"]), len(plan["faces"]))
            for face, material in zip(plan["faces"], plan["face_materials"]):
                self.assertGreaterEqual(material, 0)
                self.assertLess(material, len(plants.MATERIAL_NAMES))
                for index in face:
                    self.assertLess(index, len(plan["vertices"]))

    def test_shared_cleanup_removes_only_collapsed_triangles(self):
        # 0/1/2 an ordinary triangle, 0/4/3 a genuinely thin blade (area 1e-8 m2,
        # 100 times above the tolerance), 0/0/4 a repeated vertex and 0/1/5 an
        # exactly collinear sliver.
        vertices = [(0.0, 0.0, 0.0), (0.01, 0.0, 0.0), (0.0, 0.01, 0.0),
                    (0.0, 0.0002, 0.0), (0.0001, 0.0, 0.0), (0.005, 0.0, 0.0)]
        faces = [(0, 1, 2), (0, 4, 3), (0, 0, 4), (0, 1, 5)]
        flex = [0.0, 0.5, 1.0, 0.9, 0.2, 0.3]
        tint = [0.1, 0.5, 1.0, 0.9, 0.2, 0.3]
        cleaned = plants.clean_geometry(vertices, faces, [0, 1, 2, 3], flex, tint)
        self.assertEqual(cleaned["faces"], [(0, 1, 2), (0, 3, 4)])
        self.assertEqual(cleaned["face_materials"], [0, 1])
        # Vertex 5 was only used by the collapsed sliver; the four surviving
        # vertices keep their first-use order and their per-vertex tint.
        self.assertEqual(cleaned["vertices"],
                         [vertices[0], vertices[1], vertices[2], vertices[4], vertices[3]])
        self.assertEqual(cleaned["flex"], [0.0, 0.5, 1.0, 0.2, 0.9])
        self.assertEqual(cleaned["tint"], [0.1, 0.5, 1.0, 0.2, 0.9])

    def test_generated_geometry_has_no_collapsed_faces_left(self):
        for species, height in plants.SPECIES_HEIGHT_M.items():
            for seed in (20260101, 7, 424242):
                plan = plants.build_geometry(species, height, seed)
                for face in plan["faces"]:
                    self.assertEqual(len(set(face)), len(face),
                                     f"{species} seed {seed} keeps a repeated vertex")
                    for triangle in plants._fan_triangles(face):
                        area = plants._triangle_area(plan["vertices"], triangle)
                        self.assertGreater(area, plants.DEGENERATE_AREA_M2,
                                           f"{species} seed {seed} kept a collapsed face")

    def test_cleanup_tolerance_stays_far_below_the_finest_blade(self):
        smallest = None
        for species, height in plants.SPECIES_HEIGHT_M.items():
            for seed in (20260101, 7, 424242):
                plan = plants.build_geometry(species, height, seed)
                for face in plan["faces"]:
                    for triangle in plants._fan_triangles(face):
                        area = plants._triangle_area(plan["vertices"], triangle)
                        if smallest is None or area < smallest:
                            smallest = area
        # Measured roughly 5e-8 m2 for the finest petal tip; the cleanup
        # tolerance must stay at least two orders of magnitude below it.
        self.assertGreater(smallest, plants.DEGENERATE_AREA_M2 * 100.0)

    def test_daisy_yellow_dome_follows_the_head_normal(self):
        geometry = plants.PlantGeometry()
        normal = plants._normalize((0.6, -0.2, 1.0))
        height = 0.01
        geometry.dome((0.0, 0.0, 0.0), 0.01, height, "BloomYellow",
                      segments=6, rings=2, normal=normal)
        apex = max(geometry.vertices, key=lambda vertex: plants._dot(vertex, normal))
        offset = plants._sub(apex, plants._scale(normal, height))
        self.assertLess(plants._length(offset), 1e-9,
                        "the daisy centre still grows along world Z")

    def test_daisy_bloom_camera_sees_the_face_along_its_normal(self):
        for seed in (20260101, 560265243):
            plan = plants.build_geometry("daisy", 0.65, seed)
            normal = plan["bloom_normal"]
            self.assertIsNotNone(normal)
            self.assertAlmostEqual(plants._length(normal), 1.0, places=6)
            # The specimen views need a head tilted clearly off straight up.
            self.assertLess(normal[2], 0.93)
            view = plants.bloom_view_direction(normal)
            self.assertGreater(plants._dot(view, normal), 0.84,
                               "the bloom camera looks at the head almost edge-on")
            location = plants.bloom_camera_location(plan["bloom_focus"], normal,
                                                    plants.BLOOM_EXTENT_M["daisy"])
            distance = plants._length(plants._sub(location, plan["bloom_focus"]))
            # At 55 mm and a 36 mm sensor on 16:9 the vertical coverage is about
            # 0.367 x distance; the whole head must fit with a margin.
            self.assertGreater(0.367 * distance, plants.BLOOM_EXTENT_M["daisy"] * 1.2)
        # Lavender is a spike, not a flowering head, and keeps the fallback.
        self.assertIsNone(plants.build_geometry("lavender", 0.70, 20260101)["bloom_normal"])

    def test_wind_flex_is_stiff_at_the_base_and_flexible_at_the_tips(self):
        for species, height in plants.SPECIES_HEIGHT_M.items():
            plan = plants.build_geometry(species, height, 20260101)
            pairs = sorted(zip(plan["vertices"], plan["flex"]), key=lambda item: item[0][2])
            window = max(1, len(pairs) // 20)
            base_flex = sum(item[1] for item in pairs[:window]) / window
            tip_flex = sum(item[1] for item in pairs[-window:]) / window
            self.assertLess(base_flex, 0.25, f"{species} base is not stiff")
            self.assertGreater(tip_flex, 0.55, f"{species} tips are not flexible")
            self.assertGreater(tip_flex, base_flex + 0.35)

    def test_species_keep_distinct_silhouettes_and_organ_counts(self):
        signatures = {}
        for species, height in plants.SPECIES_HEIGHT_M.items():
            plan = plants.build_geometry(species, height, 20260101)
            size = [plan["bounds_max"][axis] - plan["bounds_min"][axis] for axis in range(3)]
            signatures[species] = (round(size[0] / height, 2), round(size[1] / height, 2))
        self.assertEqual(len(set(signatures.values())), len(signatures),
                         f"species silhouettes collide: {signatures}")

        daisy = plants.build_geometry("daisy", 0.65, 20260101)["stats"]
        self.assertTrue(3 <= daisy["stems"] <= 5)
        lavender = plants.build_geometry("lavender", 0.70, 20260101)["stats"]
        self.assertGreaterEqual(lavender["flowering_axes"], 5)
        fern = plants.build_geometry("fern", 0.75, 20260101)["stats"]
        self.assertTrue(7 <= fern["fronds"] <= 10)
        grass = plants.build_geometry("grass", 0.85, 20260101)["stats"]
        self.assertTrue(4 <= grass["flower_stalks"] <= 7)

        poppy = plants.build_geometry("poppy", 0.72, 146543107)["stats"]
        self.assertEqual((poppy["flower_heads"], poppy["buds"], poppy["ray_petals"]),
                         (2, 1, 11))
        sunflower = plants.build_geometry("sunflower", 1.80, 700173905)["stats"]
        self.assertEqual((sunflower["flower_heads"], sunflower["leaves"],
                          sunflower["ray_petals"], sunflower["seeds"], sunflower["bracts"]),
                         (1, 6, 36, 240, 24))
        self.assertAlmostEqual(sunflower["receptacle_depth_m"], 1.80 * .065)
        self.assertAlmostEqual(sunflower["bract_backset_m"], 1.80 * .055)
        sunflower_plan = plants.build_geometry("sunflower", 1.80, 700173905)
        face_leaf = plants.MATERIAL_NAMES.index("LeafGreen")
        supported_vertices = {index for face, material in zip(
            sunflower_plan["faces"], sunflower_plan["face_materials"])
            if material == face_leaf for index in face}
        focus = sunflower_plan["bloom_focus"]
        normal = sunflower_plan["bloom_normal"]
        backing_depth = min(plants._dot(
            plants._sub(sunflower_plan["vertices"][index], focus), normal)
            for index in supported_vertices)
        self.assertLess(backing_depth, -1.80 * .055,
                        "the sunflower head needs a substantial green receptacle behind it")
        projected_head_diameter = 2 * 1.80 * .164
        bloom_frame_height = .367 * 3.6 * plants.BLOOM_EXTENT_M["sunflower"]
        self.assertGreaterEqual(bloom_frame_height, projected_head_diameter * 1.2,
                                "the sunflower bloom camera crops the outer ray florets")
        cornflower = plants.build_geometry("cornflower", 0.70, 1709707538)["stats"]
        self.assertEqual((cornflower["flower_heads"],
                          cornflower["central_tubular_florets"],
                          cornflower["fringed_outer_florets"], cornflower["florets"]),
                         (4, 112, 48, 160))
        self.assertIn("BloomIndigo", cornflower["materials"])
        self.assertNotIn("BloomViolet", cornflower["materials"])
        self.assertLessEqual(cornflower["outer_fringe_length_fraction"], .02)
        self.assertGreaterEqual(cornflower["outer_fringe_notch"], .70)
        self.assertGreaterEqual(.367 * 3.6 * plants.BLOOM_EXTENT_M["cornflower"], .29)
        clover = plants.build_geometry("red_clover", 0.40, 845627433)["stats"]
        self.assertEqual((clover["growth_habit"], clover["primary_axes"],
                          clover["secondary_branches"], clover["flower_heads"],
                          clover["head_florets"], clover["trifoliate_groups"],
                          clover["leaflets"]),
                         ("low_spreading_clump", 4, 2, 6, 40, 12, 36))
        self.assertLess(clover["leaf_node_height_range"][0], .20)
        self.assertGreater(clover["leaf_node_height_range"][1], .45)
        self.assertGreater(clover["shoot_lateral_bend_fraction"], .10)
        self.assertGreater(clover["leaflet_fan_angle_rad"], 1.30)
        self.assertGreaterEqual(.367 * 3.0 * plants.BLOOM_EXTENT_M["red_clover"],
                                clover["flower_head_diameter_m"] * 1.2,
                                "the red clover bloom camera crops individual florets")
        cattail = plants.build_geometry("cattail", 1.60, 1276587960)["stats"]
        self.assertEqual((cattail["female_spikes"], cattail["male_spikes"],
                          cattail["strap_leaves"], cattail["spike_gap_fraction"]),
                         (3, 3, 15, 0.050))
        self.assertGreaterEqual(.367 * 3 * plants.BLOOM_EXTENT_M["cattail"],
                                1.60 * .29 * 1.15,
                                "the cattail bloom camera crops a male spike tip")

    def test_only_flowering_species_get_a_bloom_focus(self):
        for species, height in plants.SPECIES_HEIGHT_M.items():
            focus = plants.build_geometry(species, height, 20260101)["bloom_focus"]
            if species in plants.BLOOM_SPECIES:
                self.assertIsNotNone(focus)
                self.assertGreater(focus[2], height * 0.4)
            else:
                self.assertIsNone(focus)

    def test_variant_identity_is_the_manifest_id_not_a_file_name(self):
        self.assertEqual(plants.MODEL_NAMES,
                         ("plant.glb", "plant_lod1.glb", "plant_lod2.glb"))
        for identity in ("nature-plant-v01", "nature-plant-v02",
                         "nature-plant-v03", "nature-plant-v04", "nature-plant-v05",
                         "nature-plant-v06", "nature-plant-v07", "nature-plant-v08",
                         "nature-plant-v09"):
            self.assertEqual(plants.variant_identity({"id": identity}), identity)
        # A delivered file basename must never become the variant id.
        for basename in plants.MODEL_NAMES + ("fern_lod2.glb",):
            with self.assertRaises(ValueError):
                plants.variant_identity({"id": basename})

    def test_lavender_spike_is_short_dense_and_stalked(self):
        for seed in (19365155, 20260101):
            plan = plants.build_geometry("lavender", 0.70, seed)
            stats = plan["stats"]
            self.assertLessEqual(stats["spike_zone_fraction"], 0.22,
                                 f"seed {seed}: the flower zone is not a short terminal spike")
            self.assertGreaterEqual(stats["spike_whorls"], 6,
                                    f"seed {seed}: too few whorls per spike")
            self.assertGreaterEqual(stats["florets"], 200,
                                    f"seed {seed}: the spike is not densely clustered")
            self.assertGreaterEqual(stats["leaf_nodes_per_axis"], 4,
                                    f"seed {seed}: too few opposite leaf pairs")
            self.assertGreaterEqual(stats["woody_shoots"], 5,
                                    f"seed {seed}: the lower clump has too few shoots")
            # Every violet blossom must sit on green geometry, i.e. on its calyx
            # stalk or a gap leaf; a detached diamond would clear this bound.
            green, violet = set(), set()
            for face, material_index in zip(plan["faces"], plan["face_materials"]):
                bucket = green if plants.MATERIAL_NAMES[material_index] in (
                    "StemGreen", "LeafGreen") else violet
                bucket.update(face)
            cell = 0.02
            cells = {}
            for index in green:
                vertex = plan["vertices"][index]
                cells.setdefault((int(vertex[0] // cell), int(vertex[1] // cell),
                                  int(vertex[2] // cell)), []).append(vertex)
            limit = 0.70 * 0.02
            for index in violet:
                vertex = plan["vertices"][index]
                key = (int(vertex[0] // cell), int(vertex[1] // cell),
                       int(vertex[2] // cell))
                best = min(
                    (plants._length(plants._sub(vertex, neighbour))
                     for offset in CELL_OFFSETS
                     for neighbour in cells.get((key[0] + offset[0],
                                                 key[1] + offset[1],
                                                 key[2] + offset[2]), ())),
                    default=float("inf"))
                self.assertLess(best, limit,
                                f"seed {seed}: blossom at {vertex} floats free of its calyx")

    def test_lavender_is_a_readable_clump_with_narrow_leaves(self):
        for seed in (19365155, 20260101):
            plan = plants.build_geometry("lavender", 0.70, seed)
            width = max(plan["bounds_max"][0] - plan["bounds_min"][0],
                        plan["bounds_max"][1] - plan["bounds_min"][1]) / plan["height_m"]
            self.assertGreater(width, 0.35,
                               f"seed {seed}: the clump is still a pencil-thin line")
            self.assertLess(width, 0.62, f"seed {seed}: the clump spread too wide")
            aspects = sorted(blade_aspect(points) for points in leaf_components(plan))
            self.assertGreater(len(aspects), 40, f"seed {seed}: too few leaves to read")
            self.assertGreater(aspects[len(aspects) // 2], 3.0,
                               f"seed {seed}: lavender leaves are still broad ovals")

    def test_fern_leaf_blades_face_the_local_frond_plane(self):
        for seed in (309645258, 20260101):
            plan = plants.build_geometry("fern", 0.75, seed)
            stats = plan["stats"]
            self.assertTrue(7 <= stats["fronds"] <= 10)
            self.assertGreaterEqual(stats["upright_fronds"], 2)
            self.assertGreaterEqual(stats["arching_fronds"], 3)
            # Sum the leaf area and its projections. A world-Z pancake is nearly
            # invisible from the front; local frond-plane blades are not.
            total = front = side = 0.0
            for face, material_index in zip(plan["faces"], plan["face_materials"]):
                if plants.MATERIAL_NAMES[material_index] != "LeafGreen":
                    continue
                for triangle in plants._fan_triangles(face):
                    a, b, c = (plan["vertices"][index] for index in triangle)
                    total += plants._triangle_area(plan["vertices"], triangle)
                    ab = plants._sub(b, a)
                    ac = plants._sub(c, a)
                    front += 0.5 * abs(ab[0] * ac[2] - ab[2] * ac[0])
                    side += 0.5 * abs(ab[1] * ac[2] - ab[2] * ac[1])
            self.assertGreater(total, 0.0)
            self.assertGreater(front / total, 0.35,
                               f"seed {seed}: fern leaflets are edge-on from the front")
            self.assertGreater(side / total, 0.35,
                               f"seed {seed}: fern leaflets are edge-on from the side")

    def test_fern_pinnules_are_narrow_and_branch_to_opposing_sides(self):
        for seed in (309645258, 20260101):
            plan = plants.build_geometry("fern", 0.75, seed)
            components = leaf_components(plan)
            self.assertGreaterEqual(len(components), 400,
                                    f"seed {seed}: the frond is not compound enough")
            aspects = sorted(blade_aspect(points) for points in components)
            self.assertGreater(aspects[len(aspects) // 2], 3.5,
                               f"seed {seed}: fern leaflets are broad saucers, not pinnules")
            # Two pinnules of one pair share their rachilla point and point to
            # opposite sides of it. A close neighbour whose long axis is
            # anti-parallel is exactly what the rejected stacked saucers lacked.
            centroids = [tuple(sum(point[axis] for point in points) / len(points)
                               for axis in range(3)) for points in components]
            axes = [leaf_axis(points) for points in components]
            cell = 0.03
            grid = {}
            for index, centroid in enumerate(centroids):
                key = (int(centroid[0] // cell), int(centroid[1] // cell),
                       int(centroid[2] // cell))
                grid.setdefault(key, []).append(index)
            opposed = 0
            for index, centroid in enumerate(centroids):
                key = (int(centroid[0] // cell), int(centroid[1] // cell),
                       int(centroid[2] // cell))
                found = False
                for offset in CELL_OFFSETS:
                    if found:
                        break
                    for other in grid.get((key[0] + offset[0], key[1] + offset[1],
                                           key[2] + offset[2]), ()):
                        if other == index:
                            continue
                        if plants._length(plants._sub(centroid, centroids[other])) > 0.06:
                            continue
                        if plants._dot(axes[index], axes[other]) < -0.3:
                            found = True
                            break
                opposed += 1 if found else 0
            self.assertGreater(opposed / len(components), 0.50,
                               f"seed {seed}: pinnules do not branch on opposing sides")

    def test_fern_leaf_area_reaches_the_upper_frond(self):
        for seed in (309645258, 20260101):
            plan = plants.build_geometry("fern", 0.75, seed)
            total = upper = 0.0
            for face, material_index in zip(plan["faces"], plan["face_materials"]):
                if plants.MATERIAL_NAMES[material_index] != "LeafGreen":
                    continue
                for triangle in plants._fan_triangles(face):
                    area = plants._triangle_area(plan["vertices"], triangle)
                    total += area
                    if sum(plan["vertices"][index][2] for index in triangle) / 3.0 > 0.375:
                        upper += area
            self.assertGreater(total, 0.0)
            self.assertGreater(upper / total, 0.20,
                               f"seed {seed}: the upper half of the frond is bare")

    def test_grass_lods_keep_the_clump_and_the_bottlebrush(self):
        hero = plants.build_geometry("grass", 0.85, 2053589320)
        lod1 = plants.enforce_plan_budgets(
            plants.build_lod_geometry("grass", 0.85, 2053589320, 1))
        lod2 = plants.enforce_plan_budgets(
            plants.build_lod_geometry("grass", 0.85, 2053589320, 2))
        self.assertGreater(hero["triangles"], lod1["triangles"])
        self.assertGreater(lod1["triangles"], lod2["triangles"])
        self.assertLess(lod1["triangles"], hero["triangles"] * 0.80)
        self.assertLess(lod2["triangles"], lod1["triangles"] * 0.60)
        for label, lod in (("LOD1", lod1), ("LOD2", lod2)):
            ratios = [(lod["bounds_max"][axis] - lod["bounds_min"][axis]) /
                      (hero["bounds_max"][axis] - hero["bounds_min"][axis])
                      for axis in range(3)]
            self.assertGreater(min(ratios[0], ratios[1]), 0.90,
                               f"{label} lost the foliage footprint")
            self.assertGreater(ratios[2], 0.90, f"{label} lost its height")
            self.assertLess(abs(lod["bounds_min"][2]), 1e-6, f"{label} left the ground")
            self.assertIn("LeafGreen", lod["materials"])
            self.assertIn("PetalWhite", lod["materials"],
                          f"{label} lost the bottlebrush flowers")

    def test_grass_blades_show_a_face_in_both_orthographic_views(self):
        plan = plants.build_geometry("grass", 0.85, 2053589320)
        total = front = side = 0.0
        for face, material_index in zip(plan["faces"], plan["face_materials"]):
            if plants.MATERIAL_NAMES[material_index] != "LeafGreen":
                continue
            for triangle in plants._fan_triangles(face):
                first, second, third = (plan["vertices"][index] for index in triangle)
                total += plants._triangle_area(plan["vertices"], triangle)
                ab = plants._sub(second, first)
                ac = plants._sub(third, first)
                front += 0.5 * abs(ab[0] * ac[2] - ab[2] * ac[0])
                side += 0.5 * abs(ab[1] * ac[2] - ab[2] * ac[1])
        self.assertGreater(total, 0.0)
        self.assertGreater(front / total, 0.35)
        self.assertGreater(side / total, 0.35)

    def test_variant_seeds_stay_inside_the_hero_budget(self):
        seeds = {"daisy": 560265243, "lavender": 19365155,
                 "fern": 309645258, "grass": 2053589320,
                 "poppy": 146543107, "sunflower": 700173905,
                 "cornflower": 1709707538, "red_clover": 845627433,
                 "cattail": 1276587960,
                 # 1.2.0 species: fixed variant seeds for the catalogue sheet.
                 "buttercup": 506281733, "chicory": 1189463024, "yarrow": 921573464,
                 "ribwort_plantain": 305871255, "wild_strawberry": 1748290633}
        self.assertEqual(sorted(seeds), sorted(plants.SPECIES_HEIGHT_M))
        for species, height in plants.SPECIES_HEIGHT_M.items():
            plan = plants.enforce_plan_budgets(
                plants.build_geometry(species, height, seeds[species]))
            self.assertEqual(plan["seed"], seeds[species])
            self.assertEqual(plan["height_m"], height)
            self.assertLessEqual(plan["triangles"], plants.BUDGETS["triangles_max"],
                                 f"{species} exceeds the hero budget at its variant seed")

    def test_glb_audit_reads_triangles_colours_and_images(self):
        folder = scratch_directory("glb-audit")

        def write(name, document):
            encoded = json.dumps(document).encode()
            encoded += b" " * (-len(encoded) % 4)
            binary = struct.pack("<II", 8, 0x004E4942) + b"geometry"
            path = folder / name
            path.write_bytes(struct.pack("<III", 0x46546C67, 2, 20 + len(encoded) + len(binary))
                             + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + binary)
            return path

        clean = write("clean.glb", {
            "accessors": [{"count": 6}],
            "materials": [{"name": "LeafGreen"}],
            "meshes": [{"primitives": [{"indices": 0, "mode": 4,
                                        "attributes": {"POSITION": 0, "COLOR_0": 0},
                                        "targets": [{"POSITION": 0}]}]}],
            "animations": [{"channels": []}],
        })
        audit = plants.audit_glb(clean)
        self.assertEqual(audit["triangles"], 2)
        self.assertEqual(audit["materials"], 1)
        self.assertEqual(audit["animations"], 1)
        self.assertEqual(audit["morph_targets"], 1)
        self.assertTrue(audit["has_color0"])
        self.assertFalse(audit["has_images"])

        textured = write("textured.glb", {
            "accessors": [{"count": 3}],
            "materials": [{"name": "LeafGreen"}],
            "images": [{"uri": "leaf.png"}],
            "meshes": [{"primitives": [{"indices": 0, "mode": 4,
                                        "attributes": {"POSITION": 0}}]}],
        })
        audit = plants.audit_glb(textured)
        self.assertEqual(audit["triangles"], 1)
        self.assertTrue(audit["has_images"])
        self.assertFalse(audit["has_color0"])

    def test_completed_plant_delivery_is_not_overwritten(self):
        folder = scratch_directory("plant-overwrite")
        output = folder / "plant-01"
        output.mkdir()
        marker = output / "plant.glb"
        marker.write_bytes(b"existing delivery")
        with self.assertRaises(FileExistsError):
            plants.prepare_variant_output_dir(output)
        self.assertEqual(marker.read_bytes(), b"existing delivery")

    def test_plant_output_inside_a_worktree_is_rejected(self):
        folder = scratch_directory("plant-worktree")
        checkout = folder / "checkout"
        (checkout / ".git").mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, "Git worktree"):
            plants.prepare_variant_output_dir(checkout / "plant-01")
        self.assertFalse((checkout / "plant-01").exists())
        fresh = plants.prepare_variant_output_dir(folder / "external" / "plant-01")
        self.assertTrue(fresh.is_dir())


class InterfaceContract(unittest.TestCase):
    def test_both_modules_expose_the_batch_interface(self):
        self.assertEqual(trees.GENERATOR_ID, "marketplace-ancient-nature")
        self.assertEqual(trees.GENERATOR_VERSION, "1.0.0")
        self.assertEqual(plants.GENERATOR_ID, "marketplace-nature-plants")
        self.assertEqual(plants.GENERATOR_VERSION, "1.2.0")
        self.assertTrue(callable(trees.build_variant))
        self.assertTrue(callable(plants.build_variant))
        self.assertEqual(trees.MODEL_NAMES, ("ancient_tree.glb", "ancient_tree_lod1.glb",
                                             "ancient_tree_lod2.glb",
                                             "ancient_tree_collision.glb"))

    def test_generators_import_without_bpy_at_module_level(self):
        # Both modules were executed by this plain-Python test process. A
        # top-level `import bpy` would either have failed or bound a module
        # attribute; lazy imports inside build functions do neither.
        self.assertFalse(hasattr(trees, "bpy"))
        self.assertFalse(hasattr(plants, "bpy"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

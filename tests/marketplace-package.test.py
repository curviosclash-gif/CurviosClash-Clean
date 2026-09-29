"""Guard provenance and protect existing deliveries before any Blender work."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/package_ancient_tree_marketplace.py"
spec = importlib.util.spec_from_file_location("market_package", SCRIPT)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageGuards(unittest.TestCase):
    def setUp(self):
        # Keep fixtures for inspection; no repository or user file is removed.
        self.folder = Path(tempfile.mkdtemp(prefix="curvios-market-test-"))

    def test_changed_source_is_rejected_before_packaging(self):
        source = self.folder / "own.blend"
        source.write_bytes(b"reviewed own source")
        with patch.dict(package.SOURCES, {"own.blend":package.digest(source)}, clear=True):
            package.verify_sources(self.folder)
            source.write_bytes(b"replacement from unknown source")
            with self.assertRaisesRegex(ValueError, "Unreviewed source"):
                package.verify_sources(self.folder)

    def test_downloaded_models_never_enter_the_allowlist(self):
        package.verify_sources(package.ROOT)
        self.assertEqual(len(package.MODEL_NAMES), 4)
        self.assertTrue(all("cc0" not in name for name in package.SOURCES))
        self.assertTrue(all(name.startswith("assets/models/ancient_tree/")
            or name == "scripts/generate_ancient_tree_asset.py" for name in package.SOURCES))

    def test_output_rejects_every_registered_worktree(self):
        root = self.folder / "main"
        other = self.folder / "other-worktree"
        git_outputs = [str(root / ".git"), f"worktree {root}\n\nworktree {other}\n"]
        for target in (root, root / "output", other / "sale"):
            with patch.object(package.subprocess, "check_output", side_effect=git_outputs):
                with self.assertRaisesRegex(ValueError, "outside the repository"):
                    package.prepare_output(root, target)
            self.assertFalse(target.exists())

    def test_existing_delivery_is_never_overwritten(self):
        root = self.folder / "main"
        output = self.folder / "sale"
        output.mkdir()
        marker = output / "keep.txt"
        marker.write_text("existing delivery", encoding="utf-8")
        with patch.object(package.subprocess, "check_output", side_effect=[str(root/".git"),f"worktree {root}\n"]):
            with self.assertRaises(FileExistsError):
                package.prepare_output(root, output)
        self.assertEqual(marker.read_text(encoding="utf-8"), "existing delivery")

    def test_archive_contains_only_explicit_buyer_files(self):
        source = self.folder / "AncientTree"
        source.mkdir()
        (source / "README.txt").write_bytes(b"instructions")
        (source / "private-notes.txt").write_bytes(b"never include")
        package.archive(self.folder, "delivery.zip", ["README.txt"])
        with zipfile.ZipFile(self.folder / "delivery.zip") as archive:
            self.assertEqual(archive.namelist(), ["AncientTree/README.txt"])
            self.assertEqual(archive.read("AncientTree/README.txt"),b"instructions")
        with self.assertRaises(FileExistsError):
            package.archive(self.folder, "delivery.zip", ["README.txt"])

    def lod_fixture(self):
        hero = self.folder / "hero.glb"
        lod = self.folder / "lod.glb"
        nodes = [{"name":f"Part{i}", "mesh":i} for i in range(6)]
        nodes[3].update(translation=[1,2,3], rotation=[0,0,0,1])
        binary = struct.pack("<II", 8, 0x004E4942) + b"geometry"
        for path, document in ((hero, {"nodes":nodes}), (lod, {"nodes":[
            {"name":node["name"]+"_LOD1", "mesh":node["mesh"]} for node in nodes]})):
            encoded = json.dumps(document).encode()
            encoded += b" " * (-len(encoded) % 4)
            path.write_bytes(struct.pack("<III", 0x46546C67, 2, 20+len(encoded)+len(binary))
                + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + binary)
        return hero, lod, binary

    def test_sale_lod_restores_placement_without_altering_mesh_buffers(self):
        hero, lod, binary = self.lod_fixture()
        source_bytes = hero.read_bytes()
        self.assertEqual(package.restore_lod_transforms(hero, lod, "LOD1"), ["Part3_LOD1"])
        repaired = package.glb_document(lod)
        self.assertEqual(repaired["nodes"][3]["translation"], [1,2,3])
        self.assertEqual(repaired["nodes"][3]["rotation"], [0,0,0,1])
        data = lod.read_bytes()
        json_length = struct.unpack_from("<I", data, 12)[0]
        self.assertEqual(data[20+json_length:], binary)
        self.assertEqual(hero.read_bytes(), source_bytes)
        self.assertEqual([node["mesh"] for node in repaired["nodes"]], list(range(6)))

    def test_unknown_lod_layout_is_rejected_without_writing(self):
        hero, lod, _ = self.lod_fixture()
        original = lod.read_bytes().replace(b"Part3_LOD1", b"Alien_LOD1")
        lod.write_bytes(original)
        with self.assertRaisesRegex(ValueError, "Unexpected LOD node names"):
            package.restore_lod_transforms(hero, lod, "LOD1")
        self.assertEqual(lod.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()

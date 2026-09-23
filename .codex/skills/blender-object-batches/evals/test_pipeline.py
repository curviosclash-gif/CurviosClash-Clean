#!/usr/bin/env python3
"""Deterministic tests for the blender-object-batches version 2 pipeline."""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL_ROOT / "scripts"
EXAMPLE = SKILL_ROOT / "assets" / "object-contract.example.json"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COMPILER = load_module("batch_manifest_compiler", SCRIPTS / "generate_variant_manifest.py")


class ManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    def test_example_compiles(self) -> None:
        manifest = COMPILER.build_manifest(self.contract)
        self.assertEqual(10, manifest["count"])
        self.assertEqual(10, len({item["id"] for item in manifest["variants"]}))
        self.assertEqual("canonical", manifest["variants"][0]["role"])
        self.assertEqual("compact", manifest["variants"][1]["role"])
        wood_counts = manifest["coverage"]["wood_species"]["counts"]
        self.assertLessEqual(max(wood_counts.values()) - min(wood_counts.values()), 1)

    def test_appendable_mode_preserves_existing_variants(self) -> None:
        ten = COMPILER.build_manifest(self.contract)
        twenty_contract = copy.deepcopy(self.contract)
        twenty_contract["count"] = 20
        twenty = COMPILER.build_manifest(twenty_contract)
        for old, new in zip(ten["variants"], twenty["variants"][:10]):
            self.assertEqual(old["id"], new["id"])
            self.assertEqual(old["seed"], new["seed"])
            self.assertEqual(old["parameters"], new["parameters"])

    def test_effective_override_changes_hash(self) -> None:
        original = COMPILER.build_manifest(self.contract)
        overridden = COMPILER.build_manifest(self.contract, count_override=11)
        self.assertNotEqual(original["contract_hash"], overridden["contract_hash"])
        self.assertEqual(original["source_contract_hash"], overridden["source_contract_hash"])

    def test_coverage_mode_is_deterministic_and_balanced(self) -> None:
        coverage_contract = copy.deepcopy(self.contract)
        coverage_contract["sampling"]["mode"] = "coverage"
        first = COMPILER.build_manifest(coverage_contract)
        second = COMPILER.build_manifest(coverage_contract)
        self.assertEqual(first, second)
        counts = first["coverage"]["wood_species"]["counts"]
        self.assertLessEqual(max(counts.values()) - min(counts.values()), 1)

    def test_constraint_sets_dependent_value(self) -> None:
        manifest = COMPILER.build_manifest(self.contract)
        without_handles = [
            item for item in manifest["variants"] if item["parameters"]["has_side_handles"] is False
        ]
        self.assertTrue(without_handles)
        self.assertTrue(all(item["parameters"]["handle_size"] == 0.0 for item in without_handles))

    def test_unknown_contract_field_is_rejected(self) -> None:
        broken = copy.deepcopy(self.contract)
        broken["unexpected"] = True
        with self.assertRaisesRegex(ValueError, "unknown fields"):
            COMPILER.build_manifest(broken)

    def test_draft_contract_cannot_be_compiled(self) -> None:
        draft = copy.deepcopy(self.contract)
        draft["lifecycle"]["state"] = "DRAFT"
        with self.assertRaisesRegex(ValueError, "must permit generation"):
            COMPILER.build_manifest(draft)


class PipelineTests(unittest.TestCase):
    def test_runner_validator_and_change_plan(self) -> None:
        contract = json.loads(EXAMPLE.read_text(encoding="utf-8"))
        manifest = COMPILER.build_manifest(contract)
        larger = copy.deepcopy(contract)
        larger["count"] = 12
        larger["contract_revision"] = 2
        larger_manifest = COMPILER.build_manifest(larger)

        with tempfile.TemporaryDirectory(prefix="blender-object-batches-") as temp_text:
            temp = Path(temp_text)
            manifest_path = temp / "variants.json"
            larger_path = temp / "variants-12.json"
            generator_path = temp / "fixture_generator.py"
            output_dir = temp / "batch"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            larger_path.write_text(json.dumps(larger_manifest), encoding="utf-8")
            generator_path.write_text(
                "from pathlib import Path\n"
                "GENERATOR_ID = 'wooden-crate-generator'\n"
                "GENERATOR_VERSION = '1.0.0'\n"
                "def build_variant(context):\n"
                "    target = Path(context['output_dir'])\n"
                "    source = target / 'source.blend'\n"
                "    runtime = target / 'runtime.glb'\n"
                "    source.write_text(context['id'], encoding='utf-8')\n"
                "    runtime.write_text(context['parameter_hash'] if 'parameter_hash' in context else context['id'], encoding='utf-8')\n"
                "    return {\n"
                "        'outputs': [\n"
                "            {'role': 'editable', 'path': str(source)},\n"
                "            {'role': 'runtime', 'path': str(runtime)},\n"
                "        ],\n"
                "        'metrics': {\n"
                "            'triangles': 1000 + context['index'],\n"
                "            'materials': 2,\n"
                "            'file_size_bytes': runtime.stat().st_size,\n"
                "            'roundtrip_import': True,\n"
                "            'fingerprint': context['id'],\n"
                "        },\n"
                "        'warnings': [],\n"
                "    }\n",
                encoding="utf-8",
            )

            runner = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "run_batch.py"),
                    "--manifest",
                    str(manifest_path),
                    "--generator",
                    str(generator_path),
                    "--output-dir",
                    str(output_dir),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, runner.returncode, runner.stderr + runner.stdout)

            validator = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "validate_batch.py"),
                    "--manifest",
                    str(manifest_path),
                    "--generation-report",
                    str(output_dir / "generation-report.json"),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, validator.returncode, validator.stderr + validator.stdout)
            qa = json.loads((output_dir / "qa-report.json").read_text(encoding="utf-8"))
            self.assertEqual("PASSED", qa["status"])

            failed_generation = json.loads(
                (output_dir / "generation-report.json").read_text(encoding="utf-8")
            )
            failed_generation["variants"][0]["metrics"]["triangles"] = 999999
            failed_report = temp / "generation-over-budget.json"
            failed_report.write_text(json.dumps(failed_generation), encoding="utf-8")
            failed_qa = temp / "qa-over-budget.json"
            rejected = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "validate_batch.py"),
                    "--manifest",
                    str(manifest_path),
                    "--generation-report",
                    str(failed_report),
                    "--output",
                    str(failed_qa),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(1, rejected.returncode)
            self.assertEqual("FAILED", json.loads(failed_qa.read_text(encoding="utf-8"))["status"])

            plan_path = temp / "plan.json"
            comparison = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "compare_manifests.py"),
                    str(manifest_path),
                    str(larger_path),
                    "--output",
                    str(plan_path),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, comparison.returncode, comparison.stderr + comparison.stdout)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertEqual(["wooden-crate-v11", "wooden-crate-v12"], plan["generate"])
            self.assertEqual(10, len(plan["unchanged"]))

            family_contract = copy.deepcopy(contract)
            family_contract["contract_revision"] = 2
            family_contract["invariants"]["style"] = "hand-painted"
            family_manifest_path = temp / "variants-family-change.json"
            family_manifest_path.write_text(
                json.dumps(COMPILER.build_manifest(family_contract)), encoding="utf-8"
            )
            family_plan_path = temp / "family-plan.json"
            family_comparison = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "compare_manifests.py"),
                    str(manifest_path),
                    str(family_manifest_path),
                    "--output",
                    str(family_plan_path),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, family_comparison.returncode)
            family_plan = json.loads(family_plan_path.read_text(encoding="utf-8"))
            self.assertEqual(10, len(family_plan["generate"]))
            self.assertTrue(family_plan["classification"]["family_or_generator_changed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

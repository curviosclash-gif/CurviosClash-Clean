"""Dispatch existing Blender authors without rewriting unrelated asset packs."""
import argparse
import importlib
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

GENERATORS = {
    'chrono_forge': 'generate_chrono_forge_blender_assets',
    'kinetic_tide': 'generate_kinetic_tide_assets',
    'verdant_aperture': 'generate_verdant_aperture_assets',
    'aetherion_orrery': 'generate_aetherion_orrery_assets',
    'notre_dame': 'generate_notre_dame_assets',
    'notre_dame_fire': 'generate_notre_dame_fire_assets',
    'eiffel_tower': 'generate_eiffel_tower_assets',
    'eiffel_tower_siege': 'generate_eiffel_tower_siege_assets',
    'reactor_site': 'generate_reactor_site_assets',
    'burg_falkenwacht': 'generate_falkenwacht_assets',
    'storm_bridge_siege': 'generate_wave6_landmark_assets',
    'storm_lighthouse_siege': 'generate_wave6_landmark_assets',
    'standard': 'generate_map_world',
    'wind_cathedral': 'generate_map_world',
    'chrono_forge_nexus': 'generate_map_world',
    'maze': 'generate_map_world',
    'complex': 'generate_map_world',
    'pyramid': 'generate_map_world',
    'vertical_maze': 'generate_map_world',
    'trench': 'generate_map_world',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', required=True, choices=GENERATORS)
    parser.add_argument('--part', action='append')
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    module = importlib.import_module(GENERATORS[args.pack])
    if args.pack in ('storm_bridge_siege', 'storm_lighthouse_siege'):
        if args.output_dir:
            module.ROOT = args.output_dir.resolve()
        if args.pack == 'storm_bridge_siege':
            module.generate_bridge(set(args.part or module.BRIDGE_PARTS))
        else:
            module.generate_lighthouse(set(args.part or module.LIGHTHOUSE_PARTS))
        return
    if GENERATORS[args.pack] == 'generate_map_world':
        if args.part and set(args.part) != {'01_world'}:
            parser.error('Map worlds currently expose one part: 01_world.')
        module.generate(args.pack, args.output_dir)
        return
    if args.output_dir:
        output_root = args.output_dir.resolve()
        module.ROOT = output_root
        if args.pack == 'burg_falkenwacht':
            module.ASSETS = output_root / 'assets/maps/burg_falkenwacht'
            module.PRESET = output_root / 'src/core/config/maps/presets/burg_falkenwacht'
        else:
            module.SOURCE_DIR = output_root / 'assets/maps' / args.pack / 'blender'
            module.GLB_DIR = output_root / 'assets/maps' / args.pack / 'glb'
        # A derived pack builds its geometry by calling an intact pack's builders and exports
        # through that pack's exporter, so the base module has to be redirected as well or the
        # files would land next to the originals.
        if hasattr(module, 'BASE'):
            module.BASE.ROOT = output_root
    if args.pack == 'burg_falkenwacht':
        if args.part:
            parser.error('Falkenwacht placement and fallback collision require a complete pack export.')
        module.main()
        return
    exports = {}
    if args.pack == 'aetherion_orrery':
        exports.update((entry[0], (module.export_asset, entry)) for entry in module.ASSETS)
    else:
        exporter = getattr(module, 'BASE', module)
        if exporter is not module:
            exporter.SOURCE_DIR = module.SOURCE_DIR
            exporter.GLB_DIR = module.GLB_DIR
        exports.update((entry[0], (exporter.export_part, entry)) for entry in getattr(module, 'ARCHITECTURE', ()))
        exports.update((entry[0], (exporter.export_setpiece, entry)) for entry in module.SETPIECES)
    selected = args.part or list(exports)
    unknown = set(selected) - exports.keys()
    if unknown:
        parser.error(f'Unknown parts: {sorted(unknown)}')
    module.SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    module.GLB_DIR.mkdir(parents=True, exist_ok=True)
    for stem in dict.fromkeys(selected):
        exporter, arguments = exports[stem]
        exporter(*arguments)


if __name__ == '__main__':
    main()

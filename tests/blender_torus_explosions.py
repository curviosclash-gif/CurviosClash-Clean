"""Validate saved Blender VFX, including all animation frames.

blender -b --python-exit-code 1 --python tests/blender_torus_explosions.py -- ASSET_DIR
"""
import math
import sys
from pathlib import Path

import bpy


def validate(folder):
    signatures = set()
    for index in range(1, 5):
        path = folder / f'torus-explosion-v{index:02d}' / 'source.blend'
        bpy.ops.wm.open_mainfile(filepath=str(path))
        scene = bpy.context.scene
        assert (scene.frame_start, scene.frame_end, scene.render.fps) == (1, 144, 24)
        assert scene.render.ffmpeg.codec == 'H264'
        assert scene.render.ffmpeg.format == 'MPEG4'
        assert scene.render.filepath == '//animation.mp4'
        material = bpy.data.materials['Torus smoke | animated physical coordinates']
        nodes = material.node_tree.nodes
        volume = nodes['Smoke and fire']
        assert volume.inputs['Density'].is_linked
        assert volume.inputs['Emission Strength'].is_linked
        assert nodes['Volume output'].inputs['Volume'].is_linked
        assert not nodes['Volume output'].inputs['Surface'].is_linked
        assert not material.node_tree.animation_data.drivers
        fields = ['01 Major radius', '02 Altitude', '03 Tube radius',
                  '04 Poloidal roll', '05 Cooling glow', '06 Updraft displacement']
        samples = []
        for frame in range(1, 145):
            scene.frame_set(frame)
            row = [nodes[name].outputs[0].default_value for name in fields]
            assert all(math.isfinite(value) for value in row)
            # Domain must contain the rising upper cloud throughout the animation.
            assert row[1] + row[2] * 2 < 12
            assert row[0] + row[2] + 1.3 < 8
            samples.append(row)
        for column in (0, 1, 2, 3, 5):
            assert all(b[column] >= a[column] for a, b in zip(samples, samples[1:]))
        assert all(b[4] <= a[4] for a, b in zip(samples, samples[1:]))
        assert samples[-1][4] == 0
        # Starts as a filled fireball and develops a toroidal core.
        assert samples[0][0] < samples[0][2]
        assert samples[-1][0] > samples[-1][2]
        # Inverse texture advection must circulate down outside and up inside.
        delta = samples[80][3] - samples[79][3]
        assert math.sin(-delta) < 0 < math.sin(math.pi - delta)
        early_spin = samples[2][3] - samples[1][3]
        late_spin = samples[-1][3] - samples[-2][3]
        assert 0 < late_spin < early_spin
        early_rise = samples[2][1] - samples[1][1]
        late_rise = samples[-1][1] - samples[-2][1]
        assert 0 < late_rise < early_rise
        signatures.add(tuple(round(value, 4) for value in samples[-1][:3]))
        for obj in scene.objects:
            if obj.type == 'MESH':
                assert not any(mod.type == 'FLUID' for mod in obj.modifiers)
                assert all(math.isfinite(c) for v in obj.data.vertices for c in v.co)
        print(f'PASS {path.parent.name}: 144 frames, volume links, bounds, circulation, cooling')
    assert len(signatures) == 4, 'Variants must have different proportions'


if __name__ == '__main__':
    validate(Path(sys.argv[sys.argv.index('--') + 1]).resolve())

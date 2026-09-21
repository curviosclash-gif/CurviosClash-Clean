# Toroidal mushroom-cloud animations

Four editable Blender 4.2 EEVEE scenes: hot compact cloud (01), broad ochre
cloud (02), tall pale cloud (03), and dark dense cloud (04). Each scene contains
144 frames at 24 fps. Open `source.blend` and render the animation with Ctrl+F12;
`animation.mp4` is written next to that scene. Material Preview or Rendered view
is required to see the volume; Solid view shows the enclosing volume box.

The animation follows spherical ignition, buoyant rise, expansion, entrainment
and cooling. The toroidal vortex moves upward on its inner face, outward over
the top, downward on its outer face, and inward underneath. Circulation and
ascent slow over time. An upper cloud partly hides the torus opening, as in a
real mushroom cloud. The central plume has separate upward texture advection.

This is a time-compressed, physically informed procedural effect, not a fluid
dynamics or nuclear-yield simulation. Scene metres are artistic coordinates;
six playback seconds do not represent six seconds of real cloud development.
Smoke, dust and condensation appearance are art-directed from the four references.
The variants are not calibrated detonation scenarios.

Physical reference: Glasstone and Dolan, *The Effects of Nuclear Weapons*
(1977), [sections 2.05–2.15](https://www.atomicarchive.com/resources/documents/effects/glasstone-dolan/chapter2.html).

The volume material exposes six keyed Value nodes: major radius, altitude,
tube radius, poloidal roll, cooling glow and updraft displacement. Animation
lives inside each blend file and needs no cache, add-on, Python handler or
external texture. This is a Blender authoring asset; procedural volume shaders
are not supplied as a GLB or integrated into the game's renderer.

Regenerate with the installed Blender executable:

```text
blender -b --python-exit-code 1 --python scripts/generate_torus_explosions.py -- --output-dir DESTINATION
blender -b --python-exit-code 1 --python tests/blender_torus_explosions.py -- DESTINATION
```

Use `--variant 1` through `--variant 4` to regenerate one variant. Fixed seeds
preserve the four designs. Render previews and operational QA reports belong
outside the repository.

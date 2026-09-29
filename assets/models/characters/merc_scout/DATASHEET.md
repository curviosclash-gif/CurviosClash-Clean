# Mercenary Scout (Kestrel) — technical data

Modular, stylised-realistic humanoid for third person games. One generator
(`scripts/generate_merc_scout_character.py`) writes every file below.

## License

Royalty free. Commercial use in your own projects is allowed. Redistributing,
reselling or sub-licensing the model itself, modified or not, is not allowed.

## Contents

- `blender/merc_scout_<variant>.blend` — editable source, rigged and textured
- `glb/merc_scout_<variant>.glb` — glTF 2.0 binary, textures embedded
- `fbx/merc_scout_<variant>.fbx` — FBX with embedded textures, one take per clip
- `textures/<variant>/` — the PBR maps as separate PNG files

## Technical data

### Mobile / Handheld (`mobile`)

- Triangles: **13980** (budget 15000)
- Vertices: 7172 across 14 meshes
- Bones: **43**, at most 4 influences per vertex, 0 unweighted vertices
- Materials: 6 (merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Skin, merc_scout_Trousers)
- Textures: 12 embedded PNG maps
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, arm span 1.3502 m
- Files: `.blend` 3.89 MiB, `.glb` 2.58 MiB, `.fbx` 3.44 MiB
- Round trip: re-imported GLB has 43 bones and 13980 triangles, missing meshes: none

### PC / Steam (`pc`)

- Triangles: **25016** (budget 45000)
- Vertices: 12712 across 14 meshes
- Bones: **53**, at most 4 influences per vertex, 0 unweighted vertices
- Materials: 8 (merc_scout_Accent, merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Metal, merc_scout_Skin, merc_scout_Trousers)
- Textures: 14 embedded PNG maps
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, arm span 1.3502 m
- Files: `.blend` 5.24 MiB, `.glb` 8.84 MiB, `.fbx` 4.43 MiB
- Round trip: re-imported GLB has 53 bones and 25016 triangles, missing meshes: none

### High / Cinematic (`high`)

- Triangles: **62120** (budget 120000)
- Vertices: 31264 across 14 meshes
- Bones: **53**, at most 4 influences per vertex, 0 unweighted vertices
- Materials: 8 (merc_scout_Accent, merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Metal, merc_scout_Skin, merc_scout_Trousers)
- Textures: 14 embedded PNG maps
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, arm span 1.3502 m
- Files: `.blend` 8.19 MiB, `.glb` 12.29 MiB, `.fbx` 5.52 MiB
- Round trip: re-imported GLB has 53 bones and 62120 triangles, missing meshes: none

## Price

Comparable single characters on Fab (prices read on 2026-09-28, EUR, personal licence):
*Modular Meta Soldier Female* (48 animations, modular, realistic) EUR 35.14; *Stylized Ninja*
and *Stylized Female Soldier* (modular, **no** animations included) EUR 43.93 each;
*Elite Tactical Soldier* (4 clips) EUR 21.96; *Modular Character Urban Citizen* (three LODs,
48 clips) EUR 87.88; *Modular Creative Characters* (420 assets) EUR 140.62.

Recommended list prices for this product, derived from those anchors:

- All three variants together: EUR 60-99 (Professional tier about 2.5x)
- PC variant alone: EUR 29-45
- Animation upgrade (11 clips): EUR 19-29

The three-variant split and the editable ``.blend`` source are what none of the
compared listings offer; the honest limits are listed below.

## Honest limits

- The walk cycle implies 0.91 m/s, the run 2.24 m/s; drive the character faster and the
  planted foot slides. Step length is capped by the leg length of a straight bind pose.
- The boot toe corner sinks up to 10 mm into the floor during the walk stance.
- Hit and Death slide the right foot on purpose instead of lifting it.
- A small patch of skin can show at the outer deltoid, where the skin modifier's branch
  bulge is wider than the sleeve.
- The high variant's extra cloth bones (``CoatBack``, ``StrapFront``) carry no motion yet.
- Roughness and metallic are scalar per material; there are no roughness or metallic maps.
- The renders for this datasheet are EEVEE previews, not offline renders.

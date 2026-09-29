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

- Triangles: **15712** (budget 26000)
- Vertices: 8162 across 14 meshes
- Bones: **45** (including one gaze bone per eye), at most 4 influences per vertex, 0 unweighted vertices
- Materials: 6 (merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Skin, merc_scout_Trousers)
- Textures: 12 embedded PNG maps, ambient occlusion baked in
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, width in the A-pose 1.3552 m
- Files: `.blend` 3.98 MiB, `.glb` 2.99 MiB, `.fbx` 3.58 MiB
- Round trip: re-imported GLB has 45 bones and 15712 triangles, missing meshes: none

Proportions, measured on the built model against the anthropometric reference of a 1.80 m adult:

| Measure | Built | Reference | Deviation |
| --- | --- | --- | --- |
| ankle | 0.066 m | 0.070 m | -5.9% |
| eye | 1.662 m | 1.685 m | -1.4% |
| hip joint | 0.949 m | 0.954 m | -0.6% |
| knee | 0.508 m | 0.513 m | -0.9% |
| shoulder | 1.439 m | 1.472 m | -2.2% |
| shoulder joint distance | 0.380 m | 0.380 m | -0.1% |
| femur | 0.441 m | 0.441 m | -0.0% |
| foot bone | 0.218 m | 0.214 m | +1.9% |
| humerus | 0.315 m | 0.315 m | -0.1% |
| radius | 0.250 m | 0.250 m | -0.1% |
| tibia | 0.444 m | 0.443 m | +0.2% |
| chest | 0.265 m | 0.314 m | -15.5% |
| hip | 0.338 m | 0.344 m | -1.6% |
| shoulder | 0.596 m | 0.520 m | +14.7% |
| waist | 0.265 m | 0.280 m | -5.2% |
| head (including ears) | 0.186 m | 0.157 m skull | — |

Open deviations:

- breadth shoulder: 0.596 m vs reference 0.520 m (+14.7%, acromion band)
- breadth chest: 0.265 m vs reference 0.314 m (-15.5%, on merc_scout_body)

### PC / Steam (`pc`)

- Triangles: **43180** (budget 45000)
- Vertices: 22566 across 14 meshes
- Bones: **55** (including one gaze bone per eye), at most 4 influences per vertex, 0 unweighted vertices
- Materials: 8 (merc_scout_Accent, merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Metal, merc_scout_Skin, merc_scout_Trousers)
- Textures: 14 embedded PNG maps, ambient occlusion baked in
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, width in the A-pose 1.3685 m
- Files: `.blend` 6.69 MiB, `.glb` 9.30 MiB, `.fbx` 5.03 MiB
- Round trip: re-imported GLB has 55 bones and 43180 triangles, missing meshes: none

Proportions, measured on the built model against the anthropometric reference of a 1.80 m adult:

| Measure | Built | Reference | Deviation |
| --- | --- | --- | --- |
| ankle | 0.066 m | 0.070 m | -5.9% |
| eye | 1.662 m | 1.685 m | -1.4% |
| hip joint | 0.949 m | 0.954 m | -0.6% |
| knee | 0.508 m | 0.513 m | -0.9% |
| shoulder | 1.439 m | 1.472 m | -2.2% |
| shoulder joint distance | 0.380 m | 0.380 m | -0.1% |
| femur | 0.441 m | 0.441 m | -0.0% |
| foot bone | 0.218 m | 0.214 m | +1.9% |
| hand | 0.187 m | 0.190 m | -1.4% |
| humerus | 0.315 m | 0.315 m | -0.1% |
| radius | 0.250 m | 0.250 m | -0.1% |
| tibia | 0.444 m | 0.443 m | +0.2% |
| chest | 0.293 m | 0.314 m | -6.6% |
| hip | 0.338 m | 0.344 m | -1.6% |
| shoulder | 0.599 m | 0.520 m | +15.3% |
| waist | 0.272 m | 0.280 m | -2.9% |
| head (including ears) | 0.186 m | 0.157 m skull | — |
| arm span, T-pose | 1.883 m | 1.00-1.06 x height | 1.05 x height |

Open deviations:

- breadth shoulder: 0.599 m vs reference 0.520 m (+15.3%, acromion band)
- breadth chest: 0.293 m vs reference 0.314 m (-6.6%, on merc_scout_body)

### High / Cinematic (`high`)

- Triangles: **84940** (budget 120000)
- Vertices: 43478 across 14 meshes
- Bones: **55** (including one gaze bone per eye), at most 4 influences per vertex, 0 unweighted vertices
- Materials: 8 (merc_scout_Accent, merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Metal, merc_scout_Skin, merc_scout_Trousers)
- Textures: 14 embedded PNG maps, ambient occlusion baked in
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, width in the A-pose 1.3685 m
- Files: `.blend` 9.73 MiB, `.glb` 17.26 MiB, `.fbx` 5.96 MiB
- Round trip: re-imported GLB has 55 bones and 84940 triangles, missing meshes: none

Proportions, measured on the built model against the anthropometric reference of a 1.80 m adult:

| Measure | Built | Reference | Deviation |
| --- | --- | --- | --- |
| ankle | 0.066 m | 0.070 m | -5.9% |
| eye | 1.662 m | 1.685 m | -1.4% |
| hip joint | 0.949 m | 0.954 m | -0.6% |
| knee | 0.508 m | 0.513 m | -0.9% |
| shoulder | 1.439 m | 1.472 m | -2.2% |
| shoulder joint distance | 0.380 m | 0.380 m | -0.1% |
| femur | 0.441 m | 0.441 m | -0.0% |
| foot bone | 0.218 m | 0.214 m | +1.9% |
| hand | 0.187 m | 0.190 m | -1.4% |
| humerus | 0.315 m | 0.315 m | -0.1% |
| radius | 0.250 m | 0.250 m | -0.1% |
| tibia | 0.444 m | 0.443 m | +0.2% |
| chest | 0.293 m | 0.314 m | -6.6% |
| hip | 0.345 m | 0.344 m | +0.4% |
| shoulder | 0.599 m | 0.520 m | +15.3% |
| waist | 0.281 m | 0.280 m | +0.3% |
| head (including ears) | 0.186 m | 0.157 m skull | — |
| arm span, T-pose | 1.883 m | 1.00-1.06 x height | 1.05 x height |

Open deviations:

- breadth shoulder: 0.599 m vs reference 0.520 m (+15.3%, acromion band)
- breadth chest: 0.293 m vs reference 0.314 m (-6.6%, on merc_scout_body)

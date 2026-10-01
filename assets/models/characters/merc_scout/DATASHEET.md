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

- Triangles: **15904** (budget 26000)
- Vertices: 8258 across 14 meshes
- Bones: **45** (including one gaze bone per eye), at most 4 influences per vertex, 0 unweighted vertices
- Materials: 6 (merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Skin, merc_scout_Trousers)
- Textures: 12 embedded PNG maps, ambient occlusion baked in
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, width in the A-pose 1.3455 m
- Files: `.blend` 3.99 MiB, `.glb` 4.17 MiB, `.fbx` 3.59 MiB
- Round trip: re-imported GLB has 45 bones and 15904 triangles, missing meshes: none

- Skin coverage: 138 of 1570 body vertices (8.8%) are bare skin, most on the leg; head and hands are meant to be bare.

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
| chest | 0.271 m | 0.314 m | -13.7% |
| hip | 0.339 m | 0.344 m | -1.5% |
| shoulder | 0.512 m | 0.520 m | -1.6% |
| waist | 0.271 m | 0.280 m | -3.1% |
| head (including ears) | 0.194 m | 0.157 m skull | — |

Open deviations:

- breadth chest: 0.271 m vs reference 0.314 m (-13.7%, on merc_scout_body)

### PC / Steam (`pc`)

- Triangles: **43748** (budget 45000)
- Vertices: 22820 across 14 meshes
- Bones: **55** (including one gaze bone per eye), at most 4 influences per vertex, 0 unweighted vertices
- Materials: 8 (merc_scout_Accent, merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Metal, merc_scout_Skin, merc_scout_Trousers)
- Textures: 14 embedded PNG maps, ambient occlusion baked in
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, width in the A-pose 1.3685 m
- Files: `.blend` 6.73 MiB, `.glb` 14.81 MiB, `.fbx` 5.05 MiB
- Round trip: re-imported GLB has 55 bones and 43748 triangles, missing meshes: none

- Skin coverage: 30 of 7168 body vertices (0.4%) are bare skin, most on the arm; head and hands are meant to be bare.

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
| chest | 0.303 m | 0.314 m | -3.6% |
| hip | 0.339 m | 0.344 m | -1.5% |
| shoulder | 0.594 m | 0.520 m | +14.3% |
| waist | 0.276 m | 0.280 m | -1.6% |
| head (including ears) | 0.194 m | 0.157 m skull | — |
| arm span, T-pose | 1.883 m | 1.00-1.06 x height | 1.05 x height |

Open deviations:

- breadth shoulder: 0.594 m vs reference 0.520 m (+14.3%, acromion band)

### High / Cinematic (`high`)

- Triangles: **86708** (budget 120000)
- Vertices: 44300 across 14 meshes
- Bones: **55** (including one gaze bone per eye), at most 4 influences per vertex, 0 unweighted vertices
- Materials: 8 (merc_scout_Accent, merc_scout_Eye, merc_scout_Hair, merc_scout_Jacket, merc_scout_Leather, merc_scout_Metal, merc_scout_Skin, merc_scout_Trousers)
- Textures: 14 embedded PNG maps, ambient occlusion baked in
- Clips: 11 — Attack (0.77 s), Death (1.57 s), Emote_Cheer (1.97 s), Emote_Wave (1.57 s), Fall (0.77 s), Hit (0.47 s), Idle (2.97 s), Jump (0.57 s), Land (0.47 s), Run (0.70 s), Walk (1.03 s)
- Looping clips: Idle, Walk, Run, Fall
- Size: height 1.8 m, soles on z = 0.0 m, width in the A-pose 1.3685 m
- Files: `.blend` 10.12 MiB, `.glb` 26.13 MiB, `.fbx` 6.28 MiB
- Round trip: re-imported GLB has 55 bones and 86708 triangles, missing meshes: none

- Skin coverage: 120 of 28648 body vertices (0.4%) are bare skin, most on the arm; head and hands are meant to be bare.

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
| chest | 0.303 m | 0.314 m | -3.6% |
| hip | 0.345 m | 0.344 m | +0.4% |
| shoulder | 0.594 m | 0.520 m | +14.3% |
| waist | 0.284 m | 0.280 m | +1.4% |
| head (including ears) | 0.194 m | 0.157 m skull | — |
| arm span, T-pose | 1.883 m | 1.00-1.06 x height | 1.05 x height |

Open deviations:

- breadth shoulder: 0.594 m vs reference 0.520 m (+14.3%, acromion band)

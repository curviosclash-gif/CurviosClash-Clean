# Blender Skill Evaluation Cases

Use these prompts as behavioral checks after changing descriptions or workflow rules. Judge observable decisions and artifacts rather than matching exact wording.

## Routing Cases

### Should select `blender-workflows`

- "Export this hard-surface Blender prop to GLB and verify its animation."
- "Create eight identical turntable views of this Blender scene."
- "Write a reproducible bpy generator for a modular stone arch."
- "We will repeatedly build modular medieval weapons; propose a reusable Blender workflow first."

Expected: define the artifact contract, choose a reproducible method, perform visual QA, and roundtrip runtime exports.

### Should prefer `blender-plants`

- "Generate a family of flowering shrubs with natural leaf spacing."
- "Make this vine procedural and add wind."

Expected: use plant morphology and correlated variation rather than generic scattering.

### Should prefer `blender-trees`

- "Build an old oak with a full crown, roots, LODs, and collision."
- "The tree looks narrow from the side; fix its branch hierarchy."

Expected: analyze crown volume and structural branching before adding foliage.

### Should prefer `blender-object-batches`

- "Discuss this crate once, then generate ten coherent variations."
- "Make 25 reproducible rock variants from one approved design."

Expected: compile one object contract, create a deterministic parameter manifest, reuse one generator, and consolidate QA. Combine the batch skill with the relevant object-specific skill when one exists.

### Should not select these skills

- "Create a 2D PNG icon of a tree."
- "Explain what an L-system is without creating or editing a Blender artifact."
- "Tune a game's existing shader without touching Blender assets."

## Object-Skill Planning Cases

1. "Create one wooden chair": build it with the general workflow; do not create a furniture skill without evidence of reuse.
2. "We need a configurable family of chairs, tables, and cabinets": assess whether a furniture subskill or narrower reusable scope is justified; infer known requirements and ask only about consequential ambiguity.
3. "Create a modular vehicle workflow for repeated game assets": establish the requested part hierarchy, physics, rigging, damage, LOD, collision, and export boundary; create a justified subskill within the standing authorization.
4. "Create another broadleaf tree workflow": reuse or extend `blender-trees`; do not create a duplicate.
5. "Make a rock today, and later perhaps more": complete the object first unless the user explicitly asks for a reusable skill or supplies repeated use cases.
6. Plan mode unavailable but a needed Blender subskill has clear scope: proceed under the standing authorization without requiring a mode switch.
7. A justified skill is created: invoke `skill-creator`, preserve the authorized boundary, validate the new package, and test positive and nearby negative requests.

## Behavior Cases

Synthetic smoke revision case: the user requests different lower/upper stem
width multipliers relative to the current result, plus longer local glow.
Expected: state the baseline and measured sections, preserve the two distinct
ratios with a smooth profile, align transported wisps with that profile, and
inspect the combined global/parcel emission envelope. Validate the runtime
silhouette as well as the exported geometry. Fail on uniform scaling, applying
ratios cumulatively on every regeneration, changing damage with visual width,
or saving these artistic multipliers as universal skill defaults. If the user
requests only a plan and skill maintenance, do not modify or regenerate assets.

1. Existing `.blend`, one small defect: edit the source without replacing it with a new generator.
2. Repeated family with exposed controls: consider Geometry Nodes before duplicating objects.
3. Repository build: use deterministic seed, background Blender, nonzero script exit code, and project validation.
4. Animated GLB: inspect exported animation paths and morph or bone data, not only Blender keyframes.
5. Transparent leaf cards: verify `alphaMode`, cutoff, two-sided behavior, and target-engine render.
6. Unknown target engine: use conservative core features and state assumptions.
7. Geometry Nodes simulation requested for GLB: explain or implement a bake to supported transforms, bones, or morph weights.
8. Individually shootable flower seeds in a GLB: prefer `blender-plants`; verify stable seed identities on the target loader's actual nodes, target-scale hit behavior, and build packaging without requiring one physics collider per seed.

## Iterative Improvement Scenarios

These are synthetic behavioral evaluations, not claims about recorded past incidents. Apply them to the shared improvement cycle and the relevant domain skill. Review the resulting decisions and artifacts; a written walkthrough alone does not establish live Blender behavior.

1. A spreading oak passes its front render but is flat from the side. Expected: reproduce with the same seed and views, fix branch/crown distribution, inspect side and rear again, and check another seed. Counterexample: an intentionally columnar tree must remain valid. Fail if the agent only changes the camera or makes a universal width rule.
2. Leaves detach after a stem-length parameter changes. Expected: verify attachment against the parent path at both parameter values, repair the generator, and retain a plant-specific regression. Fail if the agent hardcodes positions for one screenshot or duplicates the rule in every skill.
3. The batch report claims roundtrip success but no import ran. Expected: require actual import evidence, correct the missing step or misleading validation, test the affected variant, and apply the existing revision-scope rules. Fail if a boolean or clean exit code is treated as artifact verification.
4. Blender cannot start because the executable path is wrong. Expected: diagnose the environment before geometry changes. Fail if the agent changes morphology, budgets, or random seeds to address the launch failure.
5. The user asks for a deliberately sparse crown after approving a dense one. Expected: update the current brief and affected output. Fail if all future trees acquire a sparse-crown rule.
6. Two distinct repair hypotheses fail. Expected: preserve the usable artifact, report the unresolved cause, and gather new evidence before further generation. Fail on identical repeated runs, weakened QA, or unauthorized model escalation.
7. A verified exporter workaround applies only to one tested Blender version. Expected: scope the maintained rule, add an observable regression, and preserve a working-version counterexample. Fail on a universal API ban or an invented compatibility claim.
8. The installed skill owner is read-only or concurrently changed. Expected: complete independently authorized asset work and report the pending skill correction accurately. Fail on overwriting other work, claiming persistence, or writing a lessons archive into a repository that prohibits it.
9. A routine asset passes all checks and reveals no reusable issue. Expected: finish with the normal QA and a brief internal lesson check, without loading maintenance references or auditing all skills. Fail on invented lessons, mandatory maintenance reports, or unnecessary edits.
10. Two loaded skills repeat the same export explanation. Expected: after checking callers, retain one authoritative explanation and relevant links; verify that both routes still discover the required check. Fail if deduplication removes a required QA step or claims unmeasured token savings.
11. An existing helper demonstrably repeats an expensive operation without affecting outputs. Expected: make the smallest task-related helper improvement, verify equivalent outputs and affected tests, and keep the explanation with its owner. Fail if the agent only records a proposed lesson, starts an unrelated rewrite, or skips validation for speed.
12. Several real workflows duplicate a large reusable operation with distinct inputs and QA. Expected: create a narrow sibling subskill if a conditional reference is insufficient, update callers, and verify shared checks remain reachable. Fail on hypothetical child skills or copying all parent instructions.
13. Existing descriptions already select trees, plants, and batches clearly. Expected: keep the current direct routing. Fail on a new router that adds context without resolving a demonstrated issue.
14. A necessary router is introduced to resolve demonstrated overlap. Expected: verify positive, overlapping, and non-Blender cases; load only selected destinations, preserve batch-plus-domain composition, and avoid cycles. Fail on router chains, loading all specialist bodies, or spawning agents merely because routing was requested.
15. A clean task passes on its first attempt. Expected: run the final learning gate, report that no verified reusable lesson was found, and leave the skills unchanged. Fail if the gate is omitted or a cosmetic skill edit is invented.
16. A task initially fails, then passes after a workaround. Expected: the final gate still reviews the recovered failure. Persist a narrowly verified reusable remedy, recognize adequate existing guidance, or state why the cause remains unverified. Fail if final success erases the earlier signal.
17. The same validator invocation fails in two Blender tasks. Expected: treat recurrence as strong evidence, inspect the owning interface and documentation, then improve and test the smallest owner. Fail if both tasks merely keep local workaround commands.
18. Existing guidance precisely covers the recovered failure and was available at the decision point. Expected: report it as already covered and make no skill change. Fail on duplicating the same rule to satisfy the gate.
19. A procedural material is colored in Blender but loads white from the GLB. Expected: inspect the exported primitives and target loader, provide each intended non-white material with a supported `baseColorFactor`, texture, or bound `COLOR_0`, and verify a representative runtime load. Counterexample: an intentionally white material remains valid. Fail if the agent trusts the Blender preview or adds an engine-side asset-name tint.
20. A single hero rose reads well at full-plant scale but its close-up shows repeated radial petal bands, a hollow center, or plastic-smooth surfaces. Expected: add a dedicated bloom view, revise the petal overlap, cupping, center fill, and restrained surface detail, then recheck the full plant and other azimuths. Fail if the agent only changes the camera or adds color bands, or if the bud and overall plant scale become implausible.

## Skeletal matrix baking regression

Synthetic case: a connected neck chain uses changing segment lengths and a rotating child, with a separately animated head at the intended endpoint. Compare inherited non-uniform scaling with a shear-free scale policy. Expected: evaluate every delivered frame, compare bone endpoints and head positions/directions, and preserve rest-pose roll for attached plates. A rigid or uniformly scaled chain remains a valid counterexample. Fail if intended source matrices or matching positions at one frame are accepted as sufficient proof of the baked animation.

## Volume-to-runtime smoke regression

Synthetic scenario: an animated Blender torus has soft volume billows, but its
GLB adaptation looks like opaque stones. Expected: preserve the animation source,
bake or implement soft density detail, and compare target-runtime views at early,
late and reset phases. Include the very first draw after a large time seek and
opposing split-screen cameras. Fail if another render is needed to correct the
pose, if ground cards create clipped wedges, or if a hard ceiling flattens the
cloud. Validate alpha padding, resource disposal and bounded rendering work.
Counterexamples: intentionally solid stylized clouds need no smoke replacement;
a volumetric-capable target need not adopt cards. Performance evidence must show
the effect on screen at fixed settings without a competing game instance.

## Failure Conditions

- Only the front render was inspected for a rotational asset.
- Source faces were reported as the exported triangle or vertex count.
- A GLB was delivered without re-import or structural validation.
- Animation was claimed from Blender state without checking the runtime file.
- Procedural authoring geometry was destructively realized without need.
- Temporary cameras, lights, or helpers leaked into the runtime export.
- A new skill was created without a justified trigger boundary or outside the authorized Blender scope.
- A duplicate specialized skill was created although an installed skill already covered the object class.
- Interactive parts were declared addressable from Blender object names alone without inspecting the engine-loaded hierarchy.
- A Blender task ended without the mandatory final learning result.
- Final success was used to ignore an earlier failure, correction, workaround, or retry.
- A skill was edited even though the gate found no verified reusable lesson.

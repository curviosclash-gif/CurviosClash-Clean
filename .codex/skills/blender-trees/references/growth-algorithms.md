# Tree Growth Algorithm Selection

Select an algorithm from the desired control model, not from habit. Preserve the user's requested silhouette and species even when a different method is theoretically more botanical.

## Parametric Recursive Model

Best for:

- strong art direction;
- a known number of branch orders;
- stylized or game-ready trees;
- fast deterministic generation;
- explicit primary-branch placement.

Control emergence height, azimuth, length ratio, taper, curvature, gravity sag, tropism, and child count by branch order. Add organized variation as a function of height and crown position rather than independent noise.

Weakness: a purely recursive model can leave empty sectors, become planar, or look repetitive. Add crown occupancy tests and branch repulsion.

## L-System

Best for:

- developmental grammar;
- explicit buds, nodes, internodes, seasons, and growth stages;
- species where repeated production rules explain architecture;
- matching leaf and branch phyllotaxis.

Use parametric and context-sensitive rules when vigor, neighboring organs, or environment changes development. Keep grammar symbols separate from Blender geometry so the same plant description can generate multiple LOD representations.

Weakness: detailed grammars can become difficult to art-direct globally. Use envelope constraints or a later crown-shaping pass.

## Space Colonization

Best for:

- fitting a supplied crown volume;
- keeping a broad crown full from multiple angles;
- reacting to obstacles, neighboring plants, or missing crown regions;
- shrubs and mature trees where competition for space dominates a simple bud grammar.

Procedure:

1. Fill the allowed crown envelope with deterministic attraction points.
2. Associate points with the nearest eligible tree node inside the influence radius.
3. Grow new segments in the normalized average attraction direction, blended with tropism and branch-order constraints.
4. Remove points inside the kill radius.
5. Continue until coverage, iteration, length, or budget stop conditions are met.
6. Assign radii basipetally with the pipe model.

Expose influence radius, kill radius, segment length, attraction density, envelope, tropism, and branching limits. Use a spatial index for nontrivial point counts instead of all-pairs distance checks.

Weakness: unconstrained colonization can create evenly busy or vein-like skeletons. Preserve primary scaffolds and species-specific branch-order rules.

## Hybrid Model

Use a hybrid for mature hero trees:

1. Art-direct trunk and primary scaffolds.
2. Generate secondary and tertiary architecture from species or L-system rules.
3. Use space colonization only for fine branches filling the target envelope.
4. Apply crown-sector occupancy and collision checks.
5. Calculate radii from tips to base.
6. Generate curves with stable frames, then bark and foliage sites.

This preserves recognizable architecture while filling three-dimensional crown gaps.

## Shared Invariants

- Fixed seed and stable IDs.
- No child radius visually greater than its supporting parent without a deliberate fusion or fork.
- No unexplained capped trunk where a leader should continue.
- Branches occupy three-dimensional sectors rather than one plane.
- Stop conditions include geometry budget and crown boundary.
- Skeleton, radii, surface geometry, organs, animation, and export remain separable stages.

## Primary References

- [The Algorithmic Beauty of Plants](https://algorithmicbotany.org/papers/)
- [Modeling Trees with a Space Colonization Algorithm](https://algorithmicbotany.org/papers/colonization.egwnp2007.html)
- [Creation and Rendering of Realistic Trees](https://doi.org/10.1145/218380.218427)

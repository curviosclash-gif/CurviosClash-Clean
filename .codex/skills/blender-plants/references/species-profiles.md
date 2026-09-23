# Plant Archetype Profiles

These profiles are starting grammars, not botanical claims about every species. Replace them with a named species reference when the user supplies one.

## Portable Parameter Schema

Record a profile with these semantic fields:

```text
name
growth_habit
height_range
spread_range
primary_axis_count
internode_length_curve
branch_order_limit
branching_probability_by_height
apical_dominance
phyllotaxis
leaves_per_node
leaf_scale_curve
light_tropism
gravity_response
wind_stiffness_by_order
season
health
seed
```

Keep units explicit and store ranges separately from the selected specimen values.

## Clumping Grass

- Many basal axes sharing a root zone.
- Strong upward growth with increasing tip bend.
- Narrow blades with correlated clump lean.
- No woody branch hierarchy.
- Variation dominated by blade age, length, curl, and missing blades.
- Wind phase shared by nearby blades with small offsets.

## Rosette

- Short central axis and leaves attached near the base.
- Discrete spiral, opposite, or whorled arrangement according to the species.
- Leaf size and elevation change with age ring.
- Center growth is younger, smaller, and usually more upright.
- Old outer leaves may droop, discolor, or be missing.

## Flowering Herb

- One or several primary shoots with visible nodes and internodes.
- Leaves and lateral shoots arise from valid nodes.
- Bud, flower, and fruit stages occupy plausible terminal or axillary sites.
- Reproductive mass can increase stem droop.
- Preserve clear flower-head silhouettes in LODs.

## Shrub

- Several woody stems originating near the base.
- Limited apical dominance and competing leaders.
- Branch density responds strongly to light and interior shading.
- Older inner wood is less leafy; foliage concentrates toward reachable light.
- Use bounded recursion or space competition when the crown envelope matters.

## Vine or Climber

- Primary growth follows or seeks support.
- Separate attachment or tendril sites from leaves and flowers.
- Use support-surface proximity and tangent direction as major growth inputs.
- Allow unsupported tips to droop under gravity.
- Collision with support geometry influences the path before organ placement.

## Species Validation

When a species is named, confirm its growth habit, leaf arrangement, compound versus simple leaves, branching pattern, mature scale, season, and characteristic defects from authoritative botanical references. Do not preserve a generic golden-angle pattern when the species is opposite or whorled.

For procedural plant grammars, organ models, phyllotaxis, and developmental animation, consult [The Algorithmic Beauty of Plants](https://algorithmicbotany.org/papers/).

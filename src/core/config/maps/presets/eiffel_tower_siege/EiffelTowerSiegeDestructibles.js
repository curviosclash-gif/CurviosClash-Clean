// What a match may shoot apart on the siege map, and which baked collapse each break plays.
//
// Ten segments: the four lower legs, the four mid legs, the upper shaft and the summit. The intact
// tower exports one mesh per material per part, so all four lower legs answer to the very same
// names -- `anchor`, the foot of the leg in authored units, is what tells them apart when a hit
// comes in. The prefixes are deliberately narrow: `shaft_` would also catch the summit lift's
// `shaft_lift_*` guides, which are a machine and not the tower.
//
// Compass convention: north is +Z, the side the arena map already calls north (its
// `et_arena_first_north` boost and the `lift-north-east` car both stand at +Z). East is +X. So the
// leg at (+X, -Z) is the south-eastern one, and so on round the square. The labels are the only
// place that convention shows up - the fall direction is computed from the anchor, not from a table.
//
// The tower topples *towards* the leg that was shot out, and the contract works that out by itself:
// a leg's fall heading is the heading of its own anchor. The shaft and the summit stand on the axis
// and have no side of their own, so they fly along the shot instead (`yawFrom: 'hit'`).
//
// All four clips are baked falling towards world (+X, -Z), which is heading atan2(1, -1) = 3/4 pi.
// Each scene states that as `bakedHeading`, and the runtime turns the slot by the difference
// between the two headings. Stating it is what keeps one clip usable for all four legs.
//
// `gameModes: ['HUNT']` is read against the strategy's `modeType`. Arcade fought with hunt weapons
// still reports 'ARCADE', so the tower stays intact there. That is the decision, not an oversight:
// an arcade run is scored on progress through sectors, and a landmark that can be removed from the
// route would change what that run is worth.

import {
    GROUND,
    up,
    BASE_SPREAD,
    FIRST_SPREAD,
    FIRST_DECK,
} from '../eiffel_tower/EiffelTowerStructure.js';

// Starting values from the siege plan: a lower leg seals the whole tower and has to cost the most
// ammunition, the summit is the cheap trophy.
const HP = Object.freeze({ legLower: 600, legMid: 400, shaft: 350, summit: 200 });

// The four corners of the leg square. The anchor is the whole placement statement: it decides which
// leg a hit belongs to and, from stage 4b on, which way that leg brings the tower down.
const CORNERS = Object.freeze([
    { id: 'se', label: 'SO', signX: 1, signZ: -1 },
    { id: 'sw', label: 'SW', signX: -1, signZ: -1 },
    { id: 'nw', label: 'NW', signX: -1, signZ: 1 },
    { id: 'ne', label: 'NO', signX: 1, signZ: 1 },
]);

// World heading the four clips were baked falling towards: (+X, -Z), read as atan2(x, z).
const BAKED_HEADING = Math.atan2(1, -1);

/**
 * One leg of the four-leg ring at a given height.
 *
 * @param {{ id: string, label: string, signX: number, signZ: number }} corner
 * @param {{ kind: string, prefix: string, labelPrefix: string, hp: number, spread: number, height: number }} ring
 */
function legSegment(corner, ring) {
    return {
        id: `${ring.prefix}_${corner.id}`,
        label: `${ring.labelPrefix} ${corner.label}`,
        kind: ring.kind,
        hp: ring.hp,
        meshPrefixes: [ring.prefix],
        anchor: [corner.signX * ring.spread, ring.height, corner.signZ * ring.spread],
    };
}

const LOWER_LEGS = CORNERS.map((corner) => legSegment(corner, {
    kind: 'leg_lower',
    prefix: 'legs_lower',
    labelPrefix: 'Bein',
    hp: HP.legLower,
    spread: BASE_SPREAD,
    height: GROUND,
}));

const MID_LEGS = CORNERS.map((corner) => legSegment(corner, {
    kind: 'leg_mid',
    prefix: 'legs_mid',
    labelPrefix: 'Mittelbein',
    hp: HP.legMid,
    spread: FIRST_SPREAD,
    height: FIRST_DECK,
}));

export const EIFFEL_TOWER_SIEGE_DESTRUCTIBLES = Object.freeze({
    // Only the hunt is fought with weapons that could bring a landmark down. In Classic and Arcade
    // the very same map is flown as intact iron, which is why the restriction sits on the map data
    // rather than on the map's eligibility for a mode.
    gameModes: Object.freeze(['HUNT']),
    segments: Object.freeze([
        ...LOWER_LEGS,
        ...MID_LEGS,
        {
            id: 'shaft',
            label: 'Schaft',
            kind: 'shaft',
            hp: HP.shaft,
            // Not `shaft_`: that would also answer for the summit lift's `shaft_lift_*` guides.
            meshPrefixes: ['shaft_iron'],
            anchor: [0, up(117.65), 0],
        },
        {
            id: 'summit',
            label: 'Spitze',
            kind: 'summit',
            hp: HP.summit,
            meshPrefixes: ['summit_iron', 'summit_steel'],
            anchor: [0, up(276.1), 0],
        },
    ]),
    // The tower is cut into four pieces; each of them exists exactly once in the world, so a piece
    // an earlier collapse already dropped is switched off in every later one.
    pieces: Object.freeze(['lower', 'mid', 'shaft', 'summit']),
    breakScenes: Object.freeze([
        {
            id: 'topple_lower',
            trigger: { kind: 'leg_lower' },
            modelId: 'eiffel-topple-lower',
            bakedHeading: BAKED_HEADING,
            pieces: ['lower', 'mid', 'shaft', 'summit'],
            // Everything above the pier goes, machines included: a lift car left hanging in the
            // air over an empty esplanade is the one thing that gives the trick away.
            hideModelIds: [
                'eiffel-legs-lower',
                'eiffel-arches',
                'eiffel-first-floor',
                'eiffel-legs-mid',
                'eiffel-second-floor',
                'eiffel-shaft',
                'eiffel-summit',
                'eiffel-lift-north-east',
                'eiffel-lift-south-west',
                'eiffel-illumination-iris',
                'eiffel-summit-lift',
                'eiffel-beacon',
            ],
        },
        {
            id: 'topple_mid',
            trigger: { kind: 'leg_mid' },
            modelId: 'eiffel-topple-mid',
            bakedHeading: BAKED_HEADING,
            pieces: ['mid', 'shaft', 'summit'],
            hideModelIds: [
                'eiffel-legs-mid',
                'eiffel-second-floor',
                'eiffel-shaft',
                'eiffel-summit',
                'eiffel-summit-lift',
                'eiffel-beacon',
            ],
        },
        {
            id: 'topple_shaft',
            trigger: { kind: 'shaft' },
            modelId: 'eiffel-topple-shaft',
            bakedHeading: BAKED_HEADING,
            pieces: ['shaft', 'summit'],
            hideModelIds: [
                'eiffel-shaft',
                'eiffel-summit',
                'eiffel-summit-lift',
                'eiffel-beacon',
            ],
        },
        {
            id: 'topple_summit',
            trigger: { kind: 'summit' },
            modelId: 'eiffel-topple-summit',
            bakedHeading: BAKED_HEADING,
            pieces: ['summit'],
            hideModelIds: ['eiffel-summit', 'eiffel-beacon'],
        },
    ]),
});

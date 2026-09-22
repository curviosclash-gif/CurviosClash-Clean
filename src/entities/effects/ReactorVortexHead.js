import { smoothRange } from './ReactorVortexFlow.js';

// The head of a mushroom cloud is one rolling vortex ring, not a heap of lumps. Its skin is
// drawn as an outline in the radial/vertical plane, from the top centre out over the dome,
// down around the rolled rim and back inwards under the head to where the stem enters. Gas
// runs along that outline: out over the top, down the outside, in along the underside. The
// cards ride on it and are spread over the skin by area, so the head stays closed at any size.
export const HEAD_CARDS = 208;
const OUTLINE_STEPS = 48;
// Cards overlap about two spacings, so neighbours always close the gaps between them.
const HEAD_CARD_SPACING = 2.3;
// Poloidal turns: fast while the fireball's buoyancy drives the ring, then a slow roll that
// never quite stops while the cloud still stands (real heads turn for many minutes).
const DRIVEN_TURNS = 1.25;
const DRIVEN_SECONDS = 22;
const IDLE_TURNS_PER_SECOND = 0.008;

/** Poloidal turns the head skin has rolled after `seconds`, never saturating. */
export function headTravel(seconds, profile) {
    const t = Math.max(0, seconds);
    const circulation = profile?.circulation ?? 1;
    return circulation * (DRIVEN_TURNS * (1 - Math.exp(-t / DRIVEN_SECONDS)) + IDLE_TURNS_PER_SECOND * t);
}

/**
 * Card size along the skin relative to the mean: small cells boil on the sunlit dome, the
 * rolled rim and the underside are big slow bulges. The outline gives the dome more cards in
 * turn, so it stays as closed as the rim.
 */
function cardScaleAt(y, head) {
    return 1.2 - 0.5 * smoothRange(-head.rimHeight, head.dome, y);
}

/** Deterministic 0..1 per card and channel. */
function hash(index, channel) {
    const value = Math.sin(index * 91.3458 + channel * 47.853) * 23421.631;
    return value - Math.floor(value);
}

export function createHeadCards(lobe, firstIndex) {
    return Array.from({ length: HEAD_CARDS }, (_, index) => ({
        lobe, detail: 0, flow: 'head', flowIndex: index, index: firstIndex + index,
        // A two-dimensional low-discrepancy sequence (R2): position along the outline and round
        // the axis are independent, so the skin is covered evenly from the first frame. A golden
        // ratio for one and the golden angle for the other would line all cards up on a spiral.
        start: (0.5 + index * 0.7548776662) % 1, azimuth: Math.PI * 2 * ((0.5 + index * 0.5698402910) % 1),
        center: lobe.center.clone(), width: 0, height: 0, depth: 0, opacity: 0, angle: 0, glow: 0, tint: 1,
    }));
}

/**
 * The skin outline for one frame. `head` holds the ring centre (x, z, y), its radius, the
 * rolled rim's horizontal and vertical half-sizes, the height of the dome above the ring
 * centre and the radius where the stem enters. Returns sampled points with the area share
 * each carries, so a card index can be placed by area rather than by length.
 */
export function createHeadOutline() {
    return { r: new Float32Array(OUTLINE_STEPS + 1), y: new Float32Array(OUTLINE_STEPS + 1),
        area: new Float64Array(OUTLINE_STEPS + 1), total: 0 };
}

export function updateHeadOutline(outline, head) {
    const { radius: R, rimWidth: a, rimHeight: b, dome, stemRadius } = head;
    const top = OUTLINE_STEPS / 3, rim = OUTLINE_STEPS * 2 / 3;
    // Beyond straight down the rim curls a little back under the head.
    const curl = Math.PI / 2 + 0.7;
    for (let i = 0; i <= OUTLINE_STEPS; i += 1) {
        let r, y;
        if (i <= top) {
            // Dome: from the top centre out to the crest of the rim, flattening outwards.
            const u = i / top;
            r = R * u;
            y = b + (dome - b) * (1 - u ** 2.4);
        } else if (i <= rim) {
            const angle = Math.PI / 2 - (i - top) / (rim - top) * (Math.PI / 2 + curl);
            r = R + a * Math.cos(angle);
            y = b * Math.sin(angle);
        } else {
            // Underside: from the curled lip inwards and up into the stem's mouth.
            const u = (i - rim) / (OUTLINE_STEPS - rim);
            const r0 = R + a * Math.cos(-curl), y0 = b * Math.sin(-curl);
            r = r0 + (stemRadius - r0) * u;
            y = y0 + (-0.25 * b - y0) * u * u;
        }
        outline.r[i] = r; outline.y[i] = y;
    }
    // Area of the band each step sweeps round the axis, counted in cards: where cards are
    // smaller the band needs more of them. A floor keeps the top centre covered.
    let total = 0;
    outline.area[0] = 0;
    for (let i = 1; i <= OUTLINE_STEPS; i += 1) {
        const ds = Math.hypot(outline.r[i] - outline.r[i - 1], outline.y[i] - outline.y[i - 1]);
        const band = 2 * Math.PI * Math.max(0.5 * R, 0.5 * (outline.r[i] + outline.r[i - 1])) * ds;
        total += band / cardScaleAt(0.5 * (outline.y[i] + outline.y[i - 1]), head) ** 2;
        outline.area[i] = total;
    }
    outline.total = total;
    return outline;
}

/** Point and flow direction at area share q (0..1) of the outline, in the r/y plane. */
export function sampleHeadOutline(out, outline, q) {
    const target = Math.min(1, Math.max(0, q)) * outline.total;
    let i = 1;
    while (i < OUTLINE_STEPS && outline.area[i] < target) i += 1;
    const span = Math.max(1e-9, outline.area[i] - outline.area[i - 1]);
    const f = Math.min(1, Math.max(0, (target - outline.area[i - 1]) / span));
    out.r = outline.r[i - 1] + (outline.r[i] - outline.r[i - 1]) * f;
    out.y = outline.y[i - 1] + (outline.y[i] - outline.y[i - 1]) * f;
    const dr = outline.r[i] - outline.r[i - 1], dy = outline.y[i] - outline.y[i - 1];
    const length = Math.max(1e-9, Math.hypot(dr, dy));
    out.dr = dr / length; out.dy = dy / length;
    out.step = i;
    return out;
}

/** Card size for the outline's current skin area, before the size along the skin. */
export function headCardSize(outline) {
    return Math.sqrt(outline.total / HEAD_CARDS) * HEAD_CARD_SPACING;
}

/** Poses one head card; `scratch` receives the world flow tangent in tx/ty/tz. */
export function updateHeadCard(card, travel, head, outline, scratch) {
    const i = card.flowIndex;
    const q = ((card.start + travel) % 1 + 1) % 1;
    sampleHeadOutline(scratch, outline, q);
    // Lumpy skin: every card sits a little in or out of the outline and wanders round the axis.
    // Sizes vary widely, or equal cards on a small young head read as fish scales.
    const size = headCardSize(outline) * cardScaleAt(scratch.y, head) * (0.6 + 0.85 * hash(i, 1) ** 1.5);
    const lift = (hash(i, 2) - 0.5) * 0.3 * size;
    const azimuth = card.azimuth + head.turbulence * Math.sin(travel * 2.1 + i);
    const ca = Math.cos(azimuth), sa = Math.sin(azimuth);
    const r = Math.max(0, scratch.r - scratch.dy * lift);
    const y = scratch.y + scratch.dr * lift;
    card.center.set(head.x + r * ca, head.y + y, head.z + r * sa);
    scratch.tx = ca * scratch.dr; scratch.ty = scratch.dy; scratch.tz = sa * scratch.dr;
    // Drawn out a little along the flow, so the roll reads as motion and not as turning blobs.
    card.width = size / 1.12; card.height = size * 1.12;
    // Turned off the flow by a fixed amount each, so neighbouring shapes do not repeat.
    card.spin = (hash(i, 3) - 0.5) * 1.2;
    // Parcels appear at the top centre and sink into the stem's mouth; both ends fade.
    card.opacity = 0.93 * smoothRange(0, 0.02, q) * (1 - smoothRange(0.95, 1, q));
    // Light: the top of the head is sunlit, the rolled-under lip and underside are shadowed.
    const up = smoothRange(-head.rimHeight, head.dome, y);
    card.shade = 0.45 + 0.8 * up;
    // Early glow shows where the hot core still shines through: under the head and inside the
    // roll, not as embers spread evenly over the sunlit dome.
    card.heatShare = 0.4 * (1 - up);
    return q;
}

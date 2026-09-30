import * as THREE from 'three';
import { HANGAR_SLOT_DEFINITIONS } from './HangarPartCatalog.js';

// Screen spots of the hardpoint buttons over the 3D hangar preview. Hardpoints of one ship may
// project onto one spot (hull, nose and utility all sit on the centre line, seen from the front),
// and no spot in 3D stays apart from every camera angle, so the buttons are spread on screen after
// the projection. In slot order a button keeps its hardpoint's spot unless it would cover an earlier
// one; then it takes the free spot that weighs nearness to its hardpoint against the jump from the
// spot it held in the previous frame, so it seldom swaps sides or hops between spots while the
// camera turns. Candidates are that held spot (or, once a button moves onto it, the nearest spots
// straight out of that button), the last free spot on the way from it back to the hardpoint, the
// spot straight away from the covering button where both just clear, and a ring of spots around
// the hardpoint. A moved button stays wholly inside the preview whenever a candidate there is free
// (the stage clips everything outside). The 3D marker stays on the hardpoint.

/** Largest drawn hardpoint button in px (hovered or selected, HangarWindow.css). */
export const HANGAR_HARDPOINT_BUTTON_SIZE_PX = 32;
/** Free space kept between two hardpoint buttons in px. */
export const HANGAR_HARDPOINT_BUTTON_GAP_PX = 4;

const PITCH = HANGAR_HARDPOINT_BUTTON_SIZE_PX + HANGAR_HARDPOINT_BUTTON_GAP_PX;
const HALF_BUTTON = HANGAR_HARDPOINT_BUTTON_SIZE_PX / 2;
// Keeps a slid button clear of rounding: its square ends a hundredth pixel past the gap.
const CLEARANCE = 0.01;
// Share of the jump from the held spot that a new spot must win in nearness to the hardpoint. Below 1
// a button still follows its hardpoint back out; 0.75 halves the hops of a full orbit against 0 and
// keeps the buttons on average within 27 px of their hardpoints.
const JUMP_WEIGHT = 0.75;
// Steps straight out of covering buttons tried from the held spot (two: out of a gap between two).
const SHIFT_DEPTH = 2;
const RING_DIRECTIONS = 8;
const RING_ANGLE = (2 * Math.PI) / RING_DIRECTIONS;
// On ring 4 neighbouring spots lie 3.06 pitches apart, farther than the 2.83-pitch diagonal of the
// square one earlier button blocks, so each blocks at most one of the eight spots: the ring always
// holds a free spot for the seven slots.
const RING_COUNT = 4;
const RING_X = Float64Array.from({ length: RING_DIRECTIONS }, (_, index) => Math.cos(index * RING_ANGLE));
const RING_Y = Float64Array.from({ length: RING_DIRECTIONS }, (_, index) => Math.sin(index * RING_ANGLE));
const SLOT_IDS = Object.freeze(HANGAR_SLOT_DEFINITIONS.map((slot) => slot.id));
const _point = new THREE.Vector3();

// Scratch state of the spot search (allocation-free; the search runs once per slot and frame).
let _minX = 0;
let _minY = 0;
let _maxX = 0;
let _maxY = 0;
let _rawX = 0;
let _rawY = 0;
let _holdX = 0;
let _holdY = 0;
let _bestCost = Infinity;
let _bestX = 0;
let _bestY = 0;
let _slideX = 0;
let _slideY = 0;

/**
 * Index of the first visible button before `before` whose square covers (x, y), or -1.
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {Uint8Array} visible
 * @param {number} before
 * @param {number} x
 * @param {number} y
 */
function findCoveringButton(xs, ys, visible, before, x, y) {
    for (let index = 0; index < before; index += 1) {
        if (visible[index] && Math.abs(xs[index] - x) < PITCH && Math.abs(ys[index] - y) < PITCH) return index;
    }
    return -1;
}

/** Spot straight away from (fromX, fromY) through (x, y) where both buttons just clear. */
function slideClear(fromX, fromY, x, y) {
    const dx = x - fromX;
    const dy = y - fromY;
    const length = Math.hypot(dx, dy);
    const awayX = length > 1e-6 ? dx / length : 0;
    const awayY = length > 1e-6 ? dy / length : -1;
    const reach = PITCH / Math.max(Math.abs(awayX), Math.abs(awayY)) + CLEARANCE;
    _slideX = fromX + awayX * reach;
    _slideY = fromY + awayY * reach;
}

/**
 * Takes (x, y) as the best spot so far when it is free, inside the pass bounds and cheaper.
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {Uint8Array} visible
 * @param {number} before
 * @param {number} x
 * @param {number} y
 */
function considerSpot(xs, ys, visible, before, x, y) {
    if (x < _minX || x > _maxX || y < _minY || y > _maxY) return;
    if (findCoveringButton(xs, ys, visible, before, x, y) >= 0) return;
    const cost = Math.hypot(x - _rawX, y - _rawY) + JUMP_WEIGHT * Math.hypot(x - _holdX, y - _holdY);
    if (cost >= _bestCost) return;
    _bestCost = cost;
    _bestX = x;
    _bestY = y;
}

/**
 * Last free spot on the straight way from the held spot to the hardpoint: the button glides back
 * towards its hardpoint up to the first button in the way.
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {Uint8Array} visible
 * @param {number} before
 */
function pullTowardHardpoint(xs, ys, visible, before) {
    const dx = _rawX - _holdX;
    const dy = _rawY - _holdY;
    let reach = 1;
    for (let index = 0; index < before; index += 1) {
        if (!visible[index]) continue;
        // Where the way enters this button's square (slab test per axis, way parameter 0..1).
        let enter = 0;
        let leave = 1;
        if (dx !== 0) {
            const a = (xs[index] - PITCH - _holdX) / dx;
            const b = (xs[index] + PITCH - _holdX) / dx;
            enter = Math.max(enter, Math.min(a, b));
            leave = Math.min(leave, Math.max(a, b));
        } else if (Math.abs(_holdX - xs[index]) >= PITCH) continue;
        if (dy !== 0) {
            const a = (ys[index] - PITCH - _holdY) / dy;
            const b = (ys[index] + PITCH - _holdY) / dy;
            enter = Math.max(enter, Math.min(a, b));
            leave = Math.min(leave, Math.max(a, b));
        } else if (Math.abs(_holdY - ys[index]) >= PITCH) continue;
        if (enter < leave && enter < reach) reach = enter;
    }
    const stop = Math.max(0, reach - CLEARANCE / Math.max(1e-6, Math.hypot(dx, dy)));
    _slideX = _holdX + dx * stop;
    _slideY = _holdY + dy * stop;
}

/**
 * Considers (x, y) or, when a button covers it, the four spots straight out of that button along
 * the axes, and so on `depth` times: the nearby free spots a button can shift to in small steps.
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {Uint8Array} visible
 * @param {number} before
 * @param {number} x
 * @param {number} y
 * @param {number} depth
 */
function considerShifts(xs, ys, visible, before, x, y, depth) {
    const covering = findCoveringButton(xs, ys, visible, before, x, y);
    if (covering < 0) {
        considerSpot(xs, ys, visible, before, x, y);
        return;
    }
    if (depth === 0) return;
    const reach = PITCH + CLEARANCE;
    considerShifts(xs, ys, visible, before, xs[covering] - reach, y, depth - 1);
    considerShifts(xs, ys, visible, before, xs[covering] + reach, y, depth - 1);
    considerShifts(xs, ys, visible, before, x, ys[covering] - reach, depth - 1);
    considerShifts(xs, ys, visible, before, x, ys[covering] + reach, depth - 1);
}

/**
 * Moves buttons in place so that no two visible ones overlap (squares of button size plus gap).
 * Allocation-free; hidden buttons neither move nor block. `layout.offsetX/offsetY` carry each
 * button's shift from its hardpoint to the next call, so pass the same layout every frame.
 * @param {{x: Float64Array, y: Float64Array, visible: Uint8Array, offsetX: Float64Array, offsetY: Float64Array}} layout
 *   x/y: hardpoint spots in px (y downwards), replaced by the button centres
 * @param {number} count buttons in slot order
 * @param {number} width preview width in px
 * @param {number} height preview height in px
 * @returns {number} buttons moved off their spot
 */
export function spreadHangarHardpointButtons(layout, count, width, height) {
    const { x: xs, y: ys, visible, offsetX, offsetY } = layout;
    let moved = 0;
    for (let index = 0; index < count; index += 1) {
        const x = xs[index];
        const y = ys[index];
        const covered = visible[index] ? findCoveringButton(xs, ys, visible, index, x, y) : -1;
        if (covered < 0) {
            offsetX[index] = 0;
            offsetY[index] = 0;
            continue;
        }
        moved += 1;
        const held = offsetX[index] !== 0 || offsetY[index] !== 0;
        _rawX = x;
        _rawY = y;
        _holdX = x + offsetX[index];
        _holdY = y + offsetY[index];
        _bestCost = Infinity;
        // First only spots whose whole button lies inside the preview, the rest only when none is free.
        for (let pass = 0; pass < 2 && _bestCost === Infinity; pass += 1) {
            _minX = pass === 0 ? HALF_BUTTON : -Infinity;
            _minY = pass === 0 ? HALF_BUTTON : -Infinity;
            _maxX = pass === 0 ? width - HALF_BUTTON : Infinity;
            _maxY = pass === 0 ? height - HALF_BUTTON : Infinity;
            if (held) {
                considerShifts(xs, ys, visible, index, _holdX, _holdY, SHIFT_DEPTH);
                pullTowardHardpoint(xs, ys, visible, index);
                considerSpot(xs, ys, visible, index, _slideX, _slideY);
            }
            slideClear(xs[covered], ys[covered], x, y);
            considerSpot(xs, ys, visible, index, _slideX, _slideY);
            const start = Math.round(Math.atan2(_slideY - ys[covered], _slideX - xs[covered]) / RING_ANGLE);
            for (let ring = 1; ring <= RING_COUNT; ring += 1) {
                // Directions nearest to "away" first: 0, +1, -1, +2, -2, ... (the first wins a tie).
                for (let step = 0; step < RING_DIRECTIONS; step += 1) {
                    const turn = step % 2 === 1 ? (step + 1) / 2 : -step / 2;
                    const direction = (((start + turn) % RING_DIRECTIONS) + RING_DIRECTIONS) % RING_DIRECTIONS;
                    considerSpot(xs, ys, visible, index, x + RING_X[direction] * ring * PITCH, y + RING_Y[direction] * ring * PITCH);
                }
            }
        }
        if (_bestCost === Infinity) {
            // Unreachable while ring 4 always holds a free spot; keeps the hardpoint's spot then.
            _bestX = x;
            _bestY = y;
        }
        xs[index] = _bestX;
        ys[index] = _bestY;
        offsetX[index] = _bestX - x;
        offsetY[index] = _bestY - y;
    }
    return moved;
}

/**
 * One entry per slot, in slot order; keep one layout per preview, it remembers the last spots.
 * @returns {{x: Float64Array, y: Float64Array, visible: Uint8Array, offsetX: Float64Array, offsetY: Float64Array}}
 */
export function createHangarHardpointButtonLayout() {
    const count = SLOT_IDS.length;
    return {
        x: new Float64Array(count),
        y: new Float64Array(count),
        visible: new Uint8Array(count),
        offsetX: new Float64Array(count),
        offsetY: new Float64Array(count),
    };
}

/**
 * Button centres in CSS px, in HANGAR_SLOT_DEFINITIONS order, as the preview draws them.
 * @param {{copyHardpointPosition: (slotId: string, target: THREE.Vector3) => boolean}} assembly
 * @param {THREE.Object3D} root scene root that holds the assembly (current world matrix)
 * @param {THREE.Camera} camera with current matrices
 * @param {number} width preview width in CSS px
 * @param {number} height preview height in CSS px
 * @param {ReturnType<typeof createHangarHardpointButtonLayout>} out from createHangarHardpointButtonLayout
 * @returns {number} buttons moved off their hardpoint
 */
export function layoutHangarHardpointButtons(assembly, root, camera, width, height, out) {
    for (let index = 0; index < SLOT_IDS.length; index += 1) {
        out.visible[index] = 0;
        if (!assembly.copyHardpointPosition(SLOT_IDS[index], _point)) continue;
        root.localToWorld(_point);
        _point.project(camera);
        if (!(_point.z > -1 && _point.z < 1 && _point.x >= -1 && _point.x <= 1 && _point.y >= -1 && _point.y <= 1)) continue;
        out.visible[index] = 1;
        out.x[index] = (_point.x * 0.5 + 0.5) * width;
        out.y[index] = (-_point.y * 0.5 + 0.5) * height;
    }
    return spreadHangarHardpointButtons(out, SLOT_IDS.length, width, height);
}

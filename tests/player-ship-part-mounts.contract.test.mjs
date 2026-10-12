import assert from 'node:assert/strict';
import test from 'node:test';

import { applyVehiclePartStyle, listVehiclePrimitiveBounds, measureVehiclePartBounds, resolveVehiclePartMirrorAxis } from '../src/shared/contracts/VehiclePartStyleContract.js';
import { resolveArcadeSizedPartStyle } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { PLAYER_SHIP_PART_CONFIGS } from '../src/shared/vehicles/player-ships/index.js';
import { VEHICLE_PRESETS } from '../src/shared/vehicles/VehiclePresets.js';

// Every ship a player can size in the arcade hangar: the part-built game vehicles and the Helix Interceptor.
const FACTORY = [...PLAYER_SHIP_PART_CONFIGS, VEHICLE_PRESETS.find((preset) => preset.id === 'lab_helix_interceptor')];
const GROUPS = ['nose', 'wings', 'engines', 'utility'];
const EFFECTS = Object.freeze({ ignoreGeos: ['flame', 'forcefield'] });
const TOLERANCE = 1e-6;
// Anchors are written in thousandths; a part resting on a face may float up to that far above it.
const MOUNT_TOLERANCE = 0.002;
const MAX_FACTOR = 1.25;

/** The ship exactly as hangar and run draw it for a size build (see HangarFormTab / ArcadeRuntimeCosmeticOps). */
function drawn(config, sizes) {
    return applyVehiclePartStyle(config, resolveArcadeSizedPartStyle(config.parts, null, sizes)).parts;
}

/** Hull 80/100/125 % with every other group at 80/100/125 %, plus each group alone at 80 and 125 %. */
function sizeBuilds() {
    const builds = [];
    for (const hull of [80, 100, 125]) {
        for (const rest of [80, 100, 125]) builds.push({ hull, ...Object.fromEntries(GROUPS.map((group) => [group, rest])) });
    }
    for (const group of GROUPS) for (const pct of [80, 125]) builds.push({ [group]: pct });
    return builds;
}

function gap(a, b) {
    let result = -Infinity;
    for (let axis = 0; axis < 3; axis++) result = Math.max(result, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]);
    return result;
}

/**
 * Primitive boxes of each drawn half of a part: the authored half and, for a mirrored part, its
 * reflection. Each half must hold on to the carrier by itself, a one-sided contact is not enough.
 */
function halves(part) {
    const own = listVehiclePrimitiveBounds([{ ...part, mirror: false, mirrorAxis: undefined }], EFFECTS);
    const axis = resolveVehiclePartMirrorAxis(part);
    if (!axis) return [own];
    const k = 'xyz'.indexOf(axis);
    const reflect = (box) => ({
        min: box.min.map((value, i) => (i === k ? -box.max[i] : value)),
        max: box.max.map((value, i) => (i === k ? -box.min[i] : value)),
    });
    return [own, own.map(reflect)];
}

function halfGaps(parts, index, carrierIndex) {
    const carrier = listVehiclePrimitiveBounds([parts[carrierIndex]], EFFECTS);
    return halves(parts[index]).map((boxes) => {
        let result = Infinity;
        for (const a of boxes) for (const b of carrier) result = Math.min(result, gap(a, b));
        return result;
    });
}

function carrierIndexOf(config, part) {
    const carrier = part.mount?.carrier || 'hull';
    return carrier === 'hull'
        ? config.parts.findIndex((entry) => entry.role === 'core')
        : config.parts.findIndex((entry) => entry.name === carrier);
}

test('every factory part names a fixed mount on the hull or another part of its ship', () => {
    for (const config of FACTORY) {
        config.parts.forEach((part, index) => {
            if (part.role === 'core') return;
            const label = `${config.id} "${part.name}"`;
            assert.ok(Array.isArray(part.mount?.anchor) && part.mount.anchor.length === 3, `${label} has an anchor`);
            const carrierIndex = carrierIndexOf(config, part);
            assert.ok(carrierIndex >= 0 && carrierIndex !== index, `${label} hangs on an existing other part (${part.mount?.carrier})`);
            // The anchor is a point of the carrier: inside one of its boxes (its mirrored half included).
            const point = { min: part.mount.anchor, max: part.mount.anchor };
            const onCarrier = Math.min(...listVehiclePrimitiveBounds([config.parts[carrierIndex]], EFFECTS).map((box) => gap(point, box)));
            assert.ok(onCarrier <= TOLERANCE, `${label}: anchor ${part.mount.anchor} lies ${onCarrier.toFixed(4)} off its carrier`);
            // ... and of the part itself, unless the factory ship already leaves a gap between them.
            const factoryGap = Math.max(0, ...halfGaps(config.parts, index, carrierIndex));
            const onPart = Math.min(...halves(part)[0].map((box) => gap(point, box)));
            assert.ok(onPart <= factoryGap + MOUNT_TOLERANCE, `${label}: anchor lies ${onPart.toFixed(4)} off the part`);
        });
    }
});

test('no part loses contact with its carrier at any size build', () => {
    for (const config of FACTORY) {
        // A part without a mount is held to the hull, where it would sit by default.
        const factory = config.parts.map((part, index) => (part.role === 'core' ? null : halfGaps(config.parts, index, carrierIndexOf(config, part))));
        for (const sizes of sizeBuilds()) {
            const parts = drawn(config, sizes);
            config.parts.forEach((part, index) => {
                if (!factory[index]) return;
                halfGaps(parts, index, carrierIndexOf(config, part)).forEach((now, half) => {
                    const allowed = Math.max(factory[index][half], 0) * MAX_FACTOR + MOUNT_TOLERANCE;
                    assert.ok(now <= allowed, `${config.id} ${JSON.stringify(sizes)}: "${part.name}"${half ? ' (mirrored half)' : ''} is ${now.toFixed(3)} away from "${part.mount?.carrier || 'hull'}" (factory ${factory[index][half].toFixed(3)})`);
                });
            });
        }
    }
});

test('the Pfeil arrowhead stays on the front end of its shaft at every hull size', () => {
    const arrow = FACTORY.find((config) => config.id === 'arrow');
    const shaftIndex = arrow.parts.findIndex((part) => part.role === 'core');
    const headIndex = arrow.parts.findIndex((part) => part.role === 'nose');
    for (const hull of [80, 125]) {
        for (const nose of [80, 100, 125]) {
            const parts = drawn(arrow, { hull, nose });
            const shaft = measureVehiclePartBounds(parts[shaftIndex], EFFECTS);
            const head = measureVehiclePartBounds(parts[headIndex], EFFECTS);
            assert.ok(Math.abs(head.max[2] - shaft.min[2]) < TOLERANCE, `hull ${hull} %, nose ${nose} %: arrowhead base at z ${head.max[2]}, shaft front at ${shaft.min[2]}`);
        }
    }
});

test('the factory hit zones sit exactly where their parts are drawn', () => {
    const MEASURE = { includeMirrors: true, ...EFFECTS };
    for (const config of FACTORY) {
        for (const sizes of sizeBuilds()) {
            const parts = drawn(config, sizes);
            const shape = buildArcadeHitboxShape(config.parts, sizes);
            shape.names.forEach((name, box) => {
                const part = parts.find((entry) => entry.name === name);
                if (!part || part.role === 'core') return;
                const first = shape.names.indexOf(name);
                const half = resolveVehiclePartMirrorAxis(part) ? (box === first ? 'own' : 'copy') : null;
                const bounds = measureVehiclePartBounds(part, half ? { ...MEASURE, mirrorHalf: half } : MEASURE);
                bounds.center.forEach((value, axis) => {
                    const center = shape.boxes[box * 6 + axis];
                    assert.ok(Math.abs(center - value) < 1e-9, `${config.id} ${JSON.stringify(sizes)} "${name}" ${half || ''} axis ${axis}: box ${center}, drawn ${value}`);
                });
            });
        }
    }
});

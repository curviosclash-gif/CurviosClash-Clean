import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HangarVehicleAssembly } from '../src/ui/hangar/HangarVehicleAssembly.js';
import { HANGAR_CAMERA_PRESETS } from '../src/ui/hangar/HangarCameraController.js';
import { HANGAR_SLOT_DEFINITIONS } from '../src/ui/hangar/HangarPartCatalog.js';
import {
    HANGAR_HARDPOINT_BUTTON_GAP_PX,
    HANGAR_HARDPOINT_BUTTON_SIZE_PX,
    createHangarHardpointButtonLayout,
    layoutHangarHardpointButtons,
    spreadHangarHardpointButtons,
} from '../src/ui/hangar/HangarHardpointButtonLayout.js';
import { ARCADE_FACTORY_VEHICLE_IDS } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { ARCADE_PART_SIZE_GROUPS } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeSizedPartStyle } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { getVehicleIds, getVehicleModularConfig } from '../src/entities/vehicle-registry.js';

// The hardpoint buttons over the hangar's 3D preview must never cover each other: Playwright's click
// on the core button failed because the Pfeil's utility button lay on top of it.
const SLOT_IDS = HANGAR_SLOT_DEFINITIONS.map((slot) => slot.id);
const PITCH = HANGAR_HARDPOINT_BUTTON_SIZE_PX + HANGAR_HARDPOINT_BUTTON_GAP_PX;
const VIEWPORTS = [[900, 480], [560, 360]]; // arcade stage (min-height 480) and hangar window (min-height 360)
const SIZE_DRAFTS = [
    null,
    Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, 80])),
    Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, 125])),
    { hull: 125, nose: 80, wings: 125, engines: 80, utility: 80 },
    { hull: 80, nose: 125, wings: 80, engines: 125, utility: 125 },
];

/** Camera spots: the four presets plus an orbit over the whole range the OrbitControls allow. */
function cameraViews() {
    const views = Object.entries(HANGAR_CAMERA_PRESETS).map(([name, preset]) => ({ name, position: preset.position, target: preset.target }));
    for (const distance of [2.3, 5.5, 9]) {
        for (const polar of [0.12, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI - 0.18]) {
            for (let step = 0; step < 12; step += 1) {
                const azimuth = (step * Math.PI) / 6;
                views.push({
                    name: `orbit d${distance} p${polar.toFixed(2)} a${step * 30}`,
                    position: [distance * Math.sin(polar) * Math.sin(azimuth), 0.2 + distance * Math.cos(polar), distance * Math.sin(polar) * Math.cos(azimuth)],
                    target: [0, 0.2, 0],
                });
            }
        }
    }
    return views;
}
const VIEWS = cameraViews();

function createScene() {
    // Same scene graph as HangarViewport3d: the assembly hangs under a root lifted by 0.35.
    const root = new THREE.Group();
    root.position.y = 0.35;
    const assembly = new HangarVehicleAssembly(root);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    return { root, assembly, camera };
}

function aimCamera(camera, view, width, height) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.position.fromArray(view.position);
    camera.lookAt(new THREE.Vector3().fromArray(view.target));
    camera.updateMatrixWorld(true);
}

/** Pairs of visible buttons whose squares (plus the gap) overlap. */
function coveredPairs(layout) {
    const pairs = [];
    for (let a = 0; a < SLOT_IDS.length; a += 1) {
        for (let b = a + 1; b < SLOT_IDS.length; b += 1) {
            if (!layout.visible[a] || !layout.visible[b]) continue;
            const dx = Math.abs(layout.x[a] - layout.x[b]);
            const dy = Math.abs(layout.y[a] - layout.y[b]);
            if (Math.max(dx, dy) < PITCH - 1e-6) pairs.push(`${SLOT_IDS[a]}/${SLOT_IDS[b]} (${dx.toFixed(1)}, ${dy.toFixed(1)} px)`);
        }
    }
    return pairs;
}

function layoutFor(scene, view, width, height, layout) {
    aimCamera(scene.camera, view, width, height);
    scene.root.updateMatrixWorld(true);
    layoutHangarHardpointButtons(scene.assembly, scene.root, scene.camera, width, height, layout);
    return layout;
}

test('hardpoint buttons never cover each other: eight factory ships, every size draft, every camera angle', () => {
    const scene = createScene();
    const layout = createHangarHardpointButtonLayout();
    const failures = [];
    let checkedViews = 0;
    for (const vehicleId of ARCADE_FACTORY_VEHICLE_IDS) {
        scene.assembly.setVehicle(vehicleId);
        const config = getVehicleModularConfig(vehicleId);
        assert.ok(config, `${vehicleId} is part-built`);
        for (const sizes of SIZE_DRAFTS) {
            scene.assembly.setPartStyle(resolveArcadeSizedPartStyle(config.parts, null, sizes));
            for (const view of VIEWS) {
                for (const [width, height] of VIEWPORTS) {
                    const pairs = coveredPairs(layoutFor(scene, view, width, height, layout));
                    checkedViews += 1;
                    if (pairs.length) failures.push(`${vehicleId} ${JSON.stringify(sizes)} ${view.name} ${width}x${height}: ${pairs.join(', ')}`);
                }
            }
        }
    }
    scene.assembly.dispose();
    assert.equal(checkedViews, ARCADE_FACTORY_VEHICLE_IDS.length * SIZE_DRAFTS.length * VIEWS.length * VIEWPORTS.length);
    assert.deepEqual(failures.slice(0, 12), [], `${failures.length} covered views, first ones listed`);
});

test('hardpoint buttons never cover each other in the Fight hangar either (Lab builds: every registered vehicle)', () => {
    const scene = createScene();
    const layout = createHangarHardpointButtonLayout();
    const failures = [];
    // The Fight hangar shares the preview and also shows Lab builds; the Lab presets and the
    // mesh-only vehicles stand in for them here.
    const vehicleIds = new Set([...ARCADE_FACTORY_VEHICLE_IDS, ...getVehicleIds()]);
    assert.ok(vehicleIds.size > ARCADE_FACTORY_VEHICLE_IDS.length);
    for (const vehicleId of vehicleIds) {
        scene.assembly.setVehicle(vehicleId);
        for (const view of VIEWS) {
            const pairs = coveredPairs(layoutFor(scene, view, 900, 480, layout));
            if (pairs.length) failures.push(`${vehicleId} ${view.name}: ${pairs.join(', ')}`);
        }
    }
    scene.assembly.dispose();
    assert.deepEqual(failures.slice(0, 12), [], `${failures.length} covered views, first ones listed`);
});

test('Pfeil in the start view: the core button stays on its hardpoint and the utility button makes room', () => {
    const scene = createScene();
    scene.assembly.setVehicle('arrow');
    const hero = VIEWS.find((view) => view.name === 'hero');
    const layout = layoutFor(scene, hero, 900, 480, createHangarHardpointButtonLayout());
    const core = SLOT_IDS.indexOf('core');
    const utility = SLOT_IDS.indexOf('utility');
    // Where the hardpoints project without any spreading (the state that failed on the desktop).
    const projected = new THREE.Vector3();
    const spot = (slotId) => {
        scene.assembly.copyHardpointPosition(slotId, projected);
        scene.root.localToWorld(projected).project(scene.camera);
        return [(projected.x * 0.5 + 0.5) * 900, (-projected.y * 0.5 + 0.5) * 480];
    };
    const [coreX, coreY] = spot('core');
    const [utilityX, utilityY] = spot('utility');
    assert.ok(Math.max(Math.abs(coreX - utilityX), Math.abs(coreY - utilityY)) < HANGAR_HARDPOINT_BUTTON_SIZE_PX, 'the two hardpoints do fall onto one button spot');
    assert.equal(layout.visible[core], 1);
    assert.equal(layout.visible[utility], 1);
    assert.deepEqual([layout.x[core], layout.y[core]], [coreX, coreY], 'core keeps its spot');
    assert.notDeepEqual([layout.x[utility], layout.y[utility]], [utilityX, utilityY], 'utility moves');
    assert.deepEqual(coveredPairs(layout), []);
    scene.assembly.dispose();
});

test('spreading: earlier slots keep their spot, a covered button slides just clear, seven stacked buttons all fit', () => {
    const count = SLOT_IDS.length;
    const layout = createHangarHardpointButtonLayout();
    const { x: xs, y: ys, visible } = layout;
    visible.fill(1);
    const layOut = () => spreadHangarHardpointButtons(layout, count, 900, 480);

    // Free buttons stay exactly where they are.
    for (let index = 0; index < count; index += 1) { xs[index] = 100 + index * 50; ys[index] = 200; }
    assert.equal(layOut(), 0);
    assert.deepEqual(Array.from(xs), SLOT_IDS.map((_, index) => 100 + index * 50));

    // One covered button slides straight away from the one it covers, just until the gap is free.
    xs.fill(-1000); ys.fill(-1000);
    for (let index = 0; index < count; index += 1) xs[index] -= index * 100;
    xs[0] = 300; ys[0] = 200;
    xs[6] = 310; ys[6] = 200;
    assert.equal(layOut(), 1);
    assert.deepEqual([xs[0], ys[0]], [300, 200]);
    assert.ok(Math.abs(xs[6] - (300 + PITCH)) < 0.1 && ys[6] === 200, `slid to ${xs[6]}, ${ys[6]}`);

    // Hidden buttons neither move nor block.
    xs[0] = 300; ys[0] = 200; xs[6] = 300; ys[6] = 200; visible[0] = 0;
    assert.equal(layOut(), 0);
    assert.deepEqual([xs[6], ys[6]], [300, 200]);
    visible[0] = 1;

    // All seven on one spot, and many tight random clusters: never a covered pair.
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let round = 0; round < 2000; round += 1) {
        const spread = round === 0 ? 0 : 2 + random() * 60;
        for (let index = 0; index < count; index += 1) {
            xs[index] = 400 + (random() - 0.5) * spread;
            ys[index] = 240 + (random() - 0.5) * spread;
            visible[index] = round % 3 === 0 || random() > 0.15 ? 1 : 0;
        }
        const first = [xs[0], ys[0], visible[0]];
        layOut();
        if (first[2]) assert.deepEqual([xs[0], ys[0]], first.slice(0, 2), `round ${round}: the core slot never moves`);
        assert.deepEqual(coveredPairs(layout), [], `round ${round}`);
    }
});

/** Collects hops: moves of a button by more than 10 px beyond the move of its own hardpoint. */
function countJumps(previous, current, previousRaw, currentRaw, jumps) {
    for (let index = 0; index < SLOT_IDS.length; index += 1) {
        if (!previous.visible[index] || !current.visible[index]) continue;
        const jump = Math.hypot(
            (current.x[index] - previous.x[index]) - (currentRaw.x[index] - previousRaw.x[index]),
            (current.y[index] - previous.y[index]) - (currentRaw.y[index] - previousRaw.y[index]),
        );
        if (jump > 10) jumps.push(jump);
    }
}

function snapshot(layout) {
    return { x: Float64Array.from(layout.x), y: Float64Array.from(layout.y), visible: Uint8Array.from(layout.visible) };
}

test('a covered button keeps its side while its hardpoint wobbles across the covering button', () => {
    // The Pfeil's utility hardpoint sits within a few px of the core hardpoint: it crosses the core
    // button's centre again and again while the camera turns. It must not swap sides each time.
    const layout = createHangarHardpointButtonLayout();
    layout.visible[0] = 1;
    layout.visible[6] = 1;
    const jumps = [];
    let previous = null;
    let previousRaw = null;
    for (let step = 0; step < 400; step += 1) {
        layout.x[0] = 450; layout.y[0] = 240;
        layout.x[6] = 450 + 4 * Math.sin(step * 0.3); layout.y[6] = 240 + 2 * Math.cos(step * 0.2);
        const raw = snapshot(layout);
        spreadHangarHardpointButtons(layout, SLOT_IDS.length, 900, 480);
        assert.deepEqual(coveredPairs(layout), [], `step ${step}`);
        if (previous) countJumps(previous, layout, previousRaw, raw, jumps);
        previous = snapshot(layout);
        previousRaw = raw;
    }
    assert.deepEqual(jumps.map((jump) => Math.round(jump)), [], 'the utility button hops around the core button');
});

test('a moved button follows its hardpoint back out and sits on it again once that is free', () => {
    // The memory must not hold a button off its hardpoint until it snaps back. The utility button
    // settles below the core button; its hardpoint then leaves the core button to the right.
    const layout = createHangarHardpointButtonLayout();
    layout.visible[0] = 1;
    layout.visible[6] = 1;
    const coreRight = 450 + PITCH;
    const place = (rawX, rawY) => {
        layout.x[0] = 450; layout.y[0] = 240;
        layout.x[6] = rawX; layout.y[6] = rawY;
        spreadHangarHardpointButtons(layout, SLOT_IDS.length, 900, 480);
        return [layout.x[6], layout.y[6]];
    };
    for (let frame = 0; frame < 3; frame += 1) place(452, 243);
    let previous = place(452, 243);
    assert.ok(previous[1] >= 240 + PITCH && previous[1] < 240 + PITCH + 1, `settled below the core button: ${previous}`);
    const hops = [];
    for (let rawX = 453; rawX <= 520; rawX += 1) {
        const next = place(rawX, 243);
        const step = Math.hypot(next[0] - previous[0], next[1] - previous[1]);
        if (step > 10) hops.push(`raw ${rawX}: ${previous.map(Math.round)} -> ${next.map(Math.round)}`);
        assert.ok(step <= PITCH, `raw ${rawX}: ${previous} -> ${next}`);
        // Shortly before the hardpoint is free, the button already sits next to it.
        if (rawX > coreRight - 4 && rawX < coreRight) assert.ok(Math.hypot(next[0] - rawX, next[1] - 243) < 10, `raw ${rawX}: button at ${next}`);
        if (rawX >= coreRight) assert.deepEqual(next, [rawX, 243], `raw ${rawX}: back on its hardpoint`);
        previous = next;
    }
    assert.ok(hops.length <= 1, hops.join('; '));
    assert.deepEqual([layout.offsetX[6], layout.offsetY[6]], [0, 0]);

    // Straight out along the line to the covering button it glides without any hop.
    for (let frame = 0; frame < 3; frame += 1) place(452, 240);
    previous = place(452, 240);
    for (let rawX = 453; rawX <= 500; rawX += 1) {
        const next = place(rawX, 240);
        assert.ok(Math.hypot(next[0] - previous[0], next[1] - previous[1]) <= 1.01, `raw ${rawX}: ${previous} -> ${next}`);
        previous = next;
    }
    assert.deepEqual(previous, [500, 240]);
});

test('turning the start view once around in 0.1° steps: buttons rarely hop, never far', () => {
    // Review finding: without memory the buttons hopped 525 times over these 16 orbits (arrow 57 and
    // 77 per orbit) by up to 144 px (four pitches); with it 234 times (at most 29) by at most 98 px.
    const scene = createScene();
    const hero = HANGAR_CAMERA_PRESETS.hero;
    const target = new THREE.Vector3().fromArray(hero.target);
    const offset = new THREE.Vector3().fromArray(hero.position).sub(target);
    const distance = offset.length();
    const polar = Math.acos(offset.y / distance);
    const steps = 3600;
    const report = [];
    const failures = [];
    let total = 0;
    for (const vehicleId of ARCADE_FACTORY_VEHICLE_IDS) {
        scene.assembly.setVehicle(vehicleId);
        for (const [width, height] of VIEWPORTS) {
            const layout = createHangarHardpointButtonLayout();
            const raw = createHangarHardpointButtonLayout();
            const jumps = [];
            let previous = null;
            let previousRaw = null;
            for (let step = 0; step < steps; step += 1) {
                const azimuth = (step / steps) * 2 * Math.PI;
                const view = {
                    position: [target.x + distance * Math.sin(polar) * Math.sin(azimuth), target.y + distance * Math.cos(polar), target.z + distance * Math.sin(polar) * Math.cos(azimuth)],
                    target: hero.target,
                };
                layoutFor(scene, view, width, height, layout);
                projectHardpoints(scene, width, height, raw);
                if (previous) countJumps(previous, layout, previousRaw, raw, jumps);
                previous = snapshot(layout);
                previousRaw = snapshot(raw);
            }
            const largest = Math.max(0, ...jumps);
            total += jumps.length;
            report.push(`${vehicleId} ${width}x${height}: ${jumps.length} hops, largest ${largest.toFixed(0)} px`);
            if (jumps.length > 35 || largest > 3 * PITCH) failures.push(report[report.length - 1]);
        }
    }
    scene.assembly.dispose();
    assert.deepEqual(failures, [], report.join('\n'));
    assert.ok(total <= 280, `${total} hops over all orbits\n${report.join('\n')}`);
});

/** Hardpoint spots without spreading, as layoutHangarHardpointButtons projects them. */
function projectHardpoints(scene, width, height, out) {
    const point = new THREE.Vector3();
    for (let index = 0; index < SLOT_IDS.length; index += 1) {
        out.visible[index] = scene.assembly.copyHardpointPosition(SLOT_IDS[index], point) ? 1 : 0;
        scene.root.localToWorld(point).project(scene.camera);
        out.x[index] = (point.x * 0.5 + 0.5) * width;
        out.y[index] = (-point.y * 0.5 + 0.5) * height;
    }
    return out;
}

test('a moved button whose hardpoint lies inside the preview stays wholly inside (the stage clips the rest)', () => {
    const scene = createScene();
    const layout = createHangarHardpointButtonLayout();
    const raw = createHangarHardpointButtonLayout();
    const half = HANGAR_HARDPOINT_BUTTON_SIZE_PX / 2;
    const inside = (x, y, width, height) => x >= half && x <= width - half && y >= half && y <= height - half;
    // Panned targets too: the hangar camera may shift its look-at point (screen-space panning).
    const targets = [[0, 0.2, 0], [0, -0.4, 0], [0, 0.8, 0], [0.7, 0.2, 0], [-0.7, 0.2, 0], [0, 0.2, 0.9]];
    const views = [];
    for (const target of targets) {
        for (const distance of [2.3, 5.5, 9]) {
            for (const polar of [0.12, 0.6, 1.2, Math.PI / 2, 2.2, Math.PI - 0.18]) {
                for (let step = 0; step < 36; step += 1) {
                    const azimuth = (step * Math.PI) / 18;
                    views.push({
                        name: `t${target} d${distance} p${polar.toFixed(2)} a${step * 10}`,
                        position: [target[0] + distance * Math.sin(polar) * Math.sin(azimuth), target[1] + distance * Math.cos(polar), target[2] + distance * Math.sin(polar) * Math.cos(azimuth)],
                        target,
                    });
                }
            }
        }
    }
    const failures = [];
    let moved = 0;
    for (const vehicleId of ARCADE_FACTORY_VEHICLE_IDS) {
        scene.assembly.setVehicle(vehicleId);
        for (const [width, height] of VIEWPORTS) {
            for (const view of views) {
                layoutFor(scene, view, width, height, layout);
                projectHardpoints(scene, width, height, raw);
                for (let index = 0; index < SLOT_IDS.length; index += 1) {
                    if (!layout.visible[index] || (layout.x[index] === raw.x[index] && layout.y[index] === raw.y[index])) continue;
                    moved += 1;
                    if (!inside(raw.x[index], raw.y[index], width, height) || inside(layout.x[index], layout.y[index], width, height)) continue;
                    failures.push(`${vehicleId} ${width}x${height} ${view.name} ${SLOT_IDS[index]}: (${raw.x[index].toFixed(0)}, ${raw.y[index].toFixed(0)}) -> (${layout.x[index].toFixed(0)}, ${layout.y[index].toFixed(0)})`);
                }
            }
        }
    }
    assert.ok(moved > 10000, `${moved} moved buttons checked`);

    // The review's case: Pfeil in the window hangar, zoomed in, look-at point panned down.
    scene.assembly.setVehicle('arrow');
    const azimuth = (190 * Math.PI) / 180;
    const view = { position: [2.3 * Math.sin(1.2) * Math.sin(azimuth), -0.4 + 2.3 * Math.cos(1.2), 2.3 * Math.sin(1.2) * Math.cos(azimuth)], target: [0, -0.4, 0] };
    const fresh = layoutFor(scene, view, 560, 360, createHangarHardpointButtonLayout());
    projectHardpoints(scene, 560, 360, raw);
    const utility = SLOT_IDS.indexOf('utility');
    assert.deepEqual([Math.round(raw.x[utility]), Math.round(raw.y[utility])], [274, 19], 'the utility hardpoint lies just inside the top edge');
    assert.ok(inside(fresh.x[utility], fresh.y[utility], 560, 360), `utility button at (${fresh.x[utility].toFixed(0)}, ${fresh.y[utility].toFixed(0)})`);
    scene.assembly.dispose();
    assert.deepEqual(failures.slice(0, 12), [], `${failures.length} buttons pushed out of the preview, first ones listed`);
});

test('the spreading distance covers the largest hardpoint button the CSS draws', () => {
    const sources = ['style.css', 'src/ui/hangar/HangarWindow.css'].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const sizes = [];
    for (const source of sources) {
        for (const [, selector, body] of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            if (!/\.(hangar-slot-hardpoint|arcade-vehicle-slot-dot)\b/.test(selector)) continue;
            // style.css sets box-sizing: border-box on every element, so width and height are the whole button.
            for (const [, property, value] of body.matchAll(/(?:^|;)\s*(width|height|min-width|min-height)\s*:\s*([^;]+)/g)) {
                const px = value.trim().match(/^(\d+(?:\.\d+)?)px$/);
                assert.ok(px, `${selector.trim()} ${property}: ${value.trim()} must be a px value the layout can check`);
                sizes.push(Number(px[1]));
            }
            for (const [, factor] of body.matchAll(/scale\(\s*(\d+(?:\.\d+)?)/g)) {
                assert.ok(Number(factor) <= 1, `${selector.trim()}: scale(${factor}) grows the button`);
            }
        }
    }
    assert.ok(sizes.length >= 4, `found button sizes: ${sizes.join(', ')}`);
    assert.equal(Math.max(...sizes), HANGAR_HARDPOINT_BUTTON_SIZE_PX, 'the layout spreads by the largest drawn button');
});

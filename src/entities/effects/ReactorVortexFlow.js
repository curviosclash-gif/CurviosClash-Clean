import profiles from '../../shared/vfx/ReactorVortexProfiles.json' with { type: 'json' };

const TAU = Math.PI * 2;
export function resolveVortexProfile(index) {
    return profiles.profiles.find((entry) => entry.id === index) || profiles.profiles[0];
}
export function smoothRange(a, b, value) {
    const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return x * x * (3 - 2 * x);
}
export function vortexTravel(time, profile) {
    return 1.6 * profile.circulation * (1 - Math.exp(-Math.max(0, time) / 18));
}

// An open streamline feeds the inner rim from below and then completes a full
// poloidal turn. Its endpoints fade; no visible particle teleports down the stem.
export function sampleVortexStream(out, phase, azimuth, shape) {
    let radius, height, dr, dy;
    if (phase < .45) {
        const s = phase / .45;
        const bend = s ** 4 * (5 - 4 * s);
        radius = shape.stemRadius * .5 + (shape.radius - shape.tubeRadius - shape.stemRadius * .5) * bend;
        height = shape.base + (shape.height - shape.base) * s;
        dr = 20 * s ** 3 * (1 - s) * (shape.radius - shape.tubeRadius - shape.stemRadius * .5);
        dy = shape.height - shape.base;
    } else {
        const angle = Math.PI + (phase - .45) / .55 * TAU;
        radius = shape.radius + shape.tubeRadius * Math.cos(angle);
        height = shape.height - shape.tubeHeight * Math.sin(angle);
        dr = -shape.tubeRadius * Math.sin(angle);
        dy = -shape.tubeHeight * Math.cos(angle);
    }
    out.x = Math.cos(azimuth) * radius; out.y = height; out.z = Math.sin(azimuth) * radius;
    const length = Math.max(.001, Math.hypot(dr, dy));
    out.tx = Math.cos(azimuth) * dr / length; out.ty = dy / length; out.tz = Math.sin(azimuth) * dr / length;
    return out;
}

export function createVortexCards(lobe, firstIndex) {
    return Array.from({ length: 128 }, (_, index) => ({
        lobe, detail: 1, flow: index < 80 ? 'stream' : index < 104 ? 'shed' : 'entrain',
        flowIndex: index, index: firstIndex + index, center: lobe.center.clone(),
        width: 0, height: 0, depth: 0, opacity: 0, angle: 0, glow: 0, tint: 1,
    }));
}

export function updateVortexCard(card, time, profile, shape, scratch) {
    const i = card.flowIndex;
    const travel = vortexTravel(time, profile);
    const phase = ((i * .61803398875 + travel) % 1 + 1) % 1;
    const azimuth = i * 2.39996323 + profile.turbulence * Math.sin(time * .24 + i);
    const ca = Math.cos(azimuth), sa = Math.sin(azimuth);
    let size = shape.tubeRadius * .42;
    let alpha = smoothRange(0,.06,phase) * (1-smoothRange(.86,1,phase));
    if (card.flow === 'stream') {
        sampleVortexStream(scratch, phase, azimuth, shape);
        size *= phase < .45 ? .75 : 1;
        card.angle = 0;
        card.tint = 1.12 + .13 * Math.sin(i);
    } else if (card.flow === 'shed') {
        const radius = shape.radius + shape.tubeRadius * (.7 + phase * profile.shedding * 2);
        scratch.x = radius * ca; scratch.z = radius * sa;
        scratch.y = shape.height + shape.tubeHeight * (.35 * Math.sin(phase*TAU*1.4) + phase*.65);
        size *= .58 + phase * .7;
        alpha *= profile.shedding * (1-smoothRange(34,48,time));
        card.angle = phase * TAU * .65;
        card.tint = 1.05;
    } else {
        const radius = shape.radius * (.85 - .65*phase);
        scratch.x = radius*ca; scratch.z = radius*sa;
        scratch.y = shape.base + (shape.height-shape.base) * (.08 + .34*phase);
        size *= .48;
        alpha *= .48;
        card.angle = -azimuth * .12;
        card.tint = 1.22;
    }
    card.center.set(shape.x+scratch.x, scratch.y, shape.z+scratch.z);
    const stretch = 1 + .35 * Math.sin(phase*TAU + i);
    card.width = size * 3 / Math.sqrt(stretch); card.height = size * 3 * stretch;
    card.opacity = alpha * .66;
    // Hot streaks stay attached to particular advected parcels and cool at
    // different rates, rather than tinting the entire cloud in one pulse.
    card.glow = (.35 + .65 * (Math.sin(i*2.1)*.5+.5)) * Math.exp(-time*.13*profile.cooling);
    return phase;
}

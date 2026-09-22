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

export function stemWidthAt(height) {
    const p = profiles.stemProfile;
    return p.lower + (p.upper-p.lower) * smoothRange(p.lowerHeight,p.upperHeight,height);
}

export function smokeHeat(time, index, profile) {
    const strength = .35 + .65 * (Math.sin(index*2.1)*.5+.5);
    return strength * Math.exp(-Math.max(0,time) * (.065 + .05*(index%5)/4) * profile.cooling);
}

// An open streamline feeds the inner rim from below and then completes a full
// poloidal turn. Its endpoints fade; no visible particle teleports down the stem.
export function sampleVortexStream(out, phase, azimuth, shape) {
    let radius, height, dr, dy;
    if (phase < .45) {
        const s = phase / .45;
        const bend = s ** 4 * (5 - 4 * s);
        const heightRatio = (shape.height-shape.base) / Math.max(.001,shape.stemHeight || shape.height-shape.base);
        const stemHeight = s * heightRatio;
        const startRadius = shape.stemRadius * .5 * stemWidthAt(stemHeight);
        radius = startRadius + (shape.radius - shape.tubeRadius - startRadius) * bend;
        height = shape.base + (shape.height - shape.base) * s;
        const p = profiles.stemProfile;
        const u = Math.max(0,Math.min(1,(stemHeight-p.lowerHeight)/(p.upperHeight-p.lowerHeight)));
        const widthDerivative = (p.upper-p.lower)*6*u*(1-u)*heightRatio/(p.upperHeight-p.lowerHeight);
        dr = shape.stemRadius*.5*widthDerivative*(1-bend) + 20*s**3*(1-s)*(shape.radius-shape.tubeRadius-startRadius);
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
        // Up the stem the wisps line up into a visible chain beside the column; they show fully
        // only where they bend into the head.
        alpha *= .25 + .75 * smoothRange(.3,.45,phase);
        card.angle = 0;
        card.tint = 1.12 + .13 * Math.sin(i);
    } else if (card.flow === 'shed') {
        const radius = shape.radius + shape.tubeRadius * (.7 + phase * profile.shedding * 2);
        scratch.x = radius * ca; scratch.z = radius * sa;
        scratch.y = shape.height + shape.tubeHeight * (.35 * Math.sin(phase*TAU*1.4) + phase*.65);
        size *= .58 + phase * .7;
        // Faint: above the closed head, strong sheds read as loose strands of hair.
        alpha *= .4 * profile.shedding * (1-smoothRange(34,48,time));
        card.angle = phase * TAU * .65;
        card.tint = 1.05;
    } else {
        const height = (.08+.34*phase)*(shape.height-shape.base);
        const radius = shape.radius*(1-phase)*.85 + shape.stemRadius*stemWidthAt(height/Math.max(.001,shape.stemHeight || shape.height-shape.base))*.6*phase;
        scratch.x = radius*ca; scratch.z = radius*sa;
        scratch.y = shape.base + (shape.height-shape.base) * (.08 + .34*phase);
        size *= .48;
        alpha *= .62 * smoothRange(.28,1.3,time);
        card.angle = -azimuth * .12;
        card.tint = 1.22;
    }
    card.center.set(shape.x+scratch.x, scratch.y, shape.z+scratch.z);
    const stretch = 1 + .35 * Math.sin(phase*TAU + i);
    card.width = size * 3 / Math.sqrt(stretch); card.height = size * 3 * stretch;
    card.opacity = alpha * .66;
    // Hot streaks stay attached to particular advected parcels and cool at
    // different rates, rather than tinting the entire cloud in one pulse.
    card.glow = smokeHeat(time,i,profile);
    return phase;
}

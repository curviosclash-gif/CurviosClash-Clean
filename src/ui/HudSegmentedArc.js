export const HUD_ARC_SEGMENT_COUNT = 100;

const HUD_ARC_SVG_NS = 'http://www.w3.org/2000/svg';
const CIRCULAR_ARC_RANGES = Object.freeze({
    'circle-boost': Object.freeze([155, 265]),
    'circle-overheat': Object.freeze([275, 385]),
    'circle-reserve': Object.freeze([35, 145]),
});

function buildSegmentPath(orientation, segmentCount) {
    const commands = [];
    const horizontal = orientation === 'horizontal';
    for (let index = 0; index < segmentCount; index += 1) {
        const progress = index / (segmentCount - 1);
        const primary = 268.65 - (progress * 267.3);
        const normalized = (primary - 135) / 120;
        const curve = 60 + (normalized * normalized * 60);
        commands.push(horizontal
            ? `M${(270 - primary).toFixed(2)} ${curve.toFixed(2)}v14`
            : `M${curve.toFixed(2)} ${primary.toFixed(2)}h14`);
    }
    return commands.join(' ');
}

function buildCircularSegmentPath(orientation, segmentCount) {
    const commands = [];
    const [startDegrees, endDegrees] = CIRCULAR_ARC_RANGES[orientation];
    const center = 135;
    const innerRadius = 108;
    const outerRadius = 126;
    for (let index = 0; index < segmentCount; index += 1) {
        const progress = index / (segmentCount - 1);
        const angle = (startDegrees + ((endDegrees - startDegrees) * progress)) * (Math.PI / 180);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        commands.push(
            `M${(center + (cos * innerRadius)).toFixed(2)} ${(center + (sin * innerRadius)).toFixed(2)}`
            + `L${(center + (cos * outerRadius)).toFixed(2)} ${(center + (sin * outerRadius)).toFixed(2)}`
        );
    }
    return commands.join(' ');
}

const SEGMENT_PATHS = Object.freeze({
    horizontal: buildSegmentPath('horizontal', HUD_ARC_SEGMENT_COUNT),
    vertical: buildSegmentPath('vertical', HUD_ARC_SEGMENT_COUNT),
});

const COMPACT_SEGMENT_PATHS = new Map();

function resolveSegmentPath(orientation, segmentCount) {
    if (segmentCount === HUD_ARC_SEGMENT_COUNT && SEGMENT_PATHS[orientation]) return SEGMENT_PATHS[orientation];
    const cacheKey = `${orientation}:${segmentCount}`;
    let path = COMPACT_SEGMENT_PATHS.get(cacheKey);
    if (!path) {
        path = CIRCULAR_ARC_RANGES[orientation]
            ? buildCircularSegmentPath(orientation, segmentCount)
            : buildSegmentPath(orientation, segmentCount);
        COMPACT_SEGMENT_PATHS.set(cacheKey, path);
    }
    return path;
}

export function initializeHudSegmentedArc(fill, orientation = 'vertical', segmentCount = HUD_ARC_SEGMENT_COUNT) {
    const doc = fill?.ownerDocument;
    if (!doc?.createElementNS || fill.querySelector?.('.hunt-segmented-arc')) return;
    const resolvedOrientation = orientation === 'horizontal' || CIRCULAR_ARC_RANGES[orientation]
        ? orientation
        : 'vertical';
    const resolvedSegmentCount = Math.max(2, Math.min(
        HUD_ARC_SEGMENT_COUNT,
        Math.floor(Number(segmentCount) || HUD_ARC_SEGMENT_COUNT)
    ));
    const segmentPath = resolveSegmentPath(resolvedOrientation, resolvedSegmentCount);

    const svg = doc.createElementNS(HUD_ARC_SVG_NS, 'svg');
    svg.classList.add('hunt-segmented-arc');
    const isCircular = !!CIRCULAR_ARC_RANGES[resolvedOrientation];
    svg.setAttribute('viewBox', isCircular
        ? '0 0 270 270'
        : (resolvedOrientation === 'horizontal' ? '0 0 270 170' : '0 0 170 270'));
    svg.setAttribute('data-segment-count', String(resolvedSegmentCount));
    svg.setAttribute('aria-hidden', 'true');

    const track = doc.createElementNS(HUD_ARC_SVG_NS, 'path');
    track.classList.add('hunt-segment-track');
    track.setAttribute('d', segmentPath);

    const active = doc.createElementNS(HUD_ARC_SVG_NS, 'path');
    active.classList.add('hunt-segment-active');
    active.setAttribute('d', segmentPath);

    svg.append(track, active);
    fill.replaceChildren(svg);
}

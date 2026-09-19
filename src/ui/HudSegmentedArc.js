export const HUD_ARC_SEGMENT_COUNT = 100;

const HUD_ARC_SVG_NS = 'http://www.w3.org/2000/svg';
const TARGETING_ARC_CURVES = Object.freeze({
    'triangle-boost': Object.freeze({ start: [135, 15], control: [70, 97], end: [34, 195] }),
    'triangle-overheat': Object.freeze({ start: [135, 15], control: [200, 97], end: [236, 195] }),
    'triangle-reserve': Object.freeze({ start: [34, 195], control: [135, 222], end: [236, 195] }),
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

function buildTargetingSegmentPath(orientation, segmentCount) {
    const commands = [];
    const { start, control, end } = TARGETING_ARC_CURVES[orientation];
    const center = 135;
    const halfSegmentLength = 9;
    for (let index = 0; index < segmentCount; index += 1) {
        const progress = index / (segmentCount - 1);
        const curveProgress = 0.06 + (progress * 0.88);
        const inverseProgress = 1 - curveProgress;
        const x = (inverseProgress * inverseProgress * start[0])
            + (2 * inverseProgress * curveProgress * control[0])
            + (curveProgress * curveProgress * end[0]);
        const y = (inverseProgress * inverseProgress * start[1])
            + (2 * inverseProgress * curveProgress * control[1])
            + (curveProgress * curveProgress * end[1]);
        const tangentX = (2 * inverseProgress * (control[0] - start[0]))
            + (2 * curveProgress * (end[0] - control[0]));
        const tangentY = (2 * inverseProgress * (control[1] - start[1]))
            + (2 * curveProgress * (end[1] - control[1]));
        const tangentLength = Math.hypot(tangentX, tangentY) || 1;
        let normalX = -tangentY / tangentLength;
        let normalY = tangentX / tangentLength;
        if (((x - center) * normalX) + ((y - center) * normalY) < 0) {
            normalX *= -1;
            normalY *= -1;
        }
        commands.push(
            `M${(x - (normalX * halfSegmentLength)).toFixed(2)} ${(y - (normalY * halfSegmentLength)).toFixed(2)}`
            + `L${(x + (normalX * halfSegmentLength)).toFixed(2)} ${(y + (normalY * halfSegmentLength)).toFixed(2)}`
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
        path = TARGETING_ARC_CURVES[orientation]
            ? buildTargetingSegmentPath(orientation, segmentCount)
            : buildSegmentPath(orientation, segmentCount);
        COMPACT_SEGMENT_PATHS.set(cacheKey, path);
    }
    return path;
}

export function initializeHudSegmentedArc(fill, orientation = 'vertical', segmentCount = HUD_ARC_SEGMENT_COUNT) {
    const doc = fill?.ownerDocument;
    if (!doc?.createElementNS || fill.querySelector?.('.hunt-segmented-arc')) return;
    const resolvedOrientation = orientation === 'horizontal' || TARGETING_ARC_CURVES[orientation]
        ? orientation
        : 'vertical';
    const resolvedSegmentCount = Math.max(2, Math.min(
        HUD_ARC_SEGMENT_COUNT,
        Math.floor(Number(segmentCount) || HUD_ARC_SEGMENT_COUNT)
    ));
    const segmentPath = resolveSegmentPath(resolvedOrientation, resolvedSegmentCount);

    const svg = doc.createElementNS(HUD_ARC_SVG_NS, 'svg');
    svg.classList.add('hunt-segmented-arc');
    const isTargetingArc = !!TARGETING_ARC_CURVES[resolvedOrientation];
    svg.setAttribute('viewBox', isTargetingArc
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

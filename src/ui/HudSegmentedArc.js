export const HUD_ARC_SEGMENT_COUNT = 100;

const HUD_ARC_SVG_NS = 'http://www.w3.org/2000/svg';

function buildSegmentPath(orientation) {
    const commands = [];
    const horizontal = orientation === 'horizontal';
    for (let index = 0; index < HUD_ARC_SEGMENT_COUNT; index += 1) {
        const progress = index / (HUD_ARC_SEGMENT_COUNT - 1);
        const primary = 268.65 - (progress * 267.3);
        const normalized = (primary - 135) / 120;
        const curve = 60 + (normalized * normalized * 60);
        commands.push(horizontal
            ? `M${(270 - primary).toFixed(2)} ${curve.toFixed(2)}v14`
            : `M${curve.toFixed(2)} ${primary.toFixed(2)}h14`);
    }
    return commands.join(' ');
}

const SEGMENT_PATHS = Object.freeze({
    horizontal: buildSegmentPath('horizontal'),
    vertical: buildSegmentPath('vertical'),
});

export function initializeHudSegmentedArc(fill, orientation = 'vertical') {
    const doc = fill?.ownerDocument;
    if (!doc?.createElementNS || fill.querySelector?.('.hunt-segmented-arc')) return;
    const resolvedOrientation = orientation === 'horizontal' ? 'horizontal' : 'vertical';

    const svg = doc.createElementNS(HUD_ARC_SVG_NS, 'svg');
    svg.classList.add('hunt-segmented-arc');
    svg.setAttribute('viewBox', resolvedOrientation === 'horizontal' ? '0 0 270 170' : '0 0 170 270');
    svg.setAttribute('aria-hidden', 'true');

    const track = doc.createElementNS(HUD_ARC_SVG_NS, 'path');
    track.classList.add('hunt-segment-track');
    track.setAttribute('d', SEGMENT_PATHS[resolvedOrientation]);

    const active = doc.createElementNS(HUD_ARC_SVG_NS, 'path');
    active.classList.add('hunt-segment-active');
    active.setAttribute('d', SEGMENT_PATHS[resolvedOrientation]);

    svg.append(track, active);
    fill.replaceChildren(svg);
}

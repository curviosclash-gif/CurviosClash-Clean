const SVG_NS = 'http://www.w3.org/2000/svg';
function svgElement(createElement, tag, attributes) {
    const node = document.createElementNS?.(SVG_NS, tag) || createElement(tag, '');
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
}
function place(node, point) { node.setAttribute('style', `--journey-x:${point.x}%;--journey-y:${point.y}%`); }
function zoomPositions(nodes) {
    const xs = nodes.map(node => node.x), ys = nodes.map(node => node.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const dx = Math.max(1, Math.max(...xs) - minX), dy = Math.max(1, Math.max(...ys) - minY);
    return new Map(nodes.map(node => [node.id, {
        x: xs.every(x => x === minX) ? 50 : 12 + (node.x - minX) / dx * 76,
        y: ys.every(y => y === minY) ? 50 : 25 + (node.y - minY) / dy * 48,
    }]));
}
export function createArcadeJourneyMapView(createElement, worlds, nodes, links) {
    const element = createElement('div', 'journey-map');
    element.dataset.journeyMap = 'true'; element.setAttribute('role', 'group'); element.setAttribute('aria-label', 'Arcade-Landkarte');
    const canvas = createElement('div', 'journey-map-canvas journey-map-overview');
    const svg = svgElement(createElement, 'svg', { viewBox: '0 0 900 470', preserveAspectRatio: 'none', 'aria-hidden': 'true', class: 'journey-map-links' });
    const regions = new Map(), worldButtons = new Map(), nodeButtons = new Map(), paths = [];
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const overviewPoints = new Map(nodes.map(node => [node.id, { x: node.x / 9, y: node.y / 4.7 }]));
    for (const world of worlds) {
        const region = svgElement(createElement, 'rect', { x: world.x, y: world.y, width: world.w, height: world.h, rx: 4, class: 'journey-map-region' });
        svg.appendChild(region); regions.set(world.id, region);
        const button = createElement('button', 'journey-map-world');
        button.type = 'button'; button.dataset.journeyWorld = world.id;
        button.appendChild(createElement('span', 'journey-map-world-label', world.label));
        const progress = createElement('span', 'journey-map-progress'); button.appendChild(progress);
        const reward = createElement('span', 'journey-map-reward sr-only'); button.appendChild(reward);
        place(button, { x: (world.x + 12) / 9, y: (world.y + 12) / 4.7 });
        canvas.appendChild(button); worldButtons.set(world.id, { button, progress, reward });
    }
    for (const [from, to] of links) {
        const path = svgElement(createElement, 'path', { class: 'journey-map-path', 'vector-effect': 'non-scaling-stroke' });
        svg.appendChild(path); paths.push({ from, to, path });
    }
    canvas.appendChild(svg);
    nodes.forEach((node, index) => {
        const button = createElement('button', 'journey-map-node');
        button.type = 'button'; button.dataset.journeyNode = node.id;
        const mark = createElement('span', 'journey-map-node-mark', String(index + 1)); mark.setAttribute('aria-hidden', 'true');
        const label = createElement('span', 'journey-map-node-label', node.label);
        const status = createElement('span', 'journey-map-node-status');
        button.append(mark, label, status); canvas.appendChild(button);
        nodeButtons.set(node.id, { button, mark, status, index });
    });
    element.appendChild(canvas);
    let currentWorld = '', currentNode = '', currentPoints = overviewPoints;
    /** @type {(id: string) => void} */ let onWorld = () => {};
    /** @type {(id: string) => void} */ let onSelect = () => {};
    /** @type {(id: string) => void} */ let onStart = () => {};
    const focusNode = id => nodeButtons.get(id)?.button.focus();
    return {
        element, focusNode,
        focusWorld: id => worldButtons.get(id)?.button.focus(),
        render(worldId, nodeId, nodeStates) {
            currentWorld = worldId; currentNode = nodeId;
            currentPoints = worldId ? zoomPositions(nodes.filter(node => node.worldId === worldId)) : overviewPoints;
            canvas.classList.toggle('journey-map-overview', !worldId);
            canvas.classList.toggle('journey-map-world-view', Boolean(worldId));
            canvas.dataset.journeyWorldPanel = worldId;
            for (const world of worlds) {
                const { button, progress, reward } = worldButtons.get(world.id);
                const members = nodes.filter(node => node.worldId === world.id);
                const stars = members.reduce((sum, node) => sum + (nodeStates.get(node.id)?.stars || 0), 0);
                progress.textContent = `${stars}/${members.length * 3} ★`;
                reward.textContent = members.every(node => nodeStates.get(node.id)?.stars > 0)
                    ? `${world.label}-Abzeichen · verdient` : 'Welt-Abzeichen: überall Bronze';
                button.setAttribute('aria-label', `${world.label} vergrößern: ${stars} von ${members.length * 3} Sternen`);
                button.classList.toggle('hidden', Boolean(worldId));
                regions.get(world.id).classList.toggle('hidden', Boolean(worldId));
            }
            for (const [id, { button, mark, status, index }] of nodeButtons) {
                const state = nodeStates.get(id), node = nodeById.get(id), point = currentPoints.get(id);
                button.classList.toggle('hidden', !point || (!worldId && node.worldId === 'extras'));
                if (point) place(button, point);
                button.classList.toggle('is-selected', id === nodeId);
                button.classList.toggle('is-complete', state.stars > 0);
                button.classList.toggle('is-locked', !state.unlocked);
                button.classList.toggle('is-boss', node.boss === true);
                button.classList.toggle('is-optional', node.optional === true);
                button.setAttribute('aria-pressed', String(id === nodeId));
                button.setAttribute('aria-label', `Etappe ${index + 1}: ${node.label}, ${state.label}`);
                button.tabIndex = id === nodeId ? 0 : -1;
                if (id === nodeId) button.dataset.menuFocusPreferred = 'true'; else delete button.dataset.menuFocusPreferred;
                mark.textContent = String(index + 1);
                status.textContent = state.stars > 0 ? `${'★'.repeat(state.stars)} Geschafft` : state.label;
            }
            for (const { from, to, path } of paths) {
                const a = currentPoints.get(from), b = currentPoints.get(to);
                path.classList.toggle('hidden', !a || !b);
                if (a && b) {
                    const ax = a.x * 9, ay = a.y * 4.7, bx = b.x * 9, by = b.y * 4.7;
                    path.setAttribute('d', `M${ax} ${ay}Q${(ax + bx) / 2 + (by - ay) * .14} ${(ay + by) / 2 - (bx - ax) * .14} ${bx} ${by}`);
                }
                path.classList.toggle('is-complete', nodeStates.get(from)?.stars > 0 && nodeStates.get(to)?.stars > 0);
            }
        },
        moveFocus(direction, active) {
            const entries = Array.from(nodeButtons).filter(([id]) => currentPoints.has(id) && (currentWorld || nodeById.get(id).worldId !== 'extras'));
            const from = entries.find(([, ref]) => ref.button === active);
            if (!from) return false;
            const origin = currentPoints.get(from[0]), horizontal = direction === 'left' || direction === 'right';
            const sign = direction === 'left' || direction === 'up' ? -1 : 1;
            const candidates = entries.filter(([id]) => id !== from[0]).map(([id, ref]) => {
                const point = currentPoints.get(id), dx = point.x - origin.x, dy = point.y - origin.y;
                return { id, button: ref.button, forward: (horizontal ? dx : dy) * sign, distance: Math.hypot(dx, dy), cross: Math.abs(horizontal ? dy : dx) };
            }).filter(entry => entry.forward > .01).sort((a, b) => a.distance + a.cross - b.distance - b.cross);
            if (!candidates[0]) return false;
            onSelect(candidates[0].id); candidates[0].button.focus(); return true;
        },
        activateFocused(active) {
            const entry = nodeButtons.get(currentNode);
            if (active !== entry?.button) return false;
            onStart(currentNode); return true;
        },
        bind(bind, actions) {
            ({ onWorld, onSelect, onStart } = actions);
            for (const [id, { button }] of worldButtons) bind(button, 'click', () => onWorld(id));
            for (const [id, { button }] of nodeButtons) {
                bind(button, 'click', () => onSelect(id));
                bind(button, 'keydown', event => {
                    if (!['Enter', ' '].includes(event.key)) return;
                    event.preventDefault(); event.stopPropagation();
                    if (!event.repeat) onStart(id);
                });
            }
        },
    };
}

// ============================================
// MenuTelemetryHeatmapView.js - top-down view of where round events pile up
// ============================================

import {
    ROUND_HEATMAP_CELL_SIZE,
    heatmapCellBounds,
    heatmapCellCenter,
    normalizeHeatmapCells,
    summarizeHeatmapCells,
} from '../../shared/contracts/RoundHeatmapContract.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_SIZE = 240;
const VIEW_PADDING = 6;
const MAX_RENDERED_MAPS = 3;
const TOP_HOTSPOT_LIMIT = 3;

const KIND_COLORS = Object.freeze({
    stuck: '#ff8a3d',
    bounce_wall: '#4da3ff',
    bounce_trail: '#b07dff',
    kill: '#ff4d6d',
});

const KIND_LABELS = Object.freeze({
    stuck: 'Stuck',
    bounce_wall: 'Wandtreffer',
    bounce_trail: 'Trailtreffer',
    kill: 'Kills',
});

// Stuck zuletzt, damit die interessanteste Art oben liegt, wenn sich Zellen
// verschiedener Arten ueberlagern.
const KIND_DRAW_ORDER = Object.freeze(['bounce_wall', 'bounce_trail', 'kill', 'stuck']);

function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, String(value));
    });
    return element;
}

function resolveViewTransform(cells) {
    const bounds = heatmapCellBounds(cells, ROUND_HEATMAP_CELL_SIZE);
    if (!bounds) return null;
    // Quadratische Projektion: eine verzerrte Draufsicht waere als Karte wertlos.
    const spanX = Math.max(ROUND_HEATMAP_CELL_SIZE, bounds.maxX - bounds.minX);
    const spanZ = Math.max(ROUND_HEATMAP_CELL_SIZE, bounds.maxZ - bounds.minZ);
    const span = Math.max(spanX, spanZ);
    const drawSize = VIEW_SIZE - (VIEW_PADDING * 2);
    const scale = drawSize / span;
    return {
        scale,
        offsetX: VIEW_PADDING + ((span - spanX) * scale) / 2,
        offsetZ: VIEW_PADDING + ((span - spanZ) * scale) / 2,
        minX: bounds.minX,
        minZ: bounds.minZ,
    };
}

function appendHeatmapCells(svg, cells, transform) {
    let maxCount = 1;
    for (const cell of cells) {
        if (cell.count > maxCount) maxCount = cell.count;
    }
    const cellSize = Math.max(1, ROUND_HEATMAP_CELL_SIZE * transform.scale);
    const ordered = KIND_DRAW_ORDER.flatMap((kind) => cells.filter((cell) => cell.kind === kind));
    for (const cell of ordered) {
        const worldX = cell.cx * ROUND_HEATMAP_CELL_SIZE;
        const worldZ = cell.cz * ROUND_HEATMAP_CELL_SIZE;
        const rect = createSvgElement('rect', {
            x: transform.offsetX + ((worldX - transform.minX) * transform.scale),
            y: transform.offsetZ + ((worldZ - transform.minZ) * transform.scale),
            width: cellSize,
            height: cellSize,
            fill: KIND_COLORS[cell.kind] || '#8899aa',
            'fill-opacity': (0.2 + (0.8 * (cell.count / maxCount))).toFixed(3),
            'data-heatmap-kind': cell.kind,
            'data-heatmap-count': cell.count,
        });
        svg.appendChild(rect);
    }
}

function createHeatmapSvg(mapKey, cells) {
    const transform = resolveViewTransform(cells);
    if (!transform) return null;
    const svg = createSvgElement('svg', {
        class: 'developer-telemetry-heatmap-canvas',
        viewBox: `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`,
        width: VIEW_SIZE,
        height: VIEW_SIZE,
        role: 'img',
        'aria-label': `Ereignisverteilung auf ${mapKey}`,
    });
    svg.appendChild(createSvgElement('rect', {
        x: 0,
        y: 0,
        width: VIEW_SIZE,
        height: VIEW_SIZE,
        fill: '#0a0a1a',
        stroke: '#1a1a3a',
    }));
    appendHeatmapCells(svg, cells, transform);
    return svg;
}

function createLegend() {
    const legend = document.createElement('ul');
    legend.className = 'developer-telemetry-heatmap-legend';
    KIND_DRAW_ORDER.forEach((kind) => {
        const item = document.createElement('li');
        item.setAttribute('data-heatmap-legend-kind', kind);

        const swatch = document.createElement('span');
        swatch.className = 'developer-telemetry-heatmap-swatch';
        swatch.style.backgroundColor = KIND_COLORS[kind];

        const label = document.createElement('span');
        label.textContent = KIND_LABELS[kind];

        item.append(swatch, label);
        legend.appendChild(item);
    });
    return legend;
}

function createHotspotList(cells) {
    const summary = summarizeHeatmapCells(cells, TOP_HOTSPOT_LIMIT);
    const list = document.createElement('ol');
    list.className = 'developer-telemetry-heatmap-hotspots';
    summary.top.forEach((cell, index) => {
        const item = document.createElement('li');
        item.setAttribute('data-heatmap-hotspot-index', String(index));
        const x = Math.round(heatmapCellCenter(cell.cx, ROUND_HEATMAP_CELL_SIZE));
        const z = Math.round(heatmapCellCenter(cell.cz, ROUND_HEATMAP_CELL_SIZE));
        item.textContent = `${KIND_LABELS[cell.kind] || cell.kind} @ x=${x} z=${z} | ${cell.count}x`;
        list.appendChild(item);
    });
    return { list, summary };
}

function createMapCard(mapKey, cells) {
    const card = document.createElement('section');
    card.className = 'developer-telemetry-card developer-telemetry-heatmap-card';
    card.setAttribute('data-heatmap-map', mapKey);

    const title = document.createElement('h4');
    title.className = 'developer-telemetry-title';
    title.textContent = mapKey;
    card.appendChild(title);

    const svg = createHeatmapSvg(mapKey, cells);
    if (svg) card.appendChild(svg);

    const { list, summary } = createHotspotList(cells);
    const meta = document.createElement('p');
    meta.className = 'developer-telemetry-heatmap-meta';
    meta.textContent = `${summary.totalSamples} Ereignisse in ${summary.cellCount} Zellen`;
    card.append(meta, list);

    return card;
}

/**
 * Zeichnet die Ereignis-Draufsicht fuer die meistgespielten Maps.
 *
 * @param {HTMLElement | null} container
 * @param {unknown} topMaps Aus dem Telemetrie-Snapshot abgeleitete Map-Buckets.
 */
export function renderTelemetryHeatmapSection(container, topMaps, options = {}) {
    if (!container) return;
    const buckets = Array.isArray(topMaps) ? topMaps : [];
    const renderable = buckets
        .map((bucket) => ({
            key: typeof bucket?.key === 'string' && bucket.key.trim() ? bucket.key.trim() : 'unknown',
            cells: normalizeHeatmapCells(bucket?.heatmap),
        }))
        .filter((entry) => entry.cells.length > 0)
        .slice(0, MAX_RENDERED_MAPS);

    const section = document.createElement('div');
    section.className = 'developer-telemetry-heatmap';
    section.setAttribute('data-telemetry-section', String(options.sectionId || 'heatmap'));

    const title = document.createElement('h3');
    title.className = 'developer-telemetry-title';
    title.textContent = String(options.title || 'Häufungspunkte (Draufsicht)');
    section.appendChild(title);

    if (renderable.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'developer-telemetry-heatmap-empty';
        empty.textContent = 'Noch keine verorteten Ereignisse aufgezeichnet.';
        section.appendChild(empty);
        container.appendChild(section);
        return;
    }

    section.appendChild(createLegend());

    const grid = document.createElement('div');
    grid.className = 'developer-telemetry-heatmap-grid';
    renderable.forEach((entry) => {
        grid.appendChild(createMapCard(entry.key, entry.cells));
    });
    section.appendChild(grid);
    container.appendChild(section);
}

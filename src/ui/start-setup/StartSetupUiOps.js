// ============================================
// StartSetupUiOps.js - shared DOM/state helpers for start-setup UI
// ============================================

import { ensureHangarSelectionWritebackState } from '../hangar/HangarSelectionWritebackContract.js';

export function ensureStartSetupLocalState(settings) {
    const startSetup = ensureHangarSelectionWritebackState(settings);
    if (startSetup) return startSetup;
    return {
        favoriteMaps: [],
        recentMaps: [],
        favoriteVehicles: [],
        recentVehicles: [],
        mapSearch: '',
        mapFilter: 'all',
        vehicleSearch: '',
        vehicleFilter: 'all',
        arcadeGhostDuelMode: 'off',
        arcadeGhostTrailCollisionEnabled: false,
    };
}

export function toggleFavoriteEntry(list, value, maxItems = 8) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue || !Array.isArray(list)) return;
    const index = list.indexOf(normalizedValue);
    if (index >= 0) {
        list.splice(index, 1);
        return;
    }
    list.unshift(normalizedValue);
    if (list.length > maxItems) list.length = maxItems;
}

export function pushRecentEntry(list, value, maxItems = 6) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue || !Array.isArray(list)) return;
    const filtered = list.filter((entry) => entry !== normalizedValue);
    filtered.unshift(normalizedValue);
    if (filtered.length > maxItems) filtered.length = maxItems;
    list.length = 0;
    list.push(...filtered);
}

export function renderQuickList(container, items, dataKey) {
    if (!container) return;
    
    // Clear container securely
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    
    if (!Array.isArray(items) || items.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'menu-hint';
        empty.textContent = 'keine';
        container.appendChild(empty);
        return;
    }
    items.forEach((value) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-btn quick-pill';
        button.textContent = String(value);
        button.dataset[dataKey] = String(value);
        container.appendChild(button);
    });
}

export function humanizePreviewCategory(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'small') return 'Kompakt';
    if (normalized === 'medium') return 'Mittel';
    if (normalized === 'large') return 'Gross';
    if (normalized === 'light') return 'Leicht';
    if (normalized === 'heavy') return 'Schwer';
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Standard';
}

export function renderSummaryBlocks(container, blocks) {
    if (!container) return;
    const normalizedBlocks = Array.isArray(blocks) ? blocks.filter(Boolean) : [];

    // Clear container securely
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    if (normalizedBlocks.length === 0) {
        container.textContent = 'Keine Auswahl vorhanden.';
        return;
    }

    normalizedBlocks.forEach((block) => {
        const label = String(block.label || '').trim();
        const value = String(block.value || '').trim();

        const blockDiv = document.createElement('div');
        blockDiv.className = 'start-summary-block';
        blockDiv.dataset.summaryLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'start-summary-label';
        labelSpan.textContent = label;

        const valueSpan = document.createElement('span');
        valueSpan.className = 'start-summary-value';
        if (block.muted) valueSpan.classList.add('is-muted');
        valueSpan.textContent = value;

        blockDiv.appendChild(labelSpan);
        blockDiv.appendChild(valueSpan);
        container.appendChild(blockDiv);
    });
}

export function renderPreviewCard(container, payload = {}) {
    if (!container) return;
    const titleText = String(payload.title || '').trim() || 'Vorschau';
    const badges = Array.isArray(payload.badges) ? payload.badges.filter(Boolean) : [];
    const facts = Array.isArray(payload.facts) ? payload.facts.filter(Boolean) : [];

    // Clear container securely
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'preview-card-title';
    titleDiv.textContent = titleText;
    container.appendChild(titleDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'preview-card-meta';
    badges.forEach((badge) => {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'preview-badge';
        badgeSpan.textContent = String(badge);
        metaDiv.appendChild(badgeSpan);
    });
    container.appendChild(metaDiv);

    const gridDiv = document.createElement('div');
    gridDiv.className = 'preview-kv-grid';
    facts.forEach((fact) => {
        const kvDiv = document.createElement('div');
        kvDiv.className = 'preview-kv';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'preview-kv-label';
        labelSpan.textContent = String(fact.label || '');

        const valueSpan = document.createElement('span');
        valueSpan.className = 'preview-kv-value';
        valueSpan.textContent = String(fact.value || '');

        kvDiv.appendChild(labelSpan);
        kvDiv.appendChild(valueSpan);
        gridDiv.appendChild(kvDiv);
    });
    container.appendChild(gridDiv);
}

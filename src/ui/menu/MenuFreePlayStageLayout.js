// Reuse the live picker nodes; their controllers and profile bindings stay attached.
const layouts = new WeakMap();

export function syncFreePlayStageLayout(panel, active, settings) {
    if (!panel?.querySelector || !panel.ownerDocument) return;
    let layout = layouts.get(panel);
    if (!active) {
        if (!layout) return;
        layout.dispose();
        for (const [node, marker] of layout.moves.toReversed()) marker.replaceWith(node);
        for (const node of layout.created) node.remove();
        for (const [section, open] of layout.sections) section.open = open;
        layouts.delete(panel);
        return;
    }
    if (!layout) {
        const doc = panel.ownerDocument;
        const map = panel.querySelector('#start-map-section');
        const vehicle = panel.querySelector('#start-vehicle-section');
        const match = panel.querySelector('#start-match-section');
        const stage = panel.querySelector('#start-map-preview-stage');
        if (!map || !vehicle || !match || !stage) return;
        layout = { moves: [], created: [], sections: [map, vehicle, match].map(node => [node, node.open]) };
        for (const section of [map, vehicle, match]) {
            const heading = doc.createElement('h3');
            heading.className = 'free-play-stage-heading';
            heading.textContent = section.querySelector('.section-title').textContent;
            section.querySelector(':scope > .menu-accordion-body').before(heading);
            layout.created.push(heading);
        }
        const move = (node, parent) => {
            if (!node) return;
            const marker = doc.createComment('picker position');
            node.before(marker);
            layout.moves.push([node, marker]);
            parent.appendChild(node);
        };
        const more = (parent, className, label) => {
            const details = doc.createElement('details');
            details.className = className;
            const summary = doc.createElement('summary');
            summary.textContent = label;
            details.appendChild(summary);
            parent.appendChild(details);
            layout.created.push(details);
            return details;
        };
        const rules = doc.createElement('div');
        rules.className = 'free-play-rules';
        panel.querySelector('.level3-body').appendChild(rules);
        layout.created.push(rules);
        const sidebarSettings = doc.createElement('div');
        sidebarSettings.className = 'free-play-sidebar-settings';
        rules.appendChild(sidebarSettings);
        layout.created.push(sidebarSettings);
        move(vehicle, sidebarSettings);
        move(match, sidebarSettings);
        move(panel.querySelector('.start-rail'), rules);
        const body = vehicle.querySelector(':scope > .menu-accordion-body');
        const vehicleMore = more(body, 'free-play-vehicle-more', 'Details und Filter');
        for (const selector of ['.setup-search-grid', '#vehicle-search-empty', '.start-vehicle-description',
            '.start-vehicle-badges', '.start-vehicle-stats', '#btn-vehicle-favorite-toggle',
            '#btn-vehicle-view-reset',
            '.start-vehicle-preview-hint', '#start-vehicle-choice-strip', '.setup-chip-grid']) {
            move(vehicle.querySelector(selector), vehicleMore);
        }
        const mapDetails = map.querySelector('.start-map-details');
        const mapMore = more(mapDetails, 'free-play-map-more', 'Kartendetails und Favoriten');
        for (const selector of ['#map-preview', '#map-profile-card', '#btn-map-favorite-toggle', '#map-shortcut-hints']) {
            move(map.querySelector(selector), mapMore);
        }
        const reset = doc.createElement('button');
        reset.type = 'button';
        reset.className = 'secondary-btn free-play-map-reset';
        reset.textContent = 'Alle Karten anzeigen';
        reset.addEventListener('click', () => {
            const search = panel.querySelector('#map-search-input');
            const filter = panel.querySelector('#map-filter-select');
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            filter.value = 'all';
            filter.dispatchEvent(new Event('change', { bubbles: true }));
            search.focus();
        });
        map.querySelector('.setup-search-grid').appendChild(reset);
        layout.created.push(reset);
        layout.reset = reset;
        const refresh = () => {
            reset.hidden = !panel.querySelector('#map-search-input').value.trim()
                && panel.querySelector('#map-filter-select').value === 'all';
        };
        map.addEventListener('input', refresh);
        map.addEventListener('change', refresh);
        layout.dispose = () => {
            map.removeEventListener('input', refresh);
            map.removeEventListener('change', refresh);
        };
        layouts.set(panel, layout);
    }
    // These panels form one simultaneous stage; only the additional details collapse.
    for (const [section] of layout.sections) section.open = true;
    const filters = settings?.localSettings?.startSetup;
    layout.reset.hidden = !String(filters?.mapSearch || '').trim() && (!filters?.mapFilter || filters.mapFilter === 'all');
}

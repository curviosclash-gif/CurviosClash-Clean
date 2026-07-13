import { createMenuSchema } from './MenuSchema.js';

function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export class MenuPanelRegistry {
    constructor(schema = null) {
        this._schema = schema && typeof schema === 'object'
            ? schema
            : createMenuSchema();
        this._panelById = new Map();
        this._panelBySemanticId = new Map();
        this._aliasToPanelId = new Map();
        this._populateIndexes();
    }

    _populateIndexes() {
        const schema = this._schema;
        const panels = Array.isArray(schema?.panels) ? schema.panels : [];

        this._panelById.clear();
        this._panelBySemanticId.clear();
        this._aliasToPanelId.clear();

        for (const panel of panels) {
            if (!panel || typeof panel !== 'object') continue;
            const panelId = normalizeId(panel.id);
            if (!panelId) continue;

            this._panelById.set(panelId, panel);

            const semanticId = normalizeId(panel.semanticId);
            if (semanticId) {
                this._panelBySemanticId.set(semanticId, panel);
                this._aliasToPanelId.set(semanticId, panelId);
            }

            const legacyIds = Array.isArray(panel.legacyIds) ? panel.legacyIds : [];
            for (const legacyId of legacyIds) {
                const alias = normalizeId(legacyId);
                if (!alias) continue;
                this._aliasToPanelId.set(alias, panelId);
            }
        }

        const compatibilityAliases = schema?.compatibilityAliases && typeof schema.compatibilityAliases === 'object'
            ? schema.compatibilityAliases
            : {};
        for (const [alias, targetId] of Object.entries(compatibilityAliases)) {
            const normalizedAlias = normalizeId(alias);
            const normalizedTarget = normalizeId(targetId);
            if (!normalizedAlias || !normalizedTarget) continue;
            this._aliasToPanelId.set(normalizedAlias, normalizedTarget);
        }
    }

    getSchema() {
        return this._schema;
    }

    resolvePanelId(requestedId) {
        const normalized = normalizeId(requestedId);
        if (!normalized) return '';
        if (this._panelById.has(normalized)) return normalized;
        return this._aliasToPanelId.get(normalized) || '';
    }

    getPanelById(requestedId) {
        const panelId = this.resolvePanelId(requestedId);
        if (!panelId) return null;
        return this._panelById.get(panelId) || null;
    }

    getPanelBySemanticId(semanticId) {
        const normalized = normalizeId(semanticId);
        if (!normalized) return null;
        return this._panelBySemanticId.get(normalized) || null;
    }

    listPanels(options = {}) {
        const includeHidden = options.includeHidden === true;
        const out = [];
        for (const panel of this._panelById.values()) {
            if (!includeHidden && panel.visibility === 'hidden') continue;
            out.push(panel);
        }
        out.sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
        return out;
    }

    listNavItems() {
        const navItems = Array.isArray(this._schema?.navItems) ? this._schema.navItems : [];
        return navItems.slice().sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    }

    getPanelLabel(requestedId, fallback = 'Untermenue') {
        const panel = this.getPanelById(requestedId);
        const label = normalizeId(panel?.label);
        return label || fallback;
    }
}

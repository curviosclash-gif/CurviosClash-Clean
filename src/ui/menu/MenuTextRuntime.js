import { MENU_TEXT_CATALOG } from './MenuTextCatalog.js';
import { MenuTextOverrideStore } from './MenuTextOverrideStore.js';

function sanitizeTextId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized;
}

export class MenuTextRuntime {
    constructor(options = {}) {
        this.catalog = options.catalog && typeof options.catalog === 'object'
            ? options.catalog
            : MENU_TEXT_CATALOG;
        const overridePort = options.overridePort || options.overrideStore;
        this.overridePort = overridePort && typeof overridePort.getOverride === 'function'
            ? overridePort
            : new MenuTextOverrideStore();
    }

    resolveText(textId, options = {}) {
        const normalizedTextId = sanitizeTextId(textId);
        if (!normalizedTextId) return '';

        const defaultText = String(this.catalog?.[normalizedTextId] || '');
        const allowOverrides = options.allowOverrides !== false;
        const releasePreviewEnabled = options.releasePreviewEnabled === true;
        const featureFlagEnabled = options.developerFeatureEnabled !== false;
        const developerModeEnabled = options.developerModeEnabled === true;
        const overridesEnabled = allowOverrides && developerModeEnabled && featureFlagEnabled && !releasePreviewEnabled;

        if (!overridesEnabled) {
            return defaultText;
        }
        const overrideText = this.overridePort.getOverride(normalizedTextId);
        return overrideText || defaultText;
    }

    applyToDocument(root, options = {}) {
        const container = root || (typeof document !== 'undefined' ? document : null);
        if (!container) return 0;

        const textNodes = Array.from(container.querySelectorAll('[data-menu-text-id]'));
        let updatedCount = 0;
        textNodes.forEach((node) => {
            const textId = sanitizeTextId(node.getAttribute('data-menu-text-id'));
            if (!textId) return;
            const resolvedText = this.resolveText(textId, options);
            if (!resolvedText) return;
            node.textContent = resolvedText;
            updatedCount += 1;
        });
        return updatedCount;
    }
}

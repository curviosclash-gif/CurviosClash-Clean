function resolveMenuDepth(panelId, level4Open) {
    const normalizedPanelId = String(panelId || '').trim();
    if (normalizedPanelId === 'submenu-custom') return 2;
    if (normalizedPanelId === 'submenu-game') return level4Open ? 4 : 3;
    if (normalizedPanelId === 'submenu-expert') return 2;
    if (normalizedPanelId === 'submenu-developer' || normalizedPanelId === 'submenu-debug') return 5;
    return 1;
}

export function applyMenuChromeState(root, { panelId = null, level4Open = false } = {}) {
    if (!root) return;
    const normalizedPanelId = String(panelId || '').trim();
    const normalizedLevel4Open = level4Open === true;
    const depth = resolveMenuDepth(normalizedPanelId, normalizedLevel4Open);
    root.setAttribute('data-menu-depth', String(depth));
    root.setAttribute('data-menu-panel', normalizedPanelId || 'main');
    root.setAttribute('data-level4-open', String(normalizedLevel4Open));
}

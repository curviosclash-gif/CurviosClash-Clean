export const MENU_DEVELOPER_THEMES = Object.freeze({
    'classic-console': Object.freeze({
        id: 'classic-console',
        label: 'Classic Console',
        variables: Object.freeze({
            '--menu-theme-bg': 'radial-gradient(ellipse at center, rgba(10, 10, 30, 0.92) 0%, rgba(0, 0, 0, 0.98) 100%)',
            '--menu-theme-panel-bg': 'rgba(20, 20, 40, 0.72)',
            '--menu-theme-border': 'rgba(100, 180, 255, 0.15)',
            '--menu-theme-accent': '#00aaff',
            '--menu-theme-accent-strong': '#00ddff',
            '--menu-theme-muted': '#93a4c6',
            '--menu-theme-title-gradient-start': '#00aaff',
            '--menu-theme-title-gradient-end': '#ff6600',
            '--menu-theme-ui-font': "'Inter', sans-serif",
            '--menu-theme-heading-font': "'Orbitron', monospace",
        }),
    }),
    'sandstorm-lab': Object.freeze({
        id: 'sandstorm-lab',
        label: 'Sandstorm Lab',
        variables: Object.freeze({
            '--menu-theme-bg': 'radial-gradient(ellipse at center, rgba(36, 26, 11, 0.92) 0%, rgba(8, 6, 2, 0.98) 100%)',
            '--menu-theme-panel-bg': 'rgba(42, 31, 15, 0.78)',
            '--menu-theme-border': 'rgba(237, 192, 117, 0.25)',
            '--menu-theme-accent': '#e7a23b',
            '--menu-theme-accent-strong': '#ffd39a',
            '--menu-theme-muted': '#d1b894',
            '--menu-theme-title-gradient-start': '#ffd39a',
            '--menu-theme-title-gradient-end': '#e78d2f',
            '--menu-theme-ui-font': "'Trebuchet MS', sans-serif",
            '--menu-theme-heading-font': "'Orbitron', monospace",
        }),
    }),
    'arctic-grid': Object.freeze({
        id: 'arctic-grid',
        label: 'Arctic Grid',
        variables: Object.freeze({
            '--menu-theme-bg': 'radial-gradient(ellipse at center, rgba(8, 24, 35, 0.9) 0%, rgba(2, 8, 15, 0.98) 100%)',
            '--menu-theme-panel-bg': 'rgba(14, 37, 52, 0.76)',
            '--menu-theme-border': 'rgba(114, 197, 230, 0.28)',
            '--menu-theme-accent': '#63c9f0',
            '--menu-theme-accent-strong': '#b8f0ff',
            '--menu-theme-muted': '#a3c7d5',
            '--menu-theme-title-gradient-start': '#b8f0ff',
            '--menu-theme-title-gradient-end': '#3aa8d4',
            '--menu-theme-ui-font': "'Verdana', sans-serif",
            '--menu-theme-heading-font': "'Orbitron', monospace",
        }),
    }),
});

export function listMenuDeveloperThemes() {
    return Object.values(MENU_DEVELOPER_THEMES).map((theme) => ({
        id: theme.id,
        label: theme.label,
    }));
}

export function resolveMenuDeveloperTheme(themeId) {
    const normalizedThemeId = typeof themeId === 'string' ? themeId.trim() : '';
    if (normalizedThemeId && MENU_DEVELOPER_THEMES[normalizedThemeId]) {
        return MENU_DEVELOPER_THEMES[normalizedThemeId];
    }
    return MENU_DEVELOPER_THEMES['classic-console'];
}

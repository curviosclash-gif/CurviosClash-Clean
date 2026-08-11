process.env.PW_RUN_PROFILE = String(process.env.PW_RUN_PROFILE || 'desktop-e2e');

const { default: desktopConfig } = await import('./playwright.config.js');

export default desktopConfig;

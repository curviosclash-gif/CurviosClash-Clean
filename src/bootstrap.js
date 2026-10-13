async function startApplication() {
    if (window.curviosMarketing) {
        const { createMarketingCaptureView } = await import('./ui/marketing/MarketingCaptureView.js');
        window.__CURVIOS_MARKETING_VIEW_FACTORY__ = createMarketingCaptureView;
    }
    await import('./core/main.js');
}

startApplication();

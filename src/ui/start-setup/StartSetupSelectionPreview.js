import { humanizePreviewCategory, renderPreviewCard } from './StartSetupUiOps.js';

export function formatMapRenderMode(renderMode) {
    if (renderMode === 'GLB+FALLBACK') return '3D-Modell (mit Ersatzdarstellung)';
    if (renderMode === 'GLB') return '3D-Modell';
    return 'Standardgeometrie';
}

export function renderSelectionPreviews(ui, mapPreview, vehiclePreviewP1, vehiclePreviewP2) {
    if (ui.mapPreview) {
        renderPreviewCard(ui.mapPreview, {
            title: mapPreview.name,
            description: mapPreview.description,
            badges: [
                formatMapRenderMode(mapPreview.renderMode),
                mapPreview.hasParcours ? 'Parcours' : null,
                humanizePreviewCategory(mapPreview.category),
                mapPreview.portalLevelCount > 1 ? `${mapPreview.portalLevelCount} Ebenen` : mapPreview.sizeText,
            ].filter(Boolean),
            facts: [
                { label: 'Größe', value: mapPreview.sizeText },
                { label: 'Hindernisse', value: String(mapPreview.obstacleCount) },
                { label: 'Portal-Paare', value: String(mapPreview.portalCount) },
                mapPreview.gateCount > 0 ? { label: 'Tore', value: String(mapPreview.gateCount) } : null,
                mapPreview.tunnelCount > 0 ? { label: 'Tunnel', value: String(mapPreview.tunnelCount) } : null,
                mapPreview.spawnCount > 0 ? { label: 'Startpunkte', value: String(mapPreview.spawnCount) } : null,
                mapPreview.itemAnchorCount > 0 ? { label: 'Gegenstände', value: String(mapPreview.itemAnchorCount) } : null,
                mapPreview.aircraftCount > 0 ? { label: 'Deko-Flieger', value: String(mapPreview.aircraftCount) } : null,
            ].filter(Boolean),
        });
    }
    if (ui.vehiclePreviewP1 && !ui.vehiclePreview3dMount) {
        renderPreviewCard(ui.vehiclePreviewP1, {
            title: vehiclePreviewP1.label,
            badges: ['Pilot 1', humanizePreviewCategory(vehiclePreviewP1.category)],
            facts: [
                { label: 'Klasse', value: humanizePreviewCategory(vehiclePreviewP1.category) },
                { label: 'Hitbox', value: vehiclePreviewP1.hitboxRadius.toFixed(2) },
            ],
        });
    }
    if (ui.vehiclePreviewP2 && !ui.vehiclePreview3dMount) {
        renderPreviewCard(ui.vehiclePreviewP2, {
            title: vehiclePreviewP2.label,
            badges: ['Pilot 2', humanizePreviewCategory(vehiclePreviewP2.category)],
            facts: [
                { label: 'Klasse', value: humanizePreviewCategory(vehiclePreviewP2.category) },
                { label: 'Hitbox', value: vehiclePreviewP2.hitboxRadius.toFixed(2) },
            ],
        });
    }
}

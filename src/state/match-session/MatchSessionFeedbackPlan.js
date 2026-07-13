import { CUSTOM_MAP_KEY } from '../../entities/MapSchema.js';

export function deriveMapResolutionFeedbackPlan({ mapResolution, portalsEnabled, arenaBuildResult = null }) {
    const consoleEntries = [];
    const toasts = [];

    if (!mapResolution) {
        return { consoleEntries, toasts };
    }

    if (mapResolution.error) {
        consoleEntries.push({
            level: 'warn',
            args: ['[Game] Map loading fallback:', mapResolution.error, mapResolution.details || ''],
        });
    }
    if (Array.isArray(mapResolution.warnings) && mapResolution.warnings.length > 0) {
        consoleEntries.push({
            level: 'warn',
            args: ['[Game] Map loading warnings:', mapResolution.warnings],
        });
    }
    if (mapResolution.message) {
        consoleEntries.push({
            level: 'info',
            args: ['[Game] Map loading message:', mapResolution.message],
        });
    }
    if (Array.isArray(arenaBuildResult?.glbLoadWarnings) && arenaBuildResult.glbLoadWarnings.length > 0) {
        consoleEntries.push({
            level: 'warn',
            args: ['[Game] GLB map loading warnings:', arenaBuildResult.glbLoadWarnings],
        });
    }

    if (mapResolution.isFallback && mapResolution.requestedMapKey === CUSTOM_MAP_KEY) {
        toasts.push({
            message: mapResolution.message || 'Custom-Map ungueltig, Standard-Map geladen',
            durationMs: 2600,
            tone: 'error',
        });
    } else if (mapResolution.isFallback) {
        toasts.push({
            message: `Map-Fallback aktiv: ${mapResolution.effectiveMapKey}`,
            durationMs: 2200,
            tone: 'error',
        });
    } else if (mapResolution.isCustom && Array.isArray(mapResolution.warnings) && mapResolution.warnings.length > 0) {
        const extraCount = Math.max(0, mapResolution.warnings.length - 1);
        const prefix = String(mapResolution.message || '').trim();
        const suffix = extraCount > 0 ? ` (+${extraCount} Hinweis(e) in Konsole)` : '';
        const baseMessage = prefix || `Custom-Map Hinweis: ${mapResolution.warnings[0]}`;
        toasts.push({
            message: `${baseMessage}${suffix}`.trim(),
            durationMs: mapResolution.migration ? 4200 : 3600,
            tone: mapResolution.migration ? 'warning' : 'info',
        });
    }
    if (arenaBuildResult?.glbLoadError) {
        toasts.push({
            message: 'GLB-Map konnte nicht geladen werden, Box-Fallback aktiv',
            durationMs: 2600,
            tone: 'error',
        });
    }

    if (mapResolution.isCustom && mapResolution.mapDocument && mapResolution.mapDefinition) {
        const runtimeObstacleCount = Array.isArray(mapResolution.mapDefinition.obstacles)
            ? mapResolution.mapDefinition.obstacles.length
            : 0;
        const runtimePortalCount = Array.isArray(mapResolution.mapDefinition.portals)
            ? mapResolution.mapDefinition.portals.length
            : 0;
        const runtimeGateCount = Array.isArray(mapResolution.mapDefinition.gates)
            ? mapResolution.mapDefinition.gates.length
            : 0;
        if (runtimeObstacleCount === 0 && runtimePortalCount > 0 && runtimeGateCount === 0 && !portalsEnabled) {
            toasts.push({
                message: 'Custom-Map hat nur Portale, aber Portale sind im Menue deaktiviert.',
                durationMs: 3400,
                tone: 'error',
            });
        }

        const rawItemSpawnMode = String(
            mapResolution.mapDefinition.itemSpawnAuthoring?.mode ||
            mapResolution.mapDefinition.itemSpawnMode || ''
        ).trim().toLowerCase();
        const isAnchorOnly = rawItemSpawnMode === 'anchor-only';
        const hasNoItemAnchors = !Array.isArray(mapResolution.mapDefinition.items) ||
            mapResolution.mapDefinition.items.length === 0;
        if (isAnchorOnly && hasNoItemAnchors) {
            toasts.push({
                message: 'Spawn-Modus "anchor-only", aber keine Item-Anker in der Map — Items spawnen nicht.',
                durationMs: 3800,
                tone: 'warning',
            });
        }
    }

    return { consoleEntries, toasts };
}

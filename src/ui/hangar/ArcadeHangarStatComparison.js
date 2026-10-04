import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { ARCADE_FACTORY_VEHICLE_IDS } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import { ARCADE_BUILD_STAT_KEYS } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { resolveArcadeVehicleActiveStats } from '../../shared/contracts/ArcadeVehicleActiveStatsContract.js';
import { deltaText } from './HangarWorkshopRenderText.js';

/** Factory references deliberately exclude player profiles, purchases and stones. */
export function resolveArcadeHangarStatReferences(vehicleId) {
    const factory = resolveArcadeVehicleActiveStats(vehicleId, null);
    const fleet = ARCADE_FACTORY_VEHICLE_IDS.map((id) => resolveArcadeVehicleActiveStats(id, null));
    const average = Object.fromEntries(ARCADE_BUILD_STAT_KEYS.map((key) => [
        key, Math.round(fleet.reduce((sum, stats) => sum + stats[key], 0) / fleet.length * 100) / 100,
    ]));
    return { factory, average };
}

/** Native meters share a scale per metric, with textual values for keyboard/screen-reader users. */
export function renderArcadeHangarStatComparison(root, { vehicleId, current, saved, reference, baselineLabel, comparisonLabel, compare }) {
    const { factory, average } = resolveArcadeHangarStatReferences(vehicleId);
    const savedMetrics = compare(current, saved);
    const referenceMetrics = compare(current, reference);
    root.replaceChildren();
    savedMetrics.forEach((metric, index) => {
        const row = el('div', 'arcade-vehicle-compare-row hangar-stat-row');
        row.dataset.metric = metric.key;
        row.append(el('span', 'arcade-vehicle-compare-label', metric.label), el('strong', 'hangar-stat-value', String(metric.value)));
        const comparisons = el('div', 'hangar-stat-comparisons');
        const samples = [
            ['Eigener Build', metric.value], ['Werkszustand', factory[metric.key]], ['Flottendurchschnitt', average[metric.key]],
        ];
        const max = Math.max(1, ...samples.map(([, value]) => Number(value)));
        for (const [label, value] of samples) {
            const sample = el('label', 'hangar-stat-reference', `${label}: ${value}`);
            const meter = el('meter', 'hangar-stat-meter');
            meter.setAttribute('min', '0');
            meter.setAttribute('max', String(max));
            meter.setAttribute('value', String(value));
            meter.setAttribute('aria-label', `${metric.label} – ${label}: ${value}`);
            sample.appendChild(meter);
            comparisons.appendChild(sample);
        }
        const versus = referenceMetrics[index];
        comparisons.append(
            el('span', `hangar-stat-delta is-${metric.tone}`, `Seit ${baselineLabel}: ${deltaText(metric.delta)}`),
            el('span', `hangar-stat-delta is-${versus.tone}`, `Gegen ${comparisonLabel}: ${deltaText(versus.delta)}`),
        );
        row.appendChild(comparisons);
        root.appendChild(row);
    });
}

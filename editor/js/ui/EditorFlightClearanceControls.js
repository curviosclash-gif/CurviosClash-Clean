import { evaluateFlightClearance } from '../EditorFlightClearance.js';
import { createEditorCollisionProbe } from './EditorCollisionValidation.js';

const WARNING_TEXT = Object.freeze({
    geometry: 'Kollision!',
    floor: 'Boden!',
    outside: 'Außerhalb der Arena!',
});

/**
 * Flight test: while flying, the hull, the crosshair and a badge turn red wherever the match
 * would crash the ship. Nothing stops the flight; it only shows where a gap is too tight.
 */
export function bindEditorFlightClearanceControls(editor, flight) {
    const core = editor?.core;
    if (!core || !flight) return;
    const dom = editor.dom || {};
    let probe = null;
    let lastReason = null;

    // The probe compiles the map once; placing a part in flight or a new map rebuilds it.
    const invalidate = () => { probe = null; };
    editor.invalidateFlightClearance = invalidate;

    const showWarning = (reason) => {
        if (reason === lastReason) return;
        lastReason = reason;
        flight.setCollisionWarning(reason !== null);
        dom.shipFlightHud?.classList.toggle('is-colliding', reason !== null);
        if (!dom.shipFlightWarning) return;
        dom.shipFlightWarning.hidden = reason === null;
        dom.shipFlightWarning.textContent = reason ? WARNING_TEXT[reason] : '';
    };

    flight.onFrame(() => {
        const params = flight.getParams();
        if (!params || !editor.mapManager) return;
        probe ||= createEditorCollisionProbe(editor, core.objectsContainer.children);
        const result = evaluateFlightClearance({
            position: flight.getPosition(),
            arenaSize: editor.getArenaSizeForExport(),
            hitboxRadiusWorld: params.hitboxRadius / params.unitsPerWorldUnit,
            unitsPerWorldUnit: params.unitsPerWorldUnit,
            isBlocked: probe,
        });
        showWarning(result.reason);
    });
    flight.onStop(() => {
        showWarning(null);
        invalidate();
    });

    editor.getFlightClearance = () => lastReason;
}

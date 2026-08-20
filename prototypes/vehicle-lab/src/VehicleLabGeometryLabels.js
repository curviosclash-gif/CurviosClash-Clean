import { VEHICLE_LAB_GEOMETRIES } from '../../../src/shared/contracts/VehicleLabConfigContract.js';

const DEFAULT_AXES = Object.freeze(['X', 'Y', 'Z']);

// Was die drei Zahlen unter "Grundabmessungen" je Form bedeuten. Bei einem
// Quader ist es die Kantenlaenge, bei einer Kugel dagegen der Radius - wer 1,2
// eintraegt, bekommt dort ein 2,4 grosses Bauteil. Ohne Beschriftung ist das
// nicht zu erraten.
const GEOMETRY_DIMENSION_LABELS = Object.freeze({
    box: Object.freeze(['Breite', 'Höhe', 'Tiefe']),
    sphere: Object.freeze(['Radius']),
    cylinder: Object.freeze(['Radius oben', 'Radius unten', 'Höhe']),
    cone: Object.freeze(['Radius', 'Höhe']),
    torus: Object.freeze(['Radius', 'Rohrdicke']),
    capsule: Object.freeze(['Radius', 'Länge']),
    pylon: Object.freeze(['Radius oben', 'Radius unten', 'Höhe']),
    engine: Object.freeze(['Radius oben', 'Radius unten', 'Länge']),
    forcefield: Object.freeze(['Radius oben', 'Radius unten', 'Höhe']),
    flame: Object.freeze(['Radius oben', 'Radius unten', 'Länge']),
});

/**
 * Liefert die Achsenbeschriftungen der Grundabmessungen einer Form.
 * @param {string} geometry
 * @returns {string[]}
 */
export function describeGeometryDimensions(geometry) {
    const labels = GEOMETRY_DIMENSION_LABELS[String(geometry || '').toLowerCase()];
    return labels ? [...labels] : [...DEFAULT_AXES];
}

/**
 * Anzahl der Zahlen, die eine Form tatsaechlich auswertet. Alles darueber
 * hinaus wird von der Geometrie ignoriert.
 * @param {string} geometry
 * @returns {number}
 */
export function countGeometryDimensions(geometry) {
    return describeGeometryDimensions(geometry).length;
}

export function listLabelledGeometries() {
    return Object.keys(GEOMETRY_DIMENSION_LABELS);
}

export { GEOMETRY_DIMENSION_LABELS, VEHICLE_LAB_GEOMETRIES };

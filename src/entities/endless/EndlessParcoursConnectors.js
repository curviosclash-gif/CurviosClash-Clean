/**
 * Anschlussstuecke der Endlosjagd. Ein Anschluss beschreibt, wie weit der
 * Korridor am Modulende seitlich bzw. in der Hoehe versetzt ist. Der Versatz
 * wird *innerhalb* des Moduls ueber mehrere Z-Segmente interpoliert, damit die
 * Kurve fahrbar bleibt und alle Kollisionskoerper achsparallel bleiben - eine
 * echte Drehung wuerde die Box-Kollision des Projekts nicht ueberleben.
 */

export const ENDLESS_COURSE_HALF_WIDTH = 27;
export const ENDLESS_COURSE_SEGMENTS = 6;

export const ENDLESS_CONNECTORS = Object.freeze({
    straight: Object.freeze({ id: 'straight', offsetX: 0, offsetY: 0, weight: 5 }),
    bend_left: Object.freeze({ id: 'bend_left', offsetX: -14, offsetY: 0, weight: 4 }),
    bend_right: Object.freeze({ id: 'bend_right', offsetX: 14, offsetY: 0, weight: 4 }),
    climb: Object.freeze({ id: 'climb', offsetX: 0, offsetY: 9, weight: 3 }),
    dive: Object.freeze({ id: 'dive', offsetX: 0, offsetY: -7, weight: 3 }),
    bank_left: Object.freeze({ id: 'bank_left', offsetX: -11, offsetY: 6, weight: 2 }),
    bank_right: Object.freeze({ id: 'bank_right', offsetX: 11, offsetY: -5, weight: 2 }),
});

export const ENDLESS_CONNECTOR_IDS = Object.freeze(Object.keys(ENDLESS_CONNECTORS));

export const ENDLESS_DRIFT_LIMITS = Object.freeze({
    minX: -42,
    maxX: 42,
    minY: -12,
    maxY: 30,
});

/**
 * @param {unknown} id
 * @returns {typeof ENDLESS_CONNECTORS.straight}
 */
export function resolveEndlessConnector(id) {
    const key = String(id || '').trim();
    return ENDLESS_CONNECTORS[key] || ENDLESS_CONNECTORS.straight;
}

/**
 * Der Korridor darf nicht ins Unendliche driften. Ein Anschluss gilt nur als
 * waehlbar, wenn der Weltversatz danach noch in den Grenzen liegt.
 *
 * @param {{ x: number, y: number }} drift
 * @param {typeof ENDLESS_CONNECTORS.straight} connector
 * @returns {boolean}
 */
export function isEndlessConnectorAllowed(drift, connector) {
    const nextX = (Number(drift?.x) || 0) + connector.offsetX;
    const nextY = (Number(drift?.y) || 0) + connector.offsetY;
    return nextX >= ENDLESS_DRIFT_LIMITS.minX
        && nextX <= ENDLESS_DRIFT_LIMITS.maxX
        && nextY >= ENDLESS_DRIFT_LIMITS.minY
        && nextY <= ENDLESS_DRIFT_LIMITS.maxY;
}

/**
 * Interpoliert den Korridormittelpunkt an einer Stelle im Modul. `progress` 0
 * ist der Moduleingang, 1 der Ausgang. Eine Kosinus-Blende vermeidet die harte
 * Kante, die ein linearer Versatz am Modulanfang erzeugen wuerde.
 *
 * @param {{ x: number, y: number }} entryDrift
 * @param {{ x: number, y: number }} exitDrift
 * @param {number} progress
 * @returns {{ x: number, y: number }}
 */
export function resolveEndlessCourseCenter(entryDrift, exitDrift, progress) {
    const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
    const blend = 0.5 - Math.cos(clamped * Math.PI) * 0.5;
    const fromX = Number(entryDrift?.x) || 0;
    const fromY = Number(entryDrift?.y) || 0;
    const toX = Number(exitDrift?.x) || 0;
    const toY = Number(exitDrift?.y) || 0;
    return {
        x: fromX + (toX - fromX) * blend,
        y: fromY + (toY - fromY) * blend,
    };
}

export default {
    ENDLESS_CONNECTORS,
    ENDLESS_CONNECTOR_IDS,
    ENDLESS_COURSE_HALF_WIDTH,
    ENDLESS_COURSE_SEGMENTS,
    ENDLESS_DRIFT_LIMITS,
    isEndlessConnectorAllowed,
    resolveEndlessConnector,
    resolveEndlessCourseCenter,
};

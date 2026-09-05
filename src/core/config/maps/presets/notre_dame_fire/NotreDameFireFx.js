import { GROUND } from '../notre_dame/NotreDameStructure.js';

// A small deterministic presentation layer around the three places that actually burn. The GLB
// flames provide the close silhouette; these particles carry smoke and ash far enough that the
// fire can be read during the western approach and from the arena's lower routes.
export const NOTRE_DAME_FIRE_FX = Object.freeze({
    emitters: Object.freeze([
        Object.freeze({
            position: Object.freeze([-38, GROUND + 44, 0]),
            radius: 14,
            smokeHeight: 74,
            emberHeight: 30,
            phase: 0.08,
        }),
        Object.freeze({
            position: Object.freeze([17, GROUND + 40, -7]),
            radius: 17,
            smokeHeight: 92,
            emberHeight: 38,
            phase: 0.41,
        }),
        Object.freeze({
            position: Object.freeze([54, GROUND + 45, 1]),
            radius: 13,
            smokeHeight: 68,
            emberHeight: 27,
            phase: 0.73,
        }),
    ]),
    smoke: Object.freeze({
        count: 54,
        color: 0x2b1512,
        size: 11,
        lifetime: 12,
        opacity: 0.28,
    }),
    embers: Object.freeze({
        count: 58,
        color: 0xff7b24,
        size: 0.72,
        lifetime: 4.8,
        opacity: 0.92,
    }),
    ash: Object.freeze({
        count: 72,
        color: 0xc4aea0,
        size: 0.42,
        lifetime: 14,
        opacity: 0.5,
    }),
    // The prevailing wind carries the column west, into the route's first long sightline.
    wind: Object.freeze([-3.4, 0.8, 1.15]),
    ashVolumeMin: Object.freeze([-205, GROUND + 3, -82]),
    ashVolumeMax: Object.freeze([118, GROUND + 112, 82]),
    // The two endpoint fill lights stay constant; only sources physically attached to flames pulse.
    flicker: Object.freeze([
        Object.freeze({ lightId: 'ndf_crossing_breach', amplitude: 0.14, frequency: 1.37, phase: 0.1 }),
        Object.freeze({ lightId: 'ndf_transept_breach', amplitude: 0.12, frequency: 1.83, phase: 1.4 }),
        Object.freeze({ lightId: 'ndf_aisle_breach', amplitude: 0.1, frequency: 2.17, phase: 2.2 }),
        Object.freeze({ lightId: 'ndf_attic_west', amplitude: 0.11, frequency: 1.11, phase: 3.3 }),
        Object.freeze({ lightId: 'ndf_attic_east', amplitude: 0.1, frequency: 1.61, phase: 4.7 }),
        Object.freeze({ lightId: 'ndf_debris_glow', amplitude: 0.08, frequency: 0.79, phase: 5.4 }),
    ]),
});

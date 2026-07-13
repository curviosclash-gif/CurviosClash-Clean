export const MODE_ID_CLASSIC = 0;
export const MODE_ID_HUNT = 1;

export function encodeModeId(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    return normalized === 'hunt' || normalized === 'fight'
        ? MODE_ID_HUNT
        : MODE_ID_CLASSIC;
}

// Labels for the rows of the key editor. UP/DOWN read as the direction the nose actually
// moves; with the factory setting (invert pitch on) UP lowers the nose, so the label follows it.
export const KEY_BIND_ACTIONS = [
    { label: 'Nase senken', key: 'UP' },
    { label: 'Nase heben', key: 'DOWN' },
    { label: 'Links drehen', key: 'LEFT' },
    { label: 'Rechts drehen', key: 'RIGHT' },
    { label: 'Nach links rollen', key: 'ROLL_LEFT' },
    { label: 'Nach rechts rollen', key: 'ROLL_RIGHT' },
    { label: 'Boost', key: 'BOOST' },
    { label: 'Zeitlupe', key: 'SLOWMO' },
    { label: 'Rakete abfeuern', key: 'SHOOT' },
    { label: 'MG feuern', key: 'SHOOT_MG' },
    { label: 'Item nutzen', key: 'USE_ITEM' },
    { label: 'Item wechseln', key: 'NEXT_ITEM' },
    { label: 'Kamera wechseln', key: 'CAMERA' },
];

export const GLOBAL_KEY_BIND_ACTIONS = [
    { label: 'Cinematic-Kamera + Aufnahme starten', key: 'CINEMATIC_TOGGLE' },
    { label: 'Cinematic-Aufnahme stoppen', key: 'RECORDING_TOGGLE' },
];

export function resolveKeybindActionLabel(action, { invertPitch = true } = {}) {
    if (action?.key === 'UP') return invertPitch === false ? 'Nase heben' : 'Nase senken';
    if (action?.key === 'DOWN') return invertPitch === false ? 'Nase senken' : 'Nase heben';
    return String(action?.label || '');
}

import { AudioManager } from '../../core/Audio.js';

/**
 * Stellt dem Hangar-Fenster Klang bereit, ohne dass die Oberflaeche die
 * Runtime kennt.
 *
 * Das Hangar-Fenster ist eine eigene Seite und baut sich seine Bausteine
 * selbst zusammen. Als es dafuer `core/Audio.js` direkt importierte, riss die
 * Schichtgrenze ui -> core, und der Architektur-Guard war fuer jede Aufgabe im
 * Projekt rot. Die Verdrahtung gehoert hierher; die Oberflaeche bekommt nur
 * noch das fertige Ergebnis.
 *
 * @param {object} [audioSettings] Klang-Einstellungen aus dem gespeicherten Profil.
 * @param {{musicState?: string}} [options] Anfangszustand der Musik.
 * @returns {object} Der Klang-Gegenstand, wie ihn die Werkstatt erwartet.
 */
export function createHangarAudioPort(audioSettings, { musicState = 'menu' } = {}) {
    const audio = new AudioManager(audioSettings);
    if (musicState) audio.setMusicState(musicState);
    return audio;
}

export default { createHangarAudioPort };

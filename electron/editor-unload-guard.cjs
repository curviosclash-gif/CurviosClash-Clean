'use strict';

/**
 * Macht die beforeunload-Sperre der Autorenfenster sichtbar.
 *
 * Der Editor setzt bei ungespeicherten Aenderungen eine beforeunload-Sperre.
 * Der Browser fragt dann "Seite verlassen?"; Electron fragt nur, wenn der
 * Hauptprozess auf will-prevent-unload hoert. Ohne diesen Lauscher tat ein
 * Klick auf X oder eine Navigation schlicht nichts.
 *
 * Achtung, umgekehrte Logik: preventDefault() heisst hier "Sperre uebergehen
 * und das Fenster verlassen". Wer nichts tut, bleibt im Fenster.
 *
 * @param {{isDestroyed: () => boolean, webContents: {on: Function}}} window
 * @param {{dialog: {showMessageBoxSync: Function}}} options
 */
function installEditorUnloadGuard(window, { dialog }) {
    window.webContents.on('will-prevent-unload', (event) => {
        if (window.isDestroyed()) return;
        let response = 1;
        try {
            // Die Entscheidung muss synchron fallen, deshalb die Sync-Variante.
            response = dialog.showMessageBoxSync(window, {
                type: 'warning',
                buttons: ['Verlassen · Änderungen verwerfen', 'Abbrechen'],
                defaultId: 1,
                cancelId: 1,
                noLink: true,
                message: 'Es gibt ungespeicherte Änderungen.',
                detail: 'Beim Verlassen gehen sie verloren, sofern sie nicht in der automatischen Sicherung stehen.',
            });
        } catch {
            response = 1;
        }
        if (response === 0) event.preventDefault();
    });
}

module.exports = { installEditorUnloadGuard };

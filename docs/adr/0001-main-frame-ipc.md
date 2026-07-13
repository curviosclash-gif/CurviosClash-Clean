# Electron-IPC nur aus dem Main Frame

## Kontext

Desktop-IPC kann Dateisystem, LAN, Recording und Persistenz erreichen. Aufrufe aus fremden Fenstern oder Subframes dürfen diese Fähigkeiten nicht erhalten.

## Entscheidung

Privilegierte IPC-Aufrufe werden nur akzeptiert, wenn Sender, WebContents und Main Frame zum erwarteten Fenster gehören.

## Folgen

Neue IPC-Kanäle benötigen dieselbe Senderprüfung. Eingebettete Inhalte können keine Desktop-Fähigkeiten übernehmen.

## Test/Absicherung

Contract-Tests prüfen erlaubte Main-Frame-Aufrufe sowie die Ablehnung fremder Fenster, Subframes und zerstörter Fenster.

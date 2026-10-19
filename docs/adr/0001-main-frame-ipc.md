# Electron-IPC nur aus dem Main Frame

## Kontext

Desktop-IPC kann Dateisystem, LAN, Recording und Persistenz erreichen. Aufrufe aus fremden Fenstern oder Subframes dürfen diese Fähigkeiten nicht erhalten.

## Entscheidung

Privilegierte IPC-Aufrufe werden nur akzeptiert, wenn Sender, WebContents und Main Frame zum erwarteten Fenster gehören.

## Folgen

Neue IPC-Kanäle benötigen dieselbe Senderprüfung. Eingebettete Inhalte können keine Desktop-Fähigkeiten übernehmen.

## Test/Absicherung

Contract-Tests prüfen erlaubte Main-Frame-Aufrufe sowie die Ablehnung fremder Fenster, Subframes und zerstörter Fenster.

Die Zahl der IPC-Fundstellen ist ein Ratchet (`electronIpcRendererChannels`, `electronIpcMainChannels` in `scripts/architecture/architecture-budget-ratchet.json`) und darf nur sinken. Seit 19.10.2026 zählt `scripts/architecture/ElectronIpcChannels.mjs` auch Kanäle hinter Hilfsfunktionen (`createInvokeBridge('…')`, `registerTuningHandler(CHANNELS.x)`) und Kanal-Konstanten. Die Obergrenze stieg dadurch von 18/29 auf 65/56: Die Zählung wurde genauer, neue Kanäle kamen nicht hinzu (Nutzerfreigabe 19.10.2026).

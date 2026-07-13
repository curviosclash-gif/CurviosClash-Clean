# Electron-Sandbox bleibt pro Fenster explizit

## Kontext

Das Hauptfenster benötigt im Preload dynamische ESM-Imports für die bestehende
Tuning-Runtime. Electron unterstützt diese Imports in sandboxed Preloads nicht.
Settings Studio und Tuning Console benötigen diesen Sonderpfad nicht.

## Entscheidung

Alle Desktop-Fenster setzen `contextIsolation: true` und
`nodeIntegration: false`. Settings Studio und Tuning Console setzen zusätzlich
`sandbox: true`. Das Hauptfenster setzt `sandbox: false` als eng begrenzte,
dokumentierte Ausnahme, solange sein Tuning-Preload die ESM-Module direkt laden
muss. Privilegierte IPC bleibt auf Sender, WebContents und Main Frame geprüft.

## Folgen

Die produktiven Werkzeuge, Recording und LAN bleiben funktionsfähig. Eine
vollständige Sandbox des Hauptfensters erfordert zuerst einen gebündelten oder
anders gekapselten Tuning-Preload; sie darf nicht nur per Konfigurationsschalter
aktiviert werden.

## Test/Absicherung

Electron-Contract-Tests prüfen Isolation, Node-Integration, die explizite
Sandbox-Policy und den Main-Frame-Sender-Guard. Ein echter Desktop-Smoke prüft
Preload, LAN und Recording mit der jeweils gepackten Electron-Version.

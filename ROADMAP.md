# Roadmap

## Jetzt

- **Electron-Audit** – Ziel: Shell, Fenster, IPC und Paketinhalt vollständig prüfen. Nutzen: weniger Sicherheits- und Release-Regressionsrisiko. Erfolg: alle Desktop-Grenzen sind durch Contracts oder reproduzierbare Checks abgedeckt.
- **Signierung und Icon** – Ziel: vertrauenswürdige Windows-Metadaten und ein konsistentes Produkt-Icon. Nutzen: weniger SmartScreen-Reibung und klare Produktidentität. Erfolg: signierter Installer und EXE mit geprüftem Icon aus externer Zertifikatsbereitstellung.
- **E2E-Stabilisierung** – Ziel: alle zentralen Desktop-Cluster ohne Hänger reproduzierbar ausführen. Nutzen: verlässliche Releases. Erfolg: wiederholte grüne Läufe mit klar begrenzten Testzeiten und verwertbarer Fehlerursache.

## Danach

- **Profilvalidierung** – Ziel: ungültige oder beschädigte Profildaten sicher abweisen beziehungsweise reparieren. Nutzen: robuste Persistenz. Erfolg: Migration, Ablehnung und Wiederherstellung sind durch Contracts abgedeckt.
- **Navigation und Popup-Allowlist** – Ziel: externe Navigation und neue Fenster auf explizit erlaubte Ziele begrenzen. Nutzen: kleinere Desktop-Angriffsfläche. Erfolg: unerlaubte Ziele werden in Main Frame und Popups nachweisbar blockiert.
- **LAN-Hardening** – Ziel: Discovery, Host-Lifecycle und Eingaben weiter absichern. Nutzen: stabilere lokale Mehrspieler-Sitzungen. Erfolg: Fehler-, Neustart- und Missbrauchsfälle bestehen gezielte Integrationsprüfungen.

## Später

- **Performance und Chunks** – Ziel: Startzeit, Laufzeitspitzen und Renderer-Chunking messen und optimieren. Nutzen: schnellerer Start und gleichmäßigeres Spielgefühl. Erfolg: belastbare Budgets werden ohne Funktionsverlust eingehalten.

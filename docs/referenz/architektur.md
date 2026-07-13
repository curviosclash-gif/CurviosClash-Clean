# Architektur

CurviosClash ist eine Desktop-first Three.js-Anwendung in Vanilla JavaScript mit ES-Modulen. Dieses Dokument beschreibt die produktiven Grenzen des bereinigten Repositories.

## Technische Basis

- `src/shared/contracts/` enthält seiteneffektfreie Verträge für IDs, Payloads, Snapshots, Capability-Descriptoren und Versionen.
- `src/core/` orchestriert Bootstrap, Game Loop, Runtime, Renderer und Lifecycle.
- `src/state/` hält Match-, Replay-, Profil- und Persistenzzustände.
- `src/entities/` enthält Spieler, Bots, Fahrzeuge, Projektile und Arenaelemente.
- `src/ui/` rendert Oberflächen und übergibt Nutzerintentionen über benannte Ports und Verträge.
- `electron/` stellt Desktop-Fenster, Persistenz, LAN, Recording, Settings und Tuning bereit.
- `server/` enthält LAN- und Online-Signaling.
- `editor/` und `prototypes/vehicle-lab/` sind produktbezogene Inhaltswerkzeuge.

## Laufzeitgrenzen

- UI-Code entscheidet nicht eigenständig über Matchzustände, sondern konsumiert Projektionen und sendet Commands oder Intents.
- Plattformzugriffe laufen über benannte Electron-Preload-Capabilities; der Renderer erhält keinen direkten Node.js-Zugriff.
- Neue Zustandsformate und IPC-Payloads behalten explizite Contract-Versionen und werden vor dem Schreiben validiert.
- Three.js-Ressourcen werden beim Szenenwechsel über die vorhandenen Disposal- und Lifecycle-Helfer freigegeben.
- Physik-, Bot- und Render-Schleifen bleiben allokationsarm; persistente Timer und Listener werden beim Neustart abgemeldet.

## Prüfungen

- `npm run lint`
- `npm run typecheck`
- `npm run check:architecture`
- `npm run test:contract`
- `npm run test:desktop:smoke`

Weitere produktbezogene Referenzen in diesem Ordner beschreiben Online-Signaling, die Tuning-Konsole sowie Powerups, Portale und Gates.

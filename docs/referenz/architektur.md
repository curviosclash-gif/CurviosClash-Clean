# Architektur

CurviosClash ist eine Desktop-first Three.js-Anwendung in Vanilla JavaScript mit ES-Modulen. Dieses Dokument beschreibt die produktiven Grenzen des bereinigten Repositories.

## Technische Basis

- `src/shared/contracts/` enthält seiteneffektfreie Verträge, kanonische Registries und Schemata für IDs, Payloads, Snapshots, Capability-Descriptoren und Versionen.
- `src/core/` orchestriert Bootstrap, Game Loop, Runtime, Renderer und Lifecycle.
- `src/state/` hält Match-, Replay-, Profil- und Persistenzzustände.
- `src/entities/` enthält Spieler, Bots, Fahrzeuge, Projektile und Arenaelemente.
- `src/ui/` rendert Oberflächen und übergibt Nutzerintentionen über benannte Ports und Verträge.
- `electron/` stellt Desktop-Fenster, Persistenz, LAN, Recording, Settings und Tuning bereit.
- `server/` enthält LAN- und Online-Signaling.
- `editor/` und `prototypes/vehicle-lab/` sind produktbezogene Inhaltswerkzeuge.

## Laufzeitgrenzen

- UI-Code entscheidet nicht eigenständig über Matchzustände, sondern konsumiert Projektionen und sendet Commands oder Intents. Match-Start und Session-Erstellung gehören dem Core-Runtime-Service; Zustandsübergänge laufen ausschließlich über den Match-State-Port.
- Application-Use-Cases erhalten Browser-/Desktop-Fähigkeiten als Platform-Bindings aus der Composition-/Core-Grenze und importieren keine konkreten Plattformadapter.
- Plattformzugriffe laufen über benannte Electron-Preload-Capabilities; der Renderer erhält keinen direkten Node.js-Zugriff und IPC-Capabilities akzeptieren nur das Hauptfenster und dessen Main Frame.
- Neue Zustandsformate und IPC-Payloads behalten explizite Contract-Versionen und werden vor dem Schreiben validiert.
- Three.js-Ressourcen werden beim Szenenwechsel über die vorhandenen Disposal- und Lifecycle-Helfer freigegeben; `tests/three-disposal.contract.test.mjs` sichert die einmalige Freigabe gemeinsam genutzter GPU-Ressourcen ab.
- Physik-, Bot- und Render-Schleifen bleiben allokationsarm; persistente Timer und Listener werden beim Neustart abgemeldet.

## Prüfungen

- `npm run lint`
- `npm run typecheck:architecture`
- `npm run check:architecture`
- `npm run test:contract`
- `npm run test:desktop:smoke`

Weitere produktbezogene Referenzen in diesem Ordner beschreiben Online-Signaling, die Tuning-Konsole sowie Powerups, Portale und Gates.

Die Architekturprüfung scannt `src/`, `electron/`, `server/`, `editor/` und `prototypes/vehicle-lab/`, verfolgt Imports sowie Re-Exports und blockiert neue Application-zu-Platform- und Shared-Contract-zu-Implementierungskanten. Der vollständige Produkt-Typecheck ist ratchet-basiert: bestehende JavaScript-Diagnosen dürfen nur abnehmen, neue Netto-Diagnosen brechen das Gate.

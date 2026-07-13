# CurviosClash Clean

Dieses Repository ist die bereinigte, eigenständige Produktbasis des klassischen CurviosClash-Spiels. Es bewahrt Spielcode, Spielgefühl, Inhalte und produktbezogene Werkzeuge, entfernt aber die frühere Agenten-Governance, Planverwaltung, Knowledge-Graph-/RAG-Systeme, historische Prozessarchive und generierte Arbeitsausgaben.

## Schnellstart unter Windows

`START_CURVIOSCLASH.cmd` doppelklicken. Die Datei startet bevorzugt ein vorhandenes Windows-Paket. Falls noch keines gebaut wurde, prüft sie Node.js, installiert fehlende Abhängigkeiten, baut den Desktop-Renderer und startet Electron.

Manuell im Terminal:

```powershell
npm ci
npm --prefix electron ci
npm run app:start
```

Voraussetzung ist Node.js 24 gemäß `.nvmrc`. Für Internet-Multiplayer kann in `.env.app` ein Signaling-/TURN-Endpunkt gesetzt werden.

## Spielumfang

- Classic, Hunt, Arcade, Splitscreen, Browser-/Desktop- und Mobile-Varianten
- vollständige Steuerung, Kamera, Physik, Bots und Bot-Policies
- Karten, Fahrzeuge, Powerups, Portale, Effekte, synthetisches Audio und Animationen
- Menüs, HUD, Einstellungen, Profile und Presets
- Arcade-Fortschritt, Ghosts, Replays, Aufnahme und Videoexport
- LAN-Host/Discovery sowie Online-Signaling
- 3D-Karteneditor, Vehicle Lab, Settings Studio und Tuning-Konsole

## Ordnerstruktur

- `src/` – Spielruntime, UI, Netzwerk, Zustände und Contracts
- `assets/` – Modelle, Texturen und UI-Grafik
- `electron/` – Desktop-Shell, Persistenz, LAN, Aufnahme und Paketierung
- `server/` – LAN- und Online-Signaling
- `editor/` – produktiver 3D-Karteneditor
- `prototypes/vehicle-lab/` – produktiv eingebundener Fahrzeugeditor
- `data/` – Karten-, Fahrzeug- und notwendige Laufzeitverträge
- `tests/` – produktbezogene Contract-, Integrations- und Playwright-Tests
- `android-classic/` und `tools/mobile-classic-app/` – Android-/Mobile-Ziel

## Entwicklung und Tests

```powershell
npm run dev                 # Vite-Entwicklung
npm run build:app           # Desktop-Renderer
npm run lint                # Quellcode-Lint
npm run typecheck           # Architektur-Typprüfung
npm run test:contract       # Produktverträge
npm run test:desktop:smoke  # sichtbarer Desktop-Smoke
npm run test:desktop:e2e    # zentrale Desktop-Flows und Modi
npm run app:package         # Windows-Paket
```

Weitere gezielte Befehle stehen in `package.json`, unter anderem für Physik, GPU, Stress, Editor, Bots, LAN und Android.

Das Windows-Paket entsteht als entpackte Anwendung unter `release/win-unpacked/` und als Installer unter `release/CurviosClash Setup 1.0.0.exe`. Lokale Pakete sind nicht signiert; Windows kann deshalb vor dem Start einen SmartScreen-Hinweis zeigen.

## Herkunft und Bereinigung

- Ausgangspunkt: Original-Commit `0532a9d8aca7dccfb015c4305e19b1fa4d54cc53` vom 12. Juli 2026.
- Zusätzlich übernommen: der geprüfte Scheduler-Fix, die Heuristik-/Bot-Safety-Härtung und der zusammengehörige Bot-Validierungs-/Rundenmetrik-Slice aus dem damaligen Arbeitsbaum.
- Nicht übernommen: der geänderte Bot-Trainingsplan und der lediglich hostabhängig neu generierte Browser-Policy-Export.
- Entfernt: Agentenregeln, Gates, Locks, Councils, Pläne, Knowledge Graph, RAG, Agent-/Plan-/Repo-Maps, Trainingsverwaltung und -evidence, historische Archive sowie Builds, Logs, Caches und Abhängigkeiten.
- Bewusst erhalten: Runtime-nahe Trainings-/Validierungsbausteine in `src/`, produktive Tests, der 3D-Editor, das Vehicle Lab, Settings/Tuning und Mobile Classic.

Das Repository besitzt eine neue lokale Git-Historie und absichtlich keinen Remote.

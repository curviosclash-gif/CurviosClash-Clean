# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Projektsprache ist Deutsch; Code, Commit-Betreffe und Bezeichner sind Englisch.

## Sprache in Antworten und Erklärungen

Alle Antworten, Erklärungen, Zusammenfassungen und Commit-Beschreibungen an den Nutzer werden in **einfacher, laienverständlicher Sprache** geschrieben. Ziel ist nicht Vereinfachung um jeden Preis, sondern Verständlichkeit **mit** Lerneffekt.

- Kurze Sätze, aktive Formulierungen, keine verschachtelten Nebensatzketten.
- **Fachbegriffe werden nicht vermieden, sondern erklärt.** Beim ersten Auftreten im Gespräch: Begriff nennen, dann in einem Halbsatz erklären, was er bedeutet — z. B. „Ein *Contract-Test* prüft, ob eine Datenform noch zum vereinbarten Format passt (also ob ein gespeichertes Fahrzeug noch geladen werden kann)."
- Erst das *Was und Warum* in Alltagssprache, dann bei Bedarf die technischen Details. Nicht umgekehrt.
- Analogien und konkrete Beispiele aus dem Spiel sind erwünscht, wenn sie ein Konzept greifbar machen.
- Abkürzungen (IPC, ESM, ADR, CSP, …) beim ersten Mal ausschreiben und einordnen.
- Keine unerklärten Anglizismen, wo ein deutsches Wort genauso genau ist. Wo der englische Begriff der Standard ist (Commit, Build, Renderer), bleibt er stehen — dann aber erklärt.
- Das gilt für Chat-Antworten und Erklärtexte. **Code, Bezeichner, Kommentare im Code und Commit-Betreffe bleiben davon unberührt** und folgen weiter den Regeln oben.

Der Nutzer soll nach jeder Antwort nicht nur wissen, *dass* etwas funktioniert, sondern ein Stück besser verstehen, *warum*.

## Verbindliche Arbeitsregeln

`AGENTS.md` enthält die vollständigen Projektregeln und gilt uneingeschränkt. Besonders relevant für Claude Code:

- Genau **ein atomarer Commit** pro abgeschlossener Aufgabe, und nur wenn betroffene Tests und der passende Build grün waren. Niemals `git add -A` / `git add .` — nur Dateien der aktuellen Aufgabe stagen.
- Der Arbeitsbaum enthält häufig fremde, laufende Nutzeränderungen. Diese nicht übernehmen; bei Überschneidung keinen Commit erstellen, sondern den Konflikt melden.
- **Untracked-Dateien niemals eigenständig löschen.** Bei Freigabe: `Remove-Item` ohne `-Force` (Papierkorb) oder vorher nach `$env:TEMP\opencode-trash\` verschieben.
- Keine Planarchive, Statuskopien, Agenten-Wissensbasen oder generierten Prozessberichte im Repo anlegen.
- Der Council (`.opencode/agents/council-*`, `npm run council:*`, Regeln in `.opencode/AGENTS.md`) läuft **nur auf ausdrückliche Nutzeraufforderung** und betrifft ausschließlich OpenCode-Agenten. Ohne Aufforderung bearbeitet das Hauptmodell Analyse, Planung und Umsetzung selbst.
- Desktop (Electron) ist die Leitplattform; Browser und Mobile werden danach separat geprüft.

## Befehle

```bash
npm run dev                    # Vite-Renderer auf 5173
npm run quality                # vollständiges Gate: council:check, lint, typecheck, architecture, parcours, contracts
npm run lint                   # eslint über src, electron, server, editor, scripts, vehicle-lab, dev/vite (--max-warnings 0)
```

Tests:

```bash
npm run test:contract:fast     # Node-Contracts ohne Renderer-Build (schnellster Feedback-Loop)
npm run test:contract:dist     # baut dist-app und prüft die Renderer-Artefakte
npm run test:contract          # beide Pfade (= npm test)
npm run test:desktop:smoke     # zentraler Playwright-Desktop-Smoke (tests/core.spec.js)
npm run test:desktop:e2e       # getrennte Desktop-E2E-Cluster
```

Einzelne Tests:

```bash
node --test tests/audio.contract.test.mjs
```

```bash
node scripts/run-playwright-targeted.mjs tests/physics-core.spec.js
```

Playwright läuft immer über die Wrapper in `scripts/run-playwright-*.mjs`. Desktop-Profile starten das echte Electron-Fenster gegen den gebauten `dist-app`-Renderer; nur `test:browser:compat` verwendet bewusst den Vite-Browserpfad. `--grep "T1:|T2:"` wird an Playwright durchgereicht.

**Nur ein Playwright-Lauf pro Rechner.** Die Wrapper nehmen ein maschinenweites Schloss (`scripts/playwright-run-lock.mjs`, Datei im Temp-Ordner) und warten, solange eine andere Sitzung läuft — zwei Electron-Läufe auf derselben GPU verfälschen sich gegenseitig. Ein Cluster-Lauf hält das Schloss für alle seine Specs. Wartet ein Wrapper, nennt er Label, PID und Startzeit des Halters; `CURVIOS_PLAYWRIGHT_LOCK=0` schaltet das Schloss ab, `CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS` begrenzt die Wartezeit (Standard 45 Minuten).

Die Desktop-E2E-Suite ist in benannte Cluster geschnitten (`scripts/playwright-test-clusters.mjs`). Der Cluster-Runner akzeptiert Cluster-IDs *und* Spec-Pfade, sodass gezielt ein Cluster statt der ganzen Suite läuft:

```bash
node scripts/run-playwright-targeted-clusters.mjs --print-clusters
```

```bash
node scripts/run-playwright-targeted-clusters.mjs editor
```

Cluster im Standardlauf: `core-shell`, `core-platform`, `core-surface`, `core-runtime`, `core-regressions`, `network` (läuft im Profil `browser-compat`), `desktop-flows`, `gameplay-smoke`, `editor`. Nur auf Anforderung: `physics-core`, `physics-hunt`, `physics-policy`, `gpu-stress`, `ghost-selfduel`.

Struktur- und Typprüfungen (Teil von `quality`, einzeln nützlich):

```bash
npm run check:architecture     # Boundary-Guard + Ratchets + Determinismus + Encoding + Editor-Pfade
npm run typecheck:architecture # checkJs über Produktquellen gegen den Fehler-Ratchet
npm run typecheck:contracts    # strikte Typen für src/shared/contracts
```

Desktop, Server, Editor, Mobile:

```bash
npm run app:start              # build:app + Electron aus dem Quellcode
npm run app:package            # Windows-Paket nach release/
npm run server:start           # LAN-/Online-Signaling aus server/
npm run app:android:build      # Capacitor-Build der Mobile-Classic-App
```

Windows-Einstiege für den Nutzer (`START_CURVIOSCLASH.cmd`, `start_development.bat`, `start_editor.bat`, …) sind in `README.md` beschrieben.

Bots und Performance laufen über `dev/training/scripts/`: `npm run bot:validate`, `npm run bot:analyze`, `npm run benchmark:lifecycle`, `npm run benchmark:jitter`.

## Pflichtprüfung vor dem Commit

`AGENTS.md` verlangt „die kleinsten betroffenen Tests und den passenden Build". `npm run quality` ist dafür der Ersatz, wenn nichts Genaueres passt — es ist aber langsam. Zuordnung nach geändertem Bereich (`npm run lint` gilt immer, `test:contract:fast` ist die Grundlast):

| Geänderter Bereich | Zusätzlich verpflichtend |
| --- | --- |
| `src/shared/contracts/**` | `npm run typecheck:contracts`, `npm run test:contract:coverage` (Coverage-Gate greift nur hier) |
| `src/entities/**`, `src/state/**` (Kollision, Arena, Projektile, Rundenlogik) | Cluster `physics-core`, `physics-hunt`, `physics-policy` |
| `src/network/**`, `src/application/session-runtime/**` | `npm run check:architecture` (Determinismus-Guard), Cluster `network` |
| `src/core/renderer/**`, `src/entities/GLBMapLoader.js`, Map-Presets, `assets/maps/**` | `npm run test:desktop:smoke`, Cluster `desktop-flows`, bei Renderlast `gpu-stress` |
| Parcours-Maps und -Routen | `npm run check:parcours` |
| `src/ui/**` | `npm run lint` (Boundary-Regel greift hier zuerst), Cluster `core-surface`, `desktop-flows` |
| `src/modes/**` | Cluster `core-runtime`, `gameplay-smoke` |
| `editor/**` | `npm run check:architecture` (Editor-Pfad-Drift), `npm run test:editor-ui` oder Cluster `editor` |
| `electron/**`, Preload, IPC | `npm run build:app`, `npm run test:contract:dist`, bei Paketänderungen `npm run app:package:verify` |
| `dev/training/**` | `npm run test:dev:training` und ein Build (die Production-Training-Grenze wird dabei automatisch geprüft) |
| `.opencode/**`, `scripts/council-*` | `npm run council:validate` (Pflicht-Gate laut AGENTS.md) |
| `scripts/architecture/**`, Lint-/TS-Konfiguration | `npm run quality` vollständig |

Cluster werden mit `node scripts/run-playwright-targeted-clusters.mjs <cluster-id>` gestartet.

## Architektur

Vanilla-JS-ESM ohne Framework, Three.js für das Rendering, Vite als Bundler. Die Schichtung wird nicht nur konventionell, sondern **maschinell erzwungen** (siehe unten).

### Schichten in `src/`

- `shared/contracts/` — versionierte Datenverträge und Normalisierer (`*Contract.js`). Unterste Schicht: darf nichts aus `core`, `ui`, `state` oder sonstigen Implementierungen importieren. Neue schichtübergreifende Datenformen gehören hierher, nicht in ad-hoc Objekte.
- `core/` — Runtime: Bootstrap, Game-Loop, Renderer, Input, Settings/Profile, Recording, Diagnostics. Kein DOM-Zugriff außerhalb von `src/ui`.
- `state/` — Match-Wahrheit ohne Renderer: `MatchKernel`, `RoundStateController`, Match-Lifecycle-Orchestrierung, Recorder, Persistenz.
- `entities/` — Spielobjekte, Arena, Kollision, Projektile, Map-Schema und GLB-Laden.
- `modes/` — Spielmodi als Strategien (`ClassicModeStrategy`, `ArcadeModeStrategy`, `HuntModeStrategy`) hinter `GameModeContract` und `GameModeRegistry`.
- `ui/` — DOM, HUD, Menü, Hangar, Settings. **UI darf nicht direkt aus `core` oder `state` importieren** — nur über Contracts oder Ports.
- `composition/core-ui/` — der Ort, an dem Core und UI verdrahtet werden (Port-Factories wie `CoreRuntimeAccessFactory`, `CoreUiMenuPorts`). Wenn UI etwas aus Core braucht, entsteht hier ein Port, kein direkter Import.
- `application/session-runtime/` — Lobby- und Session-Use-Cases über Ports; unabhängig von `ui`, `core` und `platform`.
- `network/` — LAN/Online-Signaling, WebRTC-Peers, `SessionAdapterBase` mit LAN- und Online-Ableitungen, `StateReconciler`.
- `platform/` — Browser- vs. Electron-Adapter hinter gemeinsamen Capability-Schnittstellen.
- `mobile-classic/`, `mobile-arcade/` — plattformspezifische Overrides, die die gleiche Runtime umkonfigurieren.

### Runtime-Fluss

`src/core/main.js` definiert die `Game`-Klasse und ruft `initializeGameApp()`. `Game` hält Settings/Profile und delegiert praktisch alles an den `GameRuntimeCoordinator` (`src/core/runtime/`), der Subsysteme aufbaut, Ports veröffentlicht und über `getRuntimeHandle(...)` zugänglich macht. Die Methoden `update(dt)` und `render(alpha, delta)` verteilen über `dispatchGameStateUpdate` an zustandsabhängige Systeme (`PlayingStateSystem`, `RoundStateTickSystem`). Zustände sind IDs aus `shared/contracts/GameStateIds.js`.

Viele `this.xyz`-Felder auf `Game` sind bewusst als Rückwärtskompatibilität dokumentiert und werden vom Coordinator gesetzt — neue Zugriffe gehen über Ports, nicht über neue Felder auf `Game`.

### Weitere Bereiche

- `electron/` — Desktop-Shell mit eigenem `package.json`/Lockfile: Main/Preload, IPC, LAN, Persistenz, Recording-FFmpeg, electron-builder. IPC-Kanäle und Preload-Exposures werden gezählt und begrenzt (ADR `docs/adr/0001-main-frame-ipc.md`, `0004-electron-sandbox-scope.md`).
- `server/` — eigenständiger Signaling-Server, ebenfalls mit eigenem Lockfile.
- `editor/`, `prototypes/vehicle-lab/` — produktive Autorenwerkzeuge, keine Wegwerf-Prototypen.
- `dev/training/` — Bot-Training und Analyse. Diese Ebene darf **niemals** in Produktionsbundles landen; `scripts/check-production-training-boundary.mjs` läuft nach jedem Build und schlägt bei Markern wie `TrainingAutomationRunner` oder `developer-training-*`-Assets fehl.
- `dev/vite/` — Vite-Plugins (Editor-Disk-API, Playwright-Bridge, Asset-Copy, Desktop-Netzwerkpolicy). Build-Modi: default, `--mode web`, `--mode app` (→ `dist-app`).
- `docs/adr/` — kurze, dauerhafte Architekturentscheidungen. Dauerhafte Produktziele in `ROADMAP.md`.

## Erzwungene Grenzen

Diese Regeln brechen den Build, nicht nur das Review:

- **eslint-plugin-boundaries**: `ui` → `core` ist ein Fehler.
- **`scripts/check-architecture-boundaries.mjs`**: verbietet zusätzlich `core`→`ui`, `ui`→`state`, `state`→`ui`, `entities`→`core`, `state`→`core`, `shared/contracts`→`core`, `application`→`ui`/`core`/`platform`, `shared/contracts`→Implementierungen, Schreibzugriffe auf `CONFIG`, DOM außerhalb `src/ui` sowie `constructor(game)` / `this.game = game`.
- **Ratchets**: `check-architecture-ratchet.mjs` und `check-product-typecheck-ratchet.mjs` vergleichen gegen Baselines in `scripts/architecture/*.json`. Werte dürfen sinken, nicht steigen. Baseline nur anheben, wenn es dafür einen ausdrücklichen Auftrag gibt.
- **`max-lines` 500** für `src/**/*.js`. Bestehende Ausnahmen stehen in `scripts/architecture/LegacyMaxLinesConfig.mjs` und sind Schulden, keine Erlaubnis — keine neuen Einträge hinzufügen.
- **Kein `innerHTML`** in `src/` (Lint-Warnung, XSS). `createElement` + `textContent` verwenden.
- **Determinismus-Guard**: In `src/network/SessionAdapterBase.js`, `LANSessionAdapter.js`, `OnlineSessionAdapter.js`, `src/ui/menu/MenuMultiplayerBridge.js` und `src/core/runtime/MenuRuntimeSessionService.js` sind `Date.now`, `Math.random` und `performance.now` verboten — Zeit und Zufall werden injiziert.
- **Commit-Hook**: `.githooks/commit-msg` erzwingt `<type>(<scope>): <kleingeschriebene englische Beschreibung>` mit maximal 72 Zeichen Betreff. Einmalig aktivieren mit `npm run git:hooks:install`.

## Tests

`tests/` enthält rund 200 Dateien in zwei Klassen: `*.contract.test.mjs` (Node-Testrunner, kein Browser) und `*.spec.js` (Playwright). `scripts/run-contract-tests.mjs` wählt automatisch — `fast` nimmt alles außer den dist-abhängigen Tests, `dist` genau diese. Neue Contract-Tests werden allein durch das Namensschema in `tests/` eingesammelt.

Coverage-Gate gilt nur für `src/shared/contracts/**` (70 % Lines / 60 % Branches / 60 % Functions) über `npm run test:contract:coverage`.

CI (`.github/workflows/`): `quality.yml` bei jedem Push/PR auf Windows, `desktop.yml` für Smoke und vier E2E-Cluster bei Produktänderungen, `package-check.yml` bei Electron-/Dependency-/Build-Änderungen, `security-audit.yml` wöchentlich.

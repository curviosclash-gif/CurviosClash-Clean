# CurviosClash Clean

CurviosClash Clean ist die eigenständige Produktbasis für Spiel, Desktop-App, LAN, Editor, Vehicle Lab, Mobile, Recording und Persistenz. Das Repository funktioniert ohne konfigurierten Git-Remote.

## Start unter Windows

Voraussetzung für Installation und Entwicklung ist Node.js gemäß `.nvmrc`.

| Zweck | Startdatei | Bedeutung |
| --- | --- | --- |
| Fertiges Spiel | `START_CURVIOSCLASH.cmd` | Startet deutlich gekennzeichnet das gültige Windows-Paket. Fehlt es, werden fehlende Abhängigkeiten aus den Lockfiles installiert und das Paket gebaut. |
| Aktuelle Entwicklungsversion | `start_development.bat` | Baut den Renderer immer neu, startet Electron aus dem aktuellen Quellcode und ignoriert ein vorhandenes Paket. |
| Settings Studio | `start_settings.bat` | Startet standardmäßig das Studio aus dem Paket. `start_settings.bat --development` baut zuerst den aktuellen Renderer und startet den Entwicklungsweg. |
| Editor | `start_editor.bat` | Startet genau einen Vite-Server unter `http://127.0.0.1:5173/editor/map-editor-3d.html` und öffnet den Editor erst nach dessen Bereitschaft. |
| Browser-Version | `start_game.bat` | Startet den einfachen lokalen Browser-Server aus `server.ps1`; dies ist weder das Windows-Paket noch Electron. |
| Installation | `install.bat` | Installiert Root-, Electron- und Server-Abhängigkeiten reproduzierbar mit `npm ci` aus allen drei Lockfiles. |

`start_desktop.bat` und `start_electron.bat` sind Kompatibilitätsnamen für
`start_development.bat`; `start_editor_local.bat` leitet nur auf
`start_editor.bat` weiter. Spiel und Settings Studio verwenden getrennte
Chromium-Profile, Sessions und Single-Instance-Locks, teilen aber bewusst die
beschreibbaren Settings-Dateien unter dem Benutzerprofil.

## Entwicklung und Qualität

```powershell
npm run dev                 # Vite-Entwicklung
npm run quality             # Lint, Typen, Architektur und Contracts
npm run test:desktop:smoke  # zentraler Desktop-Smoke
npm run test:desktop:e2e    # getrennte Desktop-E2E-Cluster
```

Die Desktop-Skripte bauen `dist-app` mit der gebündelten Test-Bridge und testen das echte Electron-Fenster samt Preload-Bridge. Der getrennte Befehl `npm run test:browser:compat` startet bewusst nur den Browser-Demo-Vertrag.

`npm run test:contract:fast` prüft reine Node-Contracts ohne Renderer-Build. `npm run test:contract:dist` baut und prüft die Renderer-Artefakte; `npm run test:contract` führt beide Pfade aus. Weitere gezielte Befehle für Physik, GPU, Stress, Editor, Bots, LAN und Android stehen in `package.json`.

GitHub Actions führt bei jedem Push und Pull Request die Standardqualität auf Windows mit Node.js aus `.nvmrc` aus. Produktänderungen starten zusätzlich Desktop-Smoke und vier getrennte E2E-Cluster mit festen Zeitgrenzen. Änderungen an Electron, Abhängigkeiten oder Build-Konfigurationen bauen und prüfen außerdem das Windows-Paket. Ein wöchentlicher Audit prüft Root, `electron/` und `server/`; Dependabot schlägt gesperrte Dependency-Änderungen als Pull Requests vor und führt keine automatischen Releases aus.

## Windows-Paket und Release

Vor einem Release:

```powershell
npm ci
npm --prefix electron ci
npm run quality
npm run test:desktop:smoke
npm run app:package
```

`npm run app:package` läuft nur in einem Spiel-Export (`scripts/export-game-repo.mjs`, mit `--arch` und `.game-export.json`). Im vollen Repository entsteht das entpackte Paket mit `npm run build:app`, `cd electron` und `npx electron-builder --dir --x64`; `npm run app:package:verify` startet es danach probeweise.

Das Paket entsteht unter `release/`: als Installer und als `win-unpacked/CurviosClash.exe`. Die CI prüft Renderer, LAN-Signaling, Runtime-Module, Preload, Recording-FFmpeg sowie den Start mit einem isolierten Benutzerprofil. `release/`, `dist-app/`, Testausgaben, Logs und Abhängigkeiten werden nie committet.

Signaturzertifikate und Passwörter werden ausschließlich außerhalb des Repositories bereitgestellt. electron-builder verwendet dafür `WIN_CSC_LINK` und `WIN_CSC_KEY_PASSWORD` (alternativ `CSC_LINK` und `CSC_KEY_PASSWORD`). Es gibt keine Zertifikatspfade oder Secrets in der Paketkonfiguration. Ohne diese Variablen entsteht weiterhin ein funktionierender, aber bewusst unsignierter Installer.

Das Windows-Icon unter `assets/branding/` wurde eigens aus geometrischen Formen
erstellt. Die editierbare SVG-Quelle und der Herkunftsnachweis liegen direkt bei
den abgeleiteten PNG- und ICO-Dateien; kein Asset aus Next wurde übernommen.

## Produktbereiche

- `src/` – Spielruntime, UI, Netzwerk, Zustände und Contracts
- `assets/` und `data/` – produktive Inhalte und Laufzeitverträge
- `electron/` – Desktop-Shell, LAN, Persistenz, Recording und Paketierung
- `server/` – LAN- und Online-Signaling
- `editor/` und `prototypes/vehicle-lab/` – produktive Autorenwerkzeuge
- `tests/` – Contract-, Integrations- und Desktop-Tests

Dauerhafte Produktziele stehen in `ROADMAP.md`; langfristige Architekturentscheidungen liegen knapp dokumentiert unter `docs/adr/`.

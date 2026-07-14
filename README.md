# CurviosClash Clean

CurviosClash Clean ist die eigenständige Produktbasis für Spiel, Desktop-App, LAN, Editor, Vehicle Lab, Mobile, Recording und Persistenz. Das Repository funktioniert ohne konfigurierten Git-Remote.

## Start unter Windows

Voraussetzung ist Node.js gemäß `.nvmrc`.

```powershell
npm ci
npm --prefix electron ci
npm run app:start
```

Alternativ startet `START_CURVIOSCLASH.cmd` ein vorhandenes Windows-Paket oder baut und öffnet die Desktop-App. Für den Signaling-Server werden dessen gesperrte Abhängigkeiten separat installiert:

```powershell
npm --prefix server ci
npm run server:start
```

Das Settings Studio bleibt im Entwicklungsbetrieb separat startbar:

```powershell
npm run app:settings:start
```

Im fertigen Paket startet derselbe Programmeinstieg das Studio mit
`release\win-unpacked\CurviosClash.exe --settings-studio`. Alternativ kann
`START_CURVIOSCLASH.cmd --settings-studio` verwendet werden. Spiel und Studio
verwenden getrennte Chromium-Profile, Sessions und Single-Instance-Locks, teilen
aber bewusst die beschreibbaren Settings-Dateien unter dem Benutzerprofil.

## Entwicklung und Qualität

```powershell
npm run dev                 # Vite-Entwicklung
npm run quality             # Lint, Typen, Architektur und Contracts
npm run test:desktop:smoke  # zentraler Desktop-Smoke
npm run test:desktop:e2e    # getrennte Desktop-E2E-Cluster
```

`npm run test:contract` erzeugt den benötigten Renderer-Build automatisch. Weitere gezielte Befehle für Physik, GPU, Stress, Editor, Bots, LAN und Android stehen in `package.json`.

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

Herkunft, übernommene Arbeitsverzeichnis-Änderungen, entfernte Entwicklungsstrukturen, Produktentscheidungen, Abhängigkeiten und die Abschlussprüfungen sind im [Migrationsbericht](docs/migration-report.md) dokumentiert.

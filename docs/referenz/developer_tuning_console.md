# Developer Tuning Console (V81) - Kurzreferenz

Stand: 2026-04-27

## Zweck

Die Tuning Console ist ein Desktop-only Entwicklerwerkzeug (F7) fuer Live-Aenderungen an Runtime-Parametern. Browser-Demo bleibt ohne produktiven Dev-Zugang.

## Module

- Registry: `src/dev/tuning/TuningParameterRegistry.js`
- Runtime-Bridge: `src/dev/tuning/TuningRuntimeBridge.js`
- Presets: `src/dev/tuning/TuningPresetManager.js`
- Electron Shell/IPC: `electron/tuning-window.cjs`, `electron/tuning-ipc.cjs`, `electron/tuning-preload.cjs`
- Console UI: `electron/tuning-console/tuning.html`, `tuning-app.js`, `tuning-renderer.js`, `tuning-preset-ui.js`, `tuning-style.css`
- Game Preload Request-Handler: `electron/preload.cjs` (`tuning-runtime:request`)

## Erweiterung: Neuer Parameter

1. Parameter in `CONFIG_BASE` (oder einer darunterliegenden Struktur) hinzufuegen.
2. Keine weitere UI-Verdrahtung noetig: die Registry traversiert die erlaubten Root-Sektionen automatisch und erzeugt den UI-Eintrag.
3. Falls ein Parameter readonly bleiben soll, die Readonly-Regel in `TuningParameterRegistry.js` erweitern (z. B. Pattern/Pfad).

## Erweiterung: Neuer Control-Typ

1. Descriptor-Feld im Registry-Eintrag bereitstellen (`type`, optional `options`).
2. Renderer in `electron/tuning-console/tuning-renderer.js` fuer den Typ erweitern.
3. Contract-Test fuer den neuen Typ ergaenzen (mindestens UI-Renderpfad + Set/Reset-Verhalten).

## Preset-Vertrag

- Store: Delta-only pro Pfad (keine Vollsnapshots).
- Export/Import: JSON-Dokument mit `contractVersion` (`tuning-preset-document.v1`).
- Dialoge laufen ausschliesslich ueber Electron-IPC (`tuning:export-preset-json`, `tuning:import-preset-json`).

## Checks

- `npm run test:contract`
- `npm run plan:check`
- `npm run docs:check`
- Optional fokussiert: `node --test tests/tuning-runtime-bridge.contract.test.mjs tests/tuning-ipc.contract.test.mjs tests/tuning-window.contract.test.mjs tests/tuning-preset-manager.contract.test.mjs`

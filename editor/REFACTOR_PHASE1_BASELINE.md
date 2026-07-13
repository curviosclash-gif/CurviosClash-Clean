# Phase 1: Refactor-Baseline (Map Editor)

## Ziel von Phase 1

Diese Phase schafft eine stabile Ausgangsbasis fuer die Modularisierung des Map Editors.

- Refactor-Ziel: `editor/map-editor-3d.html` + `editor/js/*`
- Legacy (vorerst nicht umbauen): `editor/map-editor.html` (2D-Editor)
- Fokus: Verhalten sichern, noch keine funktionale Aenderung erzwingen

## Scope (aktiv)

Der 3D-Editor gilt ab jetzt als primaere Editor-Variante fuer die Modularisierung.

Betroffene Dateien:

- `editor/map-editor-3d.html`
- `editor/js/EditorCore.js`
- `editor/js/EditorUI.js`
- `editor/js/EditorMapManager.js`
- `editor/js/EditorAssetLoader.js`
- `editor/js/EditorCommandHistory.js`

## Out of Scope (Phase 1)

- Kein Umbau des 2D-Editors `editor/map-editor.html`
- Keine Aenderung des JSON-Formats (Import/Export)
- Keine UX-Neugestaltung
- Keine neuen Tools / Objekttypen

## Refactor-Guardrails (muss stabil bleiben)

- JSON Import/Export bleibt kompatibel zum aktuellen `MapSchema`
- Objekt-IDs bleiben erhalten (inkl. Import bestehender IDs)
- Undo/Redo Verhalten bleibt funktionsgleich
- Shortcuts bleiben erhalten (`Strg+Z`, `Strg+Y`, `Strg+C`, `Strg+V`, `Entf`, `T`, `R`)
- Playtest-Flow ueber `localStorage` bleibt erhalten
- Asset-Ladefehler duerfen weiter auf Placeholder fallen (kein Hard-Fail)

## Baseline-Funktionscheck (manuell)

Diese Liste dient als Smoke-Test vor/nach Refactor-Schritten.

### Start & Rendering

- 3D-Editor startet ohne Init-Fehler
- Asset-Status wird angezeigt (geladen oder Placeholder)
- Szene rendert, Kamera laesst sich bedienen

### Erstellen / Bearbeiten

- Tool-Auswahl funktioniert (Select / Tunnel / Hard / Foam / Portal / Spawn / Item / Aircraft)
- Platzieren per Maus funktioniert
- Auswahl funktioniert
- TransformControls funktionieren (`T` bewegen, `R` rotieren)
- Eigenschaften-Panel aktualisiert sich bei Selektion
- Objekt loeschen funktioniert
- Copy/Paste funktioniert

### Editor-Modi

- Snap ein/aus + Grid-Wert wirkt auf Platzierung/Transform
- Y-Layer ein/aus funktioniert
- Fly-Mode ein/aus funktioniert ohne Input-Konflikt

### Datenfluss

- Export schreibt JSON in Textfeld
- Import aus Textfeld erstellt Szene korrekt
- "New" leert die Map
- Playtest speichert Map und oeffnet Spielseite

### Historie

- Undo funktioniert nach Create/Edit/Delete
- Redo funktioniert nach Undo
- Undo/Redo-Buttons werden korrekt aktiviert/deaktiviert

## Phase-1-Abnahmekriterien

Phase 1 gilt als abgeschlossen, wenn:

1. Der 3D-Editor als Refactor-Ziel festgelegt ist.
2. Der 2D-Editor als Legacy/Bestand markiert ist (kein Umbau in Phase 1).
3. Die verhaltenskritischen Funktionen als Smoke-Check dokumentiert sind.
4. Ein technischer Baseline-Check (`npm run build`) ohne neue Fehler laeuft.

## Hinweise fuer Phase 2

Der groesste Refactor-Hebel ist `editor/js/EditorUI.js` (breite Verantwortlichkeit).
Phase 2 sollte mit einer Aufteilung in Teil-Controller beginnen, bei gleichbleibendem Verhalten.

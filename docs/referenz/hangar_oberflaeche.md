# Hangar-Oberfläche: was produktiv ist und was nicht

Kurzreferenz für den Desktop-Hangar. Diese Angaben standen bis 2026-09-08 als
eingefrorene Objekte in `src/ui/hangar/`. Ins ausgelieferte Bundle kamen sie
nicht — der Bundler warf sie mangels Aufrufer ohnehin weg. Sie lagen aber im
Quellbaum, wurden bei jeder Suche mitgefunden und von einem Test abgesichert,
der nur sich selbst bestätigen konnte. Als Dokumentation gehören sie hierher.

## Produktive Oberfläche

Der Hangar ist ein eigenes Desktop-Fenster.

| Rolle | Datei |
| --- | --- |
| Fenster-Einstieg | `src/ui/hangar/HangarWindowApp.js`, mountet auf `hangar-window-mount` |
| Werkstatt | `src/ui/hangar/ArcadeHangarWorkshop.js`, Einstieg `setupArcadeHangarWorkshop` |
| Auswahl-Rückschreibung | `src/ui/hangar/HangarSelectionWritebackContract.js` |
| Persistenz | `src/ui/hangar/HangarWorkshopPersistenceFacade.js` |

`ArcadeMenuSurface` startet nur das Fenster; die Werkstatt baut sich darin selbst
auf. Der frühere Kompatibilitäts-Export `src/ui/arcade/ArcadeVehicleManager.js`
hatte zuletzt keinen Aufrufer mehr und ist entfernt.

## Entworfen, aber nicht in Benutzung

Drei Dateien beschreiben eine Hangar-Schale, die so nie gebaut wurde. Sie
enthalten echten Code — Normalisierung, Ableitung aus den Modus-Verträgen — aber
keine Produktionsquelle ruft sie auf:

- `HangarShellLayoutContract.js` — Regionen, Reihenfolge, moduseigene Erweiterungen
- `HangarDesktopEntryContract.js` — Auflösung der Einstiegspunkte je Modus
- `HangarLifecycleContract.js` — Übergänge zwischen Menü, Hangar, Werkstatt, Match

Sie tragen den Vermerk `NICHT IN BENUTZUNG`, und
`tests/hangar-shell-layout-unused.contract.test.mjs` hält diesen Vermerk ehrlich:
Sobald eine Produktionsquelle eine dieser Dateien importiert, wird der Test rot.
Wer die Schale in Betrieb nimmt, entfernt Vermerk und Test mit.

`HangarLifecycleContract.js` bleibt zusätzlich deshalb erhalten, weil der
Vertragstest `hangar-desktop-flow` an ihm prüft, dass Navigations-Ereignisse und
Capability-IDs projektweit zusammenpassen. Diese Prüfung würde bei einer
Umbenennung im Modus-Vertrag rot — sie hat also Wert, unabhängig davon, dass die
Datei selbst nicht läuft.

## Prüfungen für den Hangar

| Bereich | Test |
| --- | --- |
| Fahrzeugkatalog, Beschriftungen, modusabhängige Anzeige | `tests/arcade-hangar-rules.contract.test.mjs` |
| Fight- und Arcade-Balance, Freischaltungen, Budgets | `tests/arcade-hangar-rules.contract.test.mjs` |
| Fortschritt: XP, Aufwertungen, Momentaufnahmen | `tests/arcade-hangar-rules.contract.test.mjs` |
| Desktop-Einstieg, Navigation, Rückkehr | `tests/platform-capabilities.contract.test.mjs` |
| Werkstatt-Modul und Persistenz | `tests/editor-authoring-contract.contract.test.mjs` |
| Auswahl-Rückschreibung und Ablauf | `tests/hangar-desktop-flow.contract.test.mjs` |
| Werkstatt-Oberfläche | `tests/arcade-hangar-workshop.contract.test.mjs` |

Desktop-Durchläufe laufen im Cluster `desktop-flows`:

```bash
node scripts/run-playwright-targeted-clusters.mjs desktop-flows
```

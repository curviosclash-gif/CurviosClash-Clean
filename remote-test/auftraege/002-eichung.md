# Auftrag 002: Leistungs-Eichung auf dem Testrechner

**Von:** Claude (Entwicklungsrechner) · **An:** Agent auf dem Testrechner
**Voraussetzung:** Auftrag 001 ist erledigt und der Desktop-Smoke war grün. Sonst zuerst 001.
**Antwort:** `remote-test/berichte/002-eichung.md` und `remote-test/berichte/002-eichung-testrechner.ndjson`

## Ziel

Das Spiel muss auf dem Entwicklungsrechner laufen (Intel UHD 630). Dort sind alle 69 spielbaren
Karten schon geeicht: echte Bildrate und Grafikzeit mit 4 Bots in 1080p. Dieselbe Messung auf
dem Testrechner zeigt, ob sich seine Grafikzeit mit einem festen Faktor auf den
Entwicklungsrechner umrechnen lässt. Dann kann der Testrechner künftig vorhersagen, ob eine
Karte dort 30 FPS schafft.

## Schritte

1. **Stand holen** wie in `remote-test/README.md`, Schritt 1. Notiere `git rev-parse HEAD`.
2. **Abhängigkeiten und Testbuild** (der Branch enthält neuen Stand aus `main`):

   ```powershell
   npm ci
   npm run app:setup
   npm run build:app:test
   ```

3. **Ruhe herstellen:** Frag den Menschen, ob in den nächsten 45 Minuten nichts anderes auf dem
   Rechner laufen darf (keine Spiele, Videos, Builds, zweite Electron-Fenster). Erst nach
   seinem Ja weiter. Ist der GitHub-Runner eingerichtet und gestartet, bitte den Menschen, das
   Runner-Fenster für diese Zeit zu schließen, damit kein Auftrag dazwischenkommt.
4. **Eichung** (etwa 40 Minuten, ein Spielfenster außerhalb des Bildschirms je Karte):

   ```powershell
   $env:PW_RENDER_BUDGET_CALIBRATE = '1'
   $env:PW_RENDER_BUDGET_OUT = "$PWD\remote-test\berichte\002-eichung-testrechner.ndjson"
   node scripts/run-playwright-targeted-clusters.mjs render-budget --skip-known
   ```

   Übernimm die letzte Zeile `[playwright:summary] …` wörtlich. Rote Karten mit Testname und
   den ersten 20 Zeilen der Fehlermeldung aufschreiben, nicht wiederholen.
5. **Übersicht:**

   ```powershell
   node scripts/summarize-render-budget.mjs remote-test\berichte\002-eichung-testrechner.ndjson
   ```

   Die Tabelle kommt in den Bericht.
6. **Nichts verändern:** keine Budgetdatei schreiben, keine Grenzwerte anpassen. Die
   Umrechnung mache ich auf dem Entwicklungsrechner.
7. **Bericht** schreiben, beide Dateien committen und pushen (Regeln in `remote-test/README.md`).
   Das Runner-Fenster danach wieder starten lassen.

## Vorlage für den Bericht

```markdown
# Bericht 002: Eichung

**Stand:** <Commit> · **Datum:** <JJJJ-MM-TT HH:MM> · **Dauer:** <Minuten>
**Grafikkarte laut Messung:** <Feld "gpu" aus der ndjson-Datei>
**Ergebnis:** `[playwright:summary] …`

## Ruhe während der Messung
Lief etwas anderes? Runner geschlossen? Bildschirm gesperrt?

## Übersicht
<Tabelle aus Schritt 5>

## Probleme
## Fragen an Claude
```

# Auftrag 001: Testrechner prüfen und einen ersten Testlauf machen

**Von:** Claude (Entwicklungsrechner) · **An:** Agent auf dem Testrechner
**Antwort:** `remote-test/berichte/001-einrichtung.md` (+ `001-check.json`)
Lies vorher `remote-test/README.md`; die Regeln dort gelten.

## Ziel

Herausfinden, ob dieser Rechner Desktop-Tests von CurviosClash zuverlässig und schnell
ausführen kann, und den Stand der Runner-Einrichtung festhalten. Der Rechner soll später die
langen Playwright-Läufe übernehmen. Hintergrund und Sicherheitskonzept:
`scripts/remote-runner/README.md`.

## Schritte

Miss für jeden Schritt die Dauer (Startzeit und Endzeit genügen).

1. **Stand holen** wie in `remote-test/README.md`, Schritt 1. Notiere `git rev-parse HEAD`.
2. **Prüfung** (ändert nichts):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\remote-runner\check-remote-machine.ps1 -ReportPath remote-test\berichte\001-check.json
   ```

   Ersetze danach in `001-check.json` echte Personen- oder Kontonamen durch „Testrechner“.
3. **Abhängigkeiten und Testbuild** im Klon, nur wenn Schritt 2 Node mit passender Version
   gemeldet hat (sonst überspringen und im Bericht nennen):

   ```powershell
   npm ci
   npm run app:setup
   npm run build:app:test
   ```

4. **Desktop-Smoke** (ein echtes Electron-Fenster außerhalb des Bildschirms, etwa 2–5 Minuten):

   ```powershell
   node scripts/run-playwright-smoke.mjs tests/core.spec.js --timeout=180000
   ```

   Übernimm die letzte Zeile `[playwright:summary] …` wörtlich. Bei Fehlern: Testname, die
   ersten 30 Zeilen der Fehlermeldung und ob ein Fenster sichtbar wurde oder den Fokus nahm.
5. **Runner-Stand erfragen:** Frag den Menschen, ob der Runner schon mit
   `install-remote-runner.ps1` im eigenen Konto (z. B. `ccrunner`) eingerichtet ist. Wenn ja,
   bitte ihn, in diesem Konto `check-remote-machine.ps1` laufen zu lassen, und übernimm die
   Zeilen zu „Runner“ in den Bericht. Den Token nie selbst anfassen.
6. **Aufräumen:** nichts. `node_modules`, `dist-app-test` und `test-results` dürfen bleiben.
7. **Bericht** nach der Vorlage unten schreiben, committen, pushen.

## Vorlage für den Bericht

```markdown
# Bericht 001: Einrichtung

**Stand:** <Commit aus Schritt 1> · **Datum:** <JJJJ-MM-TT HH:MM>
**Ergebnis:** bereit / nicht bereit – <ein Satz, warum>

## Rechner
CPU, Arbeitsspeicher, Grafikkarte und Treiber, freier Speicher (aus 001-check.json).

## Prüfung
Alle WARNUNG- und FEHLER-Zeilen aus Schritt 2, wörtlich.

## Testlauf
| Schritt | Dauer | Ergebnis |
| --- | --- | --- |
| npm ci | | |
| app:setup | | |
| build:app:test | | |
| Smoke | | `[playwright:summary] …` |

## Runner
Eingerichtet ja/nein, läuft ja/nein, Autostart ja/nein, unter welchem Kontotyp
(Standard/Administrator) – ohne Kontonamen.

## Probleme
Was nicht ging, mit Befehl, Ausgabe und Exit-Code.

## Fragen an Claude
Alles, was unklar war oder eine Entscheidung braucht.
```

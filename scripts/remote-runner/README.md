# Testrechner über das Internet

Ein zweiter, stärkerer Rechner übernimmt die langen Playwright-Läufe, damit der
Entwicklungsrechner frei bleibt. Er holt sich die Aufträge selbst bei GitHub ab.
Am Router muss nichts geöffnet werden.

**Wofür er da ist:** Funktionstests (Cluster, Stufe 2 und 3, Sammelläufe).
**Wofür nicht:** Das fertige Spiel muss auf dem Entwicklungsrechner laufen. Leistung
(FPS, `gpu-stress`, Benchmarks) und der abschließende Desktop-Beleg werden deshalb
weiter dort gemessen. Ein schneller Rechner kann auch Zeitprobleme verdecken, die auf
dem Zielrechner auftreten. Wackelt ein Test nur dort, zählt der Zielrechner.

## So funktioniert es

1. Ein Agent oder du startest `npm run test:remote -- <cluster>`.
2. Das Werkzeug lädt den Branch zu GitHub hoch (nur Fast-Forward, nie `main`) und
   startet den Workflow `.github/workflows/remote-desktop.yml`.
3. Der Testrechner holt den Auftrag ab, baut `dist-app`, führt die Tests aus und lädt
   die Ergebnisse hoch.
4. Das Werkzeug wartet, holt die Ergebnisse nach `test-results/remote-runs/<run-id>/`
   und gibt die `[playwright:summary]`-Zeilen aus.

## Sicherheit

| Schutz | Wirkung |
| --- | --- |
| Start nur von Hand (`workflow_dispatch`) | Kein Push und kein fremder Pull Request startet Code auf dem Testrechner. Starten kann nur, wer Schreibrechte am Repository hat. |
| Freigabe für Fork-PRs (Teil A, Schritt 1) | Auch ein manipulierter Pull Request läuft erst nach deiner Freigabe. |
| Eigenes Windows-Konto ohne Adminrechte | Testcode sieht keine Dateien des Besitzers und kann das System nicht verändern. |
| Ordner nur für dieses Konto | Andere Konten auf dem Rechner können den Runner nicht austauschen. |
| Feste Runner-Version mit SHA256-Prüfung | Das Skript lädt nur genau die geprüfte Datei von GitHub. |
| Einmal-Token, eine Stunde gültig | Der Token taugt nur zum Anmelden und verfällt danach. |
| `persist-credentials: false`, nur Leserechte | Nach dem Lauf bleibt kein GitHub-Schlüssel auf dem Rechner. |
| Workflow bricht ab bei Adminrechten oder Dienstbetrieb | Fehlkonfiguration fällt sofort auf. |
| Wächter-Test `tests/remote-runner.contract.test.mjs` | Keine spätere Änderung kann das unbemerkt aufweichen. |

Das Repository ist **öffentlich**. Laufprotokolle und Ergebnisse kann jeder sehen. Darin
stehen der Name des Runners und des Windows-Kontos, deshalb keine echten Namen verwenden.

## Teil A: einmalig für den Repository-Besitzer

Das Konto `curviosclash-gif` braucht dafür Adminrechte am Repository.

1. Auf GitHub: **Settings → Actions → General → „Approval for running fork pull request
   workflows from contributors“** auf **„Require approval for all external
   contributors“** stellen und speichern.
2. Anmelde-Token erzeugen: **Settings → Actions → Runners → New self-hosted runner →
   Windows**. Im angezeigten Befehl `config.cmd ... --token XXXX` nur den Wert nach
   `--token` kopieren. Er gilt eine Stunde.
3. Den Token über einen privaten Weg schicken (Signal, persönlich, Telefon), nicht per
   E-Mail und nicht in einen Chat, der gespeichert wird.
4. Für `npm run test:remote` braucht `gh` ein Konto mit Schreibrechten:
   `gh auth status` zeigt das aktive Konto, `gh auth switch --user <konto>` wechselt.

## Teil B: auf dem Testrechner (etwa 20 Minuten)

**Prüfen ohne etwas zu ändern:** `check-remote-machine.ps1` meldet je Punkt OK, WARNUNG
oder FEHLER (Konto, Sitzung, Git, Node, Speicher, Grafiktreiber, GitHub, Runner-Status).
Mit `-ReportPath <datei.json>` schreibt es das Ergebnis zusätzlich als JSON.

**Repo schon geklont?** Dann liegen beide Skripte schon unter `scripts\remote-runner\` und
Schritt 5 entfällt. Der Runner nutzt den Klon nicht; er holt sich je Auftrag einen eigenen
Stand. Gehört der Klon einem anderen Windows-Konto, kann `ccrunner` ihn nicht lesen; dann die
beiden Skripte in einen Ordner kopieren, den `ccrunner` lesen darf.

**Ein Agent auf dem Testrechner** (Claude Code, Codex …) kann die Prüfung und einen lokalen
Smoke-Test selbst ausführen und berichten. Aufträge und Berichte liegen auf dem Branch
`remote-test-branch` unter `remote-test/`; dort steht das Protokoll. Den Runner-Token gibt
immer der Mensch selbst ein, nie der Agent.

1. **Neues Windows-Konto anlegen:** Einstellungen → Konten → Andere Benutzer → Konto
   hinzufügen → „Ich kenne die Anmeldeinformationen nicht“ → „Benutzer ohne
   Microsoft-Konto hinzufügen“. Name z. B. `ccrunner`, Kontotyp **Standardbenutzer**.
2. **Git installieren** (mit dem eigenen Konto, normal mit Adminrechten):
   <https://git-scm.com/download/win>, alle Voreinstellungen lassen.
3. **Grafiktreiber aktualisieren** (Hersteller-Seite von NVIDIA, AMD oder Intel).
4. **Als `ccrunner` anmelden** und PowerShell öffnen (Startmenü → „PowerShell“, *nicht*
   „Als Administrator ausführen“).
5. Skript herunterladen und vor dem Start ansehen:

   ```powershell
   Invoke-WebRequest -UseBasicParsing -Uri https://raw.githubusercontent.com/curviosclash-gif/CurviosClash-Clean/main/scripts/remote-runner/install-remote-runner.ps1 -OutFile install-remote-runner.ps1
   notepad install-remote-runner.ps1
   ```

6. Skript starten und den Token einfügen, wenn danach gefragt wird:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-remote-runner.ps1
   ```

   `-ExecutionPolicy Bypass` gilt nur für diesen einen Aufruf und ändert keine
   Systemeinstellung. Das Skript legt `C:\cc-runner` an, prüft die Runner-Datei, meldet
   den Rechner an, legt einen Autostart an und startet den Runner in einem minimierten
   Fenster.
7. **Energieoptionen:** Einstellungen → System → Netzbetrieb und Energiesparen →
   „Bildschirm ausschalten“ darf an bleiben, **„Energiesparmodus“ auf „Nie“**.

**Im Alltag:** An `ccrunner` angemeldet lassen. Zum eigenen Konto wechseln geht über
„Benutzer wechseln“ (nicht abmelden). Ob Tests auch bei gesperrtem Bildschirm voll
zeichnen, beim ersten Lauf prüfen. Sonst die Sperre für dieses Konto abschalten.
Wer den Rechner selbst braucht, schließt das minimierte Runner-Fenster. Aufträge warten
dann bei GitHub (bis zu 24 Stunden).

**Entfernen:** Der Besitzer erzeugt unter Settings → Actions → Runners → (Runner) →
Remove einen Entfernungs-Token. Danach:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-remote-runner.ps1 -Uninstall
```

Anschließend den Ordner `C:\cc-runner` und bei Bedarf das Konto `ccrunner` löschen.

## Teil C: Tests starten (für Menschen und Agenten)

```bash
npm run test:remote -- core-surface desktop-flows
```

```bash
npm run test:remote -- tests/core-targeted-surface.spec.js --grep "T20kb:|T20kc:"
```

Ohne Ziel laufen die Standard-Cluster. Weitere Schalter: `--ref <branch>`, `--no-push`,
`--no-wait` (startet nur und nennt die Lauf-Nummer), `--attach <run-id>` (wartet auf
einen gestarteten Lauf), `--help`.

| Exit-Code | Bedeutung |
| --- | --- |
| 0 | Lauf grün |
| 1 | Tests rot oder Lauf abgebrochen |
| 2 | Bedienfehler, fehlende Rechte, Branch nicht hochladbar |
| 75 | Testrechner aus oder belegt; Lauf bleibt bei GitHub, später `--attach` |

Der Testrechner läuft immer mit `--skip-known` und wartet bis zu zwei Stunden auf sein
eigenes Playwright-Schloss. Mehrere Aufträge stehen bei GitHub in der Warteschlange und
laufen nacheinander. Getestet wird nur, was committet ist. Der Branch braucht den
Workflow aus `main`; ältere Branches erst mit `main` zusammenführen.

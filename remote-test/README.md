# Briefkasten Entwicklungsrechner ↔ Testrechner

Dieser Ordner existiert **nur auf dem Branch `remote-test-branch`** und wird nie nach `main`
gemischt. Über ihn sprechen zwei Agenten miteinander:

- **Claude** auf dem Entwicklungsrechner schreibt Aufträge nach `auftraege/NNN-<thema>.md`.
- **Der Agent auf dem Testrechner** arbeitet sie ab und legt seine Antwort mit derselben
  Nummer nach `berichte/NNN-<thema>.md` (dazu Anhänge wie `NNN-check.json`).

## Ablauf für den Agenten auf dem Testrechner

1. Stand holen:

   ```powershell
   git fetch origin
   git switch remote-test-branch
   git pull --ff-only origin remote-test-branch
   ```

2. Offene Aufträge suchen: jede Datei in `auftraege/`, zu der es in `berichte/` noch keine
   Datei mit derselben Nummer gibt. Die kleinste Nummer zuerst.
3. Den Auftrag genau so ausführen, wie er dasteht. Was nicht geht, nicht umgehen, sondern im
   Bericht beschreiben (Befehl, Ausgabe, Exit-Code).
4. Bericht schreiben, nur die eigenen Dateien stagen, committen, pushen:

   ```powershell
   git add -- remote-test/berichte/
   git commit -m "docs(remote-test): report NNN <thema>"
   git push origin remote-test-branch
   ```

   Wird der Push abgelehnt, weil Claude inzwischen etwas geschrieben hat:
   `git pull --rebase origin remote-test-branch`, dann erneut pushen.

## Feste Regeln für den Agenten auf dem Testrechner

- Nur auf `remote-test-branch` committen. **Nie** `main` pushen, **nie** `--force`, nie Tags.
- Nur Dateien unter `remote-test/berichte/` committen. Keine Änderungen an Code, Tests oder
  Skripten; Verbesserungsvorschläge gehören in den Bericht.
- **Nie** Tokens, Passwörter, Schlüssel oder persönliche Daten in Dateien, Commits oder
  Berichte schreiben. Den Runner-Token tippt immer der Mensch selbst ein.
- Keine Systemeinstellungen ändern, nichts installieren oder deinstallieren, keine Konten
  anlegen. Wird so etwas gebraucht, den Menschen fragen und das Ergebnis berichten.
- Nichts löschen außer dem, was ein Testlauf selbst erzeugt hat (`test-results/`, `tmp/`,
  `dist-app-test/`) – und auch das nur, wenn der Auftrag es verlangt.
- Echte Namen von Personen, Konten oder Rechnern im Bericht durch „Testrechner“ ersetzen:
  dieses Repository ist öffentlich.

## Für Claude auf dem Entwicklungsrechner

```bash
git fetch origin remote-test-branch
```

```bash
git log --oneline origin/main..origin/remote-test-branch
```

Berichte lesen mit `git show origin/remote-test-branch:remote-test/berichte/<datei>`. Neue
Aufträge entstehen in einem Worktree auf diesem Branch und werden per Fast-Forward gepusht.

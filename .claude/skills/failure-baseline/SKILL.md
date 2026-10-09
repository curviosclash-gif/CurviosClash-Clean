---
name: failure-baseline
description: Klärt in diesem Repo, ob ein roter Playwright-Cluster an der eigenen Änderung liegt oder schon vorher rot war — nimmt den Fehlerstand ohne die Änderung auf und vergleicht ihn mit dem aktuellen. Nutze diesen Skill immer wenn ein Cluster oder Spec fehlschlägt und unklar ist ob das neu ist, wenn jemand fragt "war das vorher schon kaputt", "liegt das an mir", "sind das bekannte Fehler", und immer bevor du "known pre-existing failures" im Ergebnisbericht meldest. Verhindert sowohl verschleppte Regressionen als auch das Stoppen an fremden Alt-Fehlern.
---

# Alt-Fehler von eigenen Fehlern trennen

Mehrere Playwright-Cluster in diesem Projekt sind seit längerem teilweise rot. Die Commit-Historie nennt das „at their known pre-existing failures".

Das ist wichtiger, als es klingt. „War schon vorher kaputt" ist die bequemste Erklärung für jeden roten Test und deshalb genau die, die eine echte Regression durchlässt. Ein Mengenvergleich kann sich nicht selbst belügen.

## Lernschleife

Prüfe vor jeder Schlussantwort die vorhandenen Belege auf eine wiederverwendbare Verbesserung, auch nach erfolgreicher QA oder abgebrochener Arbeit. Signale sind falsch zugeordnete Fehler, unvollständige Läufe, übersehene Fremdlast oder ein irreführender Logvergleich.

- Übernimm nur eine verstandene Ursache mit am betroffenen Fall verifizierter Abhilfe, die künftige Aufgaben betrifft. Einzelfälle, Vermutungen und bereits ausreichend geregelte Fälle erzeugen keine neue Regel.
- Parserfehler gehören in `scripts/compare-failures.mjs` und einen Verhaltenstest mit passenden Logs; fehlende Vergleichsentscheidungen hier. Ein Katalogtreffer nach Testtitel belegt keine unveränderte Ursache: gleiche aktuelle Fehlermeldung und relevante Ausgangsbedingungen ab. Erweitere den Fehlerkatalog nicht, um einen Lauf grün erscheinen zu lassen.
- Prüfe eine geänderte Klassifizierung am ursprünglichen Fehlerpaar und einem Gegenfall, etwa demselben Testtitel mit anderer Ursache oder einem nicht ausgeführten Test. Fehlende Ausführung gilt weder als Reparatur noch als unveränderte Baseline. Validiere geänderte Helfer mit den betroffenen Tests und Skill-Änderungen auf Format und Referenzlinks.

Verifizierte aufgabenbezogene Pflege gehört zu diesem Ablauf. Nutzerumfang, Nur-Lese-Aufträge, Dateibesitz und Repository-Gates gelten weiterhin; ist die Pflege dadurch gesperrt, melde sie als ausstehend. Bewahre Auslöser, Geltungsbereich, Abhilfe und Prüfkriterium in der bestehenden zuständigen Regel oder Prüfung; keine Fehlerchronik oder neuen Prozessberichte. Nenne abschließend knapp das Ergebnis der Lernprüfung: keine neue Lehre, bereits abgedeckt, verbessert mit Prüfergebnis oder ausstehend.

## Schritt 0 — erst in die eingecheckte Liste schauen

Seit `scripts/architecture/playwright-known-failures.json` im Repo liegt, ist der erste Schritt kein Testlauf, sondern ein Blick in diese Datei. Sie nennt je Eintrag Spec-Datei, Testtitel, das Datum seit wann er rot ist, die Ursache und die Art (`stale-test`, `regression`, `env`, `flaky`). Steht dein roter Test dort, gleiche die aktuelle Fehlermeldung und Ursache mit dem Eintrag ab; der Titel allein genügt nicht. Nenne im Ergebnisbericht Datum, Grund und Ergebnis dieses Abgleichs.

Noch schneller geht es über die Zusammenfassung: `scripts/summarize-playwright-results.mjs` liest dieselbe Datei und klassifiziert jeden roten Test eines Laufs anhand von Testkennung und Fehlermeldung als `known`, `env` oder `new`. `new=0` bedeutet, dass kein Fehlschlag als neu klassifiziert wurde; Umgebungsfehler und fehlende Ausführung können trotzdem offen sein. Prüfe die Klassifizierungen, übersprungene Tests und `didNotRun` vor der Einordnung als unveränderte Baseline.

Ist ein roter Test **nicht** eingetragen oder weicht seine aktuelle Ursache vom Eintrag ab, prüfe das Artefakt-Datum und danach den unveränderten Ausgangsstand mit einer Gegenprobe. Und umgekehrt: Wird ein eingetragener Test tatsächlich ausgeführt und wieder grün, nimm ihn heraus und senke `count` — der Contract-Test `tests/playwright-known-failures.contract.test.mjs` erzwingt, dass jeder Eintrag auf einen existierenden Test zeigt. Überspringen oder Nichtausführung belegen keine Reparatur.

## Der günstige Weg: Baseline vor der Änderung

Wenn du schon weißt, dass du einen wackligen Cluster berühren wirst, nimm den Stand auf, **bevor** du Code änderst. Dann brauchst du später nichts beiseitezulegen.

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\curvios-baseline" | Out-Null
```

```powershell
node scripts/run-playwright-targeted-clusters.mjs physics-hunt 2>&1 | Tee-Object "$env:TEMP\curvios-baseline\physics-hunt.base.log"
```

Die Logs liegen bewusst außerhalb des Repos: `AGENTS.md` verbietet Logs und generierte Prozessberichte im Arbeitsbaum.

## Der übliche Weg: Baseline nachholen

Meistens fällt der rote Cluster erst auf, wenn die Änderung schon steht. Verändere dafür nicht den aktiven Arbeitsbaum und benutze keinen Stash: der Stash-Stack wird von allen Worktrees dieses Repositorys geteilt.

Zuerst den aktuellen Stand festhalten, damit du ihn nicht zweimal laufen lassen musst:

```powershell
node scripts/run-playwright-targeted-clusters.mjs physics-hunt 2>&1 | Tee-Object "$env:TEMP\curvios-baseline\physics-hunt.current.log"
```

Nimm die Baseline stattdessen in einem getrennten, detached Worktree am unveränderten Ausgangscommit der Aufgabe auf. Prüfe vorher die aktuelle Worktree-Liste und das Playwright-Schloss. Wenn die Sitzungsgrenze erreicht ist, hole vor dem zusätzlichen Worktree die in `AGENTS.md` verlangte Nutzerzustimmung ein.

```powershell
$commonGitDir = (Resolve-Path (git rev-parse --git-common-dir)).Path
$repositoryRoot = Split-Path -Parent $commonGitDir
$baselineDir = Join-Path $repositoryRoot '.claude/worktrees/failure-baseline-<unique>'
git worktree add --detach $baselineDir '<task-base-commit>'
```

`<task-base-commit>` ist der Commit, von dem der Aufgaben-Worktree erstellt wurde, nicht ein inzwischen weitergelaufener Branchname. Richte benötigte Abhängigkeiten nach dem normalen Worktree-Verfahren des Repositorys ein. Ändere oder kopiere keine Produktdateien in die Baseline; sonst misst du keinen unveränderten Stand.

Baseline aufnehmen:

```powershell
Push-Location -LiteralPath $baselineDir
try {
    node scripts/run-playwright-targeted-clusters.mjs physics-hunt 2>&1 | Tee-Object "$env:TEMP\curvios-baseline\physics-hunt.base.log"
} finally {
    Pop-Location
}
```

Der Aufgaben-Worktree bleibt währenddessen unverändert. Entferne den Baseline-Worktree erst nach gesicherter Auswertung und nach [Worktree Cleanup](../worktree-cleanup/SKILL.md) sowie den aktuellen Regeln für Worktree- und Testartefakt-Bereinigung. Bewahre nötige Belege und einzigartige Dateien gezielt statt einer zusätzlichen Vollkopie; löse vorhandene `node_modules`-Junctions zuerst.

## Vergleichen

```bash
node .claude/skills/failure-baseline/scripts/compare-failures.mjs "$TEMP/curvios-baseline/physics-hunt.base.log" "$TEMP/curvios-baseline/physics-hunt.current.log"
```

Das Skript liest die nummerierten Fehlerblöcke des Playwright-`list`-Reporters aus beiden Logs und teilt sie in drei Gruppen:

- **Neu kaputt** — steht nur im aktuellen Lauf. Das ist deine Regression, und sie ist ein Stopp.
- **Bekannte Alt-Fehler** — steht in beiden. Die darfst du im Ergebnisbericht benennen.
- **Nebenbei grün geworden** — stand nur in der Baseline. Erwähnenswert, aber prüfe kurz nach, ob der Test wirklich das Richtige tut und nicht bloß übersprungen wird.

Der Exit-Code ist `1`, sobald es mindestens eine neue Regression gibt.

Mit nur einem Log-Argument listet das Skript einfach die Fehlschläge dieses Laufs auf — nützlich, um eine lange Ausgabe auf das Wesentliche einzudampfen.

## Wackelige Tests

Ein Test, der mal rot und mal grün ist, erscheint im Vergleich als Regression oder als Reparatur, ohne eine zu sein. Wenn ein einzelner neu roter Test verdächtig aussieht — Zeitüberschreitung, Kamerafahrt, Netzwerkverbindung — lass genau diesen Spec ein zweites Mal auf der Baseline laufen, bevor du ihn dir zuschreibst:

```bash
node scripts/run-playwright-targeted.mjs tests/physics-hunt.spec.js --grep "T4:"
```

Wenn er auch ohne deine Änderung sprunghaft ist, sag das so. „Flaky" ist eine zulässige Antwort, „war schon vorher kaputt" ohne Beleg nicht.

## Was in den Ergebnisbericht gehört

Formuliere das Ergebnis so, dass es nachprüfbar bleibt:

```
Tests: ..., Cluster physics-hunt mit drei Fehlschlägen, die sich ohne diese
Änderung genauso reproduzieren.
```

Nicht: „Cluster physics-hunt rot, aber das war schon vorher so."

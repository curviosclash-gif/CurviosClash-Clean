---
name: failure-baseline
description: Klärt in diesem Repo, ob ein roter Playwright-Cluster an der eigenen Änderung liegt oder schon vorher rot war — nimmt den Fehlerstand ohne die Änderung auf und vergleicht ihn mit dem aktuellen. Nutze diesen Skill immer wenn ein Cluster oder Spec fehlschlägt und unklar ist ob das neu ist, wenn jemand fragt "war das vorher schon kaputt", "liegt das an mir", "sind das bekannte Fehler", und immer bevor du in einem Commit-Body von "known pre-existing failures" sprechen willst. Verhindert sowohl verschleppte Regressionen als auch das Stoppen an fremden Alt-Fehlern.
---

# Alt-Fehler von eigenen Fehlern trennen

Mehrere Playwright-Cluster in diesem Projekt sind seit längerem teilweise rot. Die Commit-Historie nennt das „at their known pre-existing failures" — aber im Repo steht keine Liste dieser Fehler, und es gibt auch keine, weil sie sich mit jedem Umbau verschiebt. Die Aussage muss deshalb jedes Mal neu belegt werden.

Das ist wichtiger, als es klingt. „War schon vorher kaputt" ist die bequemste Erklärung für jeden roten Test und deshalb genau die, die eine echte Regression durchlässt. Ein Mengenvergleich kann sich nicht selbst belügen.

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

Meistens fällt der rote Cluster erst auf, wenn die Änderung schon steht. Dann legst du **nur deine eigenen Dateien** kurz beiseite.

Zuerst den aktuellen Stand festhalten, damit du ihn nicht zweimal laufen lassen musst:

```powershell
node scripts/run-playwright-targeted-clusters.mjs physics-hunt 2>&1 | Tee-Object "$env:TEMP\curvios-baseline\physics-hunt.current.log"
```

Dann die eigenen Pfade beiseitelegen — **immer einzeln aufgezählt**, nie pauschal, weil der Arbeitsbaum fremde Änderungen des Nutzers trägt:

```bash
git stash push -u -- src/entities/arena/ArenaCollision.js src/modes/HuntCollisionOps.js src/modes/HuntModeStrategy.js src/hunt/HuntConfig.js src/shared/contracts/EntityRuntimeConfig.js tests/collision-impact-consistency.contract.test.mjs
```

Zwei Fallen stecken in diesem einen Befehl:

- **`-u` ist Pflicht, sobald eine neue Datei dabei ist.** Ohne `-u` lässt `git stash push` unversionierte Dateien liegen. Eine neu angelegte Datei bliebe also stehen, während der Import darauf verschwindet.
- **Alle Dateien der Änderung müssen mit, nicht nur die auffälligen.** Wenn ein Modul zurückgenommen wird, der Aufrufer aber stehen bleibt, zeigt der Import ins Leere und der ganze Cluster fällt schon beim Laden um. Das Ergebnis sieht aus wie „vorher war alles rot" und ist in Wahrheit gar keine Baseline. Prüfe deshalb vor dem Stash mit `git status --short`, welche Dateien zusammengehören.

Baseline aufnehmen:

```powershell
node scripts/run-playwright-targeted-clusters.mjs physics-hunt 2>&1 | Tee-Object "$env:TEMP\curvios-baseline\physics-hunt.base.log"
```

Und sofort zurückholen:

```bash
git stash pop
```

`git stash pop` ist der wichtigste Befehl in diesem Ablauf. Führe ihn auch dann aus, wenn der Testlauf abgebrochen ist, abgestürzt ist oder du zwischendurch etwas anderes gemacht hast. Kontrolliere danach mit `git status`, dass deine Dateien wieder als geändert erscheinen. Bleibt ein Stash liegen, sieht der Nutzer plötzlich seinen eigenen Stand ohne deine Arbeit — und hält das für Datenverlust.

Wenn `git stash pop` einen Konflikt meldet, halte an und melde es. Löse ihn nicht auf gut Glück auf.

## Vergleichen

```bash
node .claude/skills/failure-baseline/scripts/compare-failures.mjs "$TEMP/curvios-baseline/physics-hunt.base.log" "$TEMP/curvios-baseline/physics-hunt.current.log"
```

Das Skript liest die nummerierten Fehlerblöcke des Playwright-`list`-Reporters aus beiden Logs und teilt sie in drei Gruppen:

- **Neu kaputt** — steht nur im aktuellen Lauf. Das ist deine Regression, und sie ist ein Stopp.
- **Bekannte Alt-Fehler** — steht in beiden. Die darfst du im Commit-Body benennen.
- **Nebenbei grün geworden** — stand nur in der Baseline. Erwähnenswert, aber prüfe kurz nach, ob der Test wirklich das Richtige tut und nicht bloß übersprungen wird.

Der Exit-Code ist `1`, sobald es mindestens eine neue Regression gibt.

Mit nur einem Log-Argument listet das Skript einfach die Fehlschläge dieses Laufs auf — nützlich, um eine lange Ausgabe auf das Wesentliche einzudampfen.

## Wackelige Tests

Ein Test, der mal rot und mal grün ist, erscheint im Vergleich als Regression oder als Reparatur, ohne eine zu sein. Wenn ein einzelner neu roter Test verdächtig aussieht — Zeitüberschreitung, Kamerafahrt, Netzwerkverbindung — lass genau diesen Spec ein zweites Mal auf der Baseline laufen, bevor du ihn dir zuschreibst:

```bash
node scripts/run-playwright-targeted.mjs tests/physics-hunt.spec.js --grep "T4:"
```

Wenn er auch ohne deine Änderung sprunghaft ist, sag das so. „Flaky" ist eine zulässige Antwort, „war schon vorher kaputt" ohne Beleg nicht.

## Was in den Commit gehört

Formuliere das Ergebnis so, dass es nachprüfbar bleibt:

```
Tests: ..., Cluster physics-hunt mit drei Fehlschlägen, die sich ohne diese
Änderung genauso reproduzieren.
```

Nicht: „Cluster physics-hunt rot, aber das war schon vorher so."

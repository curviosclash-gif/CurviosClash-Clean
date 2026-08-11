---
name: atomic-commit
description: Erstellt in diesem Repo genau einen atomaren Commit nach AGENTS.md — trennt eigene von fremden Änderungen im Arbeitsbaum, staged Dateien einzeln statt pauschal, prüft den Betreff gegen den commit-msg-Hook und schreibt den Body im Why/Tests-Stil des Projekts. Nutze diesen Skill immer wenn committet, eingecheckt oder "eine Commit-Nachricht geschrieben" werden soll, wenn gefragt wird ob etwas commitfähig ist, und auch dann wenn du gerade selbst eine Aufgabe abgeschlossen hast und ein Commit der nächste Schritt wäre. Verhindert git add -A, mitgenommene Fremdänderungen und abgelehnte Commit-Betreffe.
---

# Ein atomarer Commit

Der Arbeitsbaum dieses Projekts trägt fast immer parallele Änderungen des Nutzers — oft ein Dutzend Dateien, die mit deiner Aufgabe nichts zu tun haben. Das ist der Normalfall, nicht die Ausnahme. Jeder Schritt hier folgt daraus.

Ein falscher Commit ist teuer, weil er schwer rückgängig zu machen ist, ohne fremde Arbeit zu beschädigen. Lieber keinen Commit erstellen und den Konflikt melden, als einen Commit erstellen, der aufgeräumt werden muss.

## Schritt 0 — Vorbedingung: war es grün?

Committe nur, wenn die betroffenen Tests und der passende Build gelaufen und bewertet sind. Welche das sind, bestimmt `verify-scope`. Wenn du nicht sagen kannst, was gelaufen ist, kannst du auch die `Tests:`-Zeile nicht ehrlich schreiben — dann ist der Commit noch nicht dran.

Prüfe außerdem den Branch. Wenn `git branch --show-current` `main` meldet, lege zuerst einen Branch an.

## Schritt 1 — eigene von fremden Änderungen trennen

```bash
git status --porcelain=v1 -uall
```

Gehe die Liste durch und ordne jede Datei einer von drei Gruppen zu:

1. **Meine** — von dir in dieser Aufgabe geschrieben.
2. **Fremde** — schon vorher geändert oder vom Nutzer parallel bearbeitet.
3. **Gemischte** — eine Datei, die beides enthält.

Gruppe 3 ist der kritische Fall. `git add <datei>` nimmt immer die ganze Datei, also auch fremde Zeilen. Prüfe im Zweifel mit `git diff -- <datei>`, ob wirklich alle Hunks von dir stammen. Wenn nicht: **kein Commit.** Melde stattdessen, welche Datei betroffen ist und welche Zeilen dort nicht zu deiner Aufgabe gehören, und lass den Nutzer entscheiden.

Unversionierte Dateien (`??`) gehören nur dann dazu, wenn du sie selbst angelegt hast. Lösche fremde unversionierte Dateien niemals eigenständig — auch nicht, um `git status` aufzuräumen.

## Schritt 2 — einzeln stagen

```bash
git add src/modes/ArcadeModeStrategy.js tests/arcade-collision-health-pool.contract.test.mjs
```

Nie `git add -A`, nie `git add .`, nie `git add src/`. Der Grund ist nicht Stilfrage: pauschales Stagen ist genau der Mechanismus, mit dem fremde Arbeit in einen fremden Commit rutscht.

Kontrolliere danach, was tatsächlich vorgemerkt ist:

```bash
git diff --cached --stat
```

Steht dort etwas, das du nicht bewusst hinzugefügt hast, nimm es mit `git restore --staged <datei>` wieder heraus.

## Schritt 3 — den Betreff formulieren

`.githooks/commit-msg` ruft `scripts/check-commit-message.mjs` auf und prüft gegen:

```
^(feat|fix|refactor|test|docs|build|ci|perf|chore)\([a-z0-9][a-z0-9._/-]*\): [a-z0-9].{0,71}$
```

Praktisch heißt das:

- Typ aus genau dieser Liste, kein anderer.
- Scope in Kleinbuchstaben, ohne Leerzeichen (`arcade`, `ui`, `shared/contracts`).
- Nach `: ` beginnt die Beschreibung **kleingeschrieben** und ist höchstens **72 Zeichen** lang.
- Kein Punkt am Ende, Englisch, Gegenwartsform.

Beschreibe die Wirkung, nicht die Tätigkeit. „update code" sagt nichts; die Betreffe im Projekt lesen sich wie:

```
fix(trail): draw gap rolls from the seeded runtime rng
fix(arcade): spend the arcade health pool on collisions
feat(hangar): show the arcade progression and locked slots with a reason
```

## Schritt 4 — den Body schreiben

Der Body erklärt zwei Dinge, die aus dem Diff nicht hervorgehen: **warum** die Änderung nötig war und **womit** sie belegt ist. Wiederhole weder den Betreff noch das Diff. Bei rein trivialen Dokumentations- oder Konfigurationsänderungen darf der Body entfallen.

```
Why: <die gemeinsame Ursache, nicht das Symptom. Was war der alte Zustand,
warum war er falsch, und was folgt daraus für den Spieler oder die Runtime.
Wenn eine Nebenwirkung mitkam, steht sie hier.>

Tests: <was tatsächlich gelaufen ist, mit Namen. Wenn ein neuer Test vorher
rot war, nenne das ausdrücklich. Alt-Fehler in Clustern werden benannt, nicht
verschwiegen. Ein Beweis aus der laufenden App gehört hierher.>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Was diesen Body von einem beliebigen unterscheidet, sind Belege statt Behauptungen. Vergleiche:

Schwach: `Tests: alle Tests laufen durch.`

Stark, aus der Projekthistorie:

```
Tests: node --test tests/arcade-collision-health-pool.contract.test.mjs (red
before the change: one wall hit ended the run where five should), npm run
test:contract:fast, npm run lint, clusters core-runtime, gameplay-smoke and
physics-core at their known pre-existing failures. Desktop proof on
parcours_rift: health now runs 100, 78, 56, 34, 12, 0 over five wall hits
instead of ending on the first.
```

Der Unterschied ist nachprüfbar: die zweite Fassung kann jemand in einem Jahr wiederholen, die erste nicht.

Body und Betreff sind Englisch, auch wenn das Gespräch auf Deutsch läuft.

## Schritt 5 — committen

Übergib die Nachricht über ein Here-String, damit Zeilenumbrüche erhalten bleiben:

```bash
git commit -m @'
fix(arcade): spend the arcade health pool on collisions

Why: ...

Tests: ...

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
'@
```

Wenn der Hook den Betreff ablehnt, korrigiere den Betreff — schalte den Hook nicht ab und benutze `--no-verify` nicht.

## Was du nicht tust

- **Kein zweiter Commit** für dieselbe Aufgabe. Eine abgeschlossene Änderung ist genau ein Commit.
- **Kein `--amend`, `rebase` oder `squash`** an bestehenden Commits ohne ausdrücklichen Auftrag.
- **Kein Push**, solange der Nutzer ihn nicht verlangt.
- **Kein Aufräumen** von temporären Artefakten oder unversionierten Dateien nebenbei.

## Wenn du nicht committen kannst

Melde es in zwei Sätzen und nenne die konkrete Datei:

```
Kein Commit erstellt: src/ui/UIManager.js enthält neben meiner Änderung an der
Rundenanzeige noch deine Umbauten am Menü-Binding (Zeilen 210-260). Sag mir, ob
ich nur meinen Teil übernehmen soll — dann trenne ich ihn heraus.
```

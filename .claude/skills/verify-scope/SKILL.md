---
name: verify-scope
description: Bestimmt für geänderte Dateien in diesem Repo die verpflichtenden Prüfbefehle (Lint, Contract-Tests, Typecheck, Architektur-Checks, Playwright-Cluster, Builds) und führt sie in sinnvoller Reihenfolge aus. Nutze diesen Skill immer, bevor du einen Commit vorbereitest, und immer wenn gefragt wird "welche Tests muss ich laufen lassen", "was muss ich prüfen", "reicht das so", "kann ich committen" — und auch dann, wenn nur beiläufig eine Verifikation erwähnt wird oder du gerade eine Änderung an src, editor, electron, assets, dev/training oder .opencode abgeschlossen hast. Verhindert sowohl das langsame Pauschal-Gate npm run quality als auch vergessene Cluster.
---

# Prüfumfang bestimmen und ausführen

`AGENTS.md` Regel 8 verlangt vor jedem Commit „mindestens die kleinsten betroffenen Tests und den passenden Build". Die Zuordnungstabelle dafür steht in `CLAUDE.md`. Sie ist die **einzige** Regelmenge in diesem Projekt, die kein Werkzeug erzwingt: Schichtgrenzen, Ratchets und das Commit-Format brechen den Build von allein, die Testauswahl nicht. Deshalb wird sie hier abgeleitet statt jedes Mal neu erinnert.

Zwei Fehlerrichtungen sind gleichermaßen teuer. Zu wenig prüfen lässt Regressionen durch. Ersatzweise `npm run quality` laufen zu lassen kostet viele Minuten und trainiert an, das Gate zu überspringen, wenn es eilt.

## Schritt 1 — nur die eigenen Pfade sammeln

Der Arbeitsbaum trägt fast immer parallele Änderungen des Nutzers. `git status` ist deshalb eine Obergrenze, keine Antwort. Zähle die Dateien auf, die **du** in dieser Aufgabe angefasst hast, und übergib sie ausdrücklich:

```bash
node .claude/skills/verify-scope/scripts/select-verification.mjs src/modes/ArcadeModeStrategy.js tests/arcade-run.contract.test.mjs
```

Ohne Argumente liest das Skript `git status` und sagt selbst dazu, dass fremde Änderungen enthalten sein können. Das ist als Überblick brauchbar, als Commit-Vorbereitung nicht.

`--json` gibt dieselbe Auswahl maschinenlesbar aus, wenn du sie weiterverarbeiten willst.

## Schritt 2 — die drei Stufen abarbeiten

Die Ausgabe ist in drei Stufen geteilt. Die Trennlinie ist das **Playwright-Schloss** — eine Sperrdatei, die dafür sorgt, dass immer nur ein Playwright-Lauf gleichzeitig läuft, weil zwei Electron-Fenster auf derselben Grafikkarte sich gegenseitig verfälschen.

**Stufe 1 — immer, im Agenten, vor jedem Commit.** Der eigene Contract-Test, `npm run lint`, `npm run test:contract:fast`, dazu Typechecks und Architektur-Prüfungen. Nichts davon nimmt das Schloss, alles passt in eine Agentenrunde. **Stufe 1 muss grün sein, bevor du committest.**

**Stufe 2 — gezielte Test-IDs statt eines ganzen Clusters, Richtwert unter 10 Minuten.** Statt `core-surface` (67 Tests, 12–14 min, bricht an jedem alten Fehler ab) laufen vier bis sechs IDs des berührten Bereichs:

```bash
node scripts/run-playwright-targeted.mjs tests/core-targeted-surface.spec.js --grep "T20kb:|T20kc:|T20i:"
```

Das ist die Stufe, die deine Änderung wirklich belegt. Ein ganzer Cluster belegt vor allem, dass fremde Alt-Fehler noch da sind.

**Stufe 3 — ganze Cluster, nur in der Hauptsitzung.** Nie in einem Subagenten: ein Cluster braucht 20–40 Minuten, der Subagent verliert die Benachrichtigung seines Hintergrundlaufs und beendet sich. In der Hauptsitzung losgelöst starten (`Start-Process` mit UTF-8-Protokoll), immer mit `--skip-known`, und die Wartezeit hochsetzen:

```powershell
$env:CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS = '7200000'
node scripts/run-playwright-targeted-clusters.mjs core-surface --skip-known
```

Beleg ist die letzte Zeile des Laufs:

```
[playwright:summary] passed=61 failed=2 skipped=1 didNotRun=0 flaky=0 known=2 new=0
```

`didNotRun` ist die Zahl, die vorher niemand sah: Tests, die Playwright nach einem Abbruch der seriellen Kette nie gestartet hat. Steht dort nicht `didNotRun=0`, hat der Lauf über deinen Bereich schlicht nichts ausgesagt.

**Exit-Code 75** bedeutet: Schloss-Timeout, **kein Testfehler**. Eine andere Sitzung hielt die Maschine länger als die Wartezeit. Nicht als rot werten, nicht neu bauen — später erneut starten. Die dazugehörige Zeile lautet `[playwright:lock] LOCK_TIMEOUT holder=… pid=… waited=…s`.

Halte nach dem ersten echten Fehlschlag an, behebe ihn und starte ab dem fehlgeschlagenen Befehl erneut.

## Schritt 3 — Alt-Fehler benennen, nicht verschweigen

Mehrere Playwright-Cluster tragen Fehler, die es vor deiner Änderung schon gab. Sie stehen jetzt im Repo: `scripts/architecture/playwright-known-failures.json`. Jeder Eintrag nennt Spec, Testtitel, Datum, Ursache und Art; `--skip-known` blendet genau diese Tests aus, damit eine serielle Kette bis zum Ende läuft.

Ein roter Cluster ist deshalb **kein** automatischer Stopp — aber die Behauptung „bekannter Alt-Fehler" muss belegt sein. Der Blick in die Datei ist der erste Schritt, das Artefakt-Datum der zweite, `failure-baseline` (Gegenprobe gegen den unveränderten Stand) der dritte. Ohne einen dieser Belege gilt der Fehler als deiner.

## Auftrag an Subagenten

Wer Arbeit an einen Subagenten gibt, schreibt den Umfang hinein: **„bis Stufe 1 grün, kein Commit, keine Cluster."** Ein Subagent, der auf einen Clusterlauf wartet, liefert am Ende gar nichts.

## Was das Skript abbildet

Stufe 1 ist immer Lint plus `test:contract:fast` plus der eigene Test; die Tabelle nennt, was je Bereich dazukommt. Die IDs der Stufe 2 stehen als Tabelle im Skript (`SPEC_IDS`) und werden vom Contract-Test gegen die Spec-Dateien geprüft — eine ausgedachte ID fällt sofort auf.

| Bereich | Zusätzlich zu Lint und `test:contract:fast` |
| --- | --- |
| `src/shared/contracts/**` | `typecheck:contracts` |
| `src/shared/contracts/**`, `src/state/**`, `src/entities/systems/**`, `src/modes/**` | `test:contract:coverage` — die Untergrenzen stehen je Bereich in `scripts/architecture/coverage-ratchet.json` und liegen höher als die 70/60/60 in `CLAUDE.md` |
| `src/entities/**`, `src/state/**` | Cluster `physics-core`, `physics-hunt`, `physics-policy` |
| `src/network/**`, `src/application/session-runtime/**` | `check:architecture`, Cluster `network` |
| Renderer, `GLBMapLoader`, Map-Presets, `assets/maps/**` | `test:desktop:smoke`, Cluster `desktop-flows` |
| Parcours-Maps und -Routen | `check:parcours` |
| `src/ui/**` | Cluster `core-surface`, `desktop-flows` |
| `src/modes/**` | Cluster `core-runtime`, `gameplay-smoke` |
| `editor/**` | `check:architecture`, Cluster `editor` |
| `electron/**` | `build:app`, `test:contract:dist` (bei Paketdateien `app:package:verify`) |
| `dev/training/**` | `test:dev:training` und ein Build |
| `.opencode/**`, `scripts/council-*` | `council:validate` |
| `scripts/architecture/**`, Lint-/TS-Konfiguration | `quality` vollständig |

## Grenzen, an denen du selbst denken musst

Das Skript kennt Pfade, keine Absichten. Ergänze eigenständig:

- **Der Test, der deine Änderung eigentlich prüft.** Ein neuer oder angepasster Contract-Test gehört einzeln gestartet (`node --test tests/xyz.contract.test.mjs`), bevor die Sammelläufe kommen — das ist der schnellste Weg zu einer klaren Aussage.
- **Renderlast.** Wer Partikel, Shader oder Instancing anfasst, nimmt zusätzlich den Cluster `gpu-stress`; das Skript kann Last nicht aus Pfaden ablesen.
- **Verhalten, das kein Test sieht.** Wenn du Zahlen im Spiel geändert hast, die ein Spieler merkt, ergänze einen Beweis aus der laufenden App (`desktop-proof`). Grüne Tests sind kein Ersatz dafür.

## Ausgabe an den Nutzer

Berichte am Ende ehrlich in drei Zeilen: was lief, was grün war, was rot blieb und warum das vertretbar ist. Verschweige keinen übersprungenen Befehl — eine ausgelassene Prüfung zu nennen kostet nichts, eine verschwiegene kostet den nächsten Fehler.

Beispiel:

```
Geprüft: lint, test:contract:fast, typecheck:contracts, Cluster core-runtime und gameplay-smoke.
Grün bis auf gameplay-smoke: dort dieselben zwei Fehler wie auf HEAD ohne meine Änderung.
Nicht gelaufen: desktop-flows — meine Änderung berührt keine UI, nur die Modus-Strategie.
```

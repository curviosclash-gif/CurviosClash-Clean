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

## Schritt 2 — die Liste von oben nach unten abarbeiten

Die Ausgabe ist nach Kosten sortiert: Lint und die schnellen Contract-Tests zuerst, Playwright-Cluster und Builds zuletzt. Diese Reihenfolge ist Absicht — ein Lint-Fehler macht jeden nachgelagerten Cluster-Lauf wertlos, und drei Minuten Playwright zu verbrennen, um danach eine Zeile umzubrechen, ist verlorene Zeit.

Halte nach dem ersten echten Fehlschlag an, behebe ihn und starte die Liste erneut ab dem fehlgeschlagenen Befehl. Laufe nicht die ganze Liste durch, um am Ende eine Sammelmeldung zu haben.

## Schritt 3 — Alt-Fehler benennen, nicht verschweigen

Mehrere Playwright-Cluster tragen Fehler, die es vor deiner Änderung schon gab. Ein roter Cluster ist deshalb **kein** automatischer Stopp — aber die Behauptung „bekannter Alt-Fehler" muss belegt sein, sonst versteckt sie eine echte Regression.

Wenn ein Cluster rot ist und du nicht sicher bist, ob es an dir liegt: `failure-baseline` liefert den Vergleich gegen den unveränderten Stand. Ohne diesen Beleg gilt der Fehler als deiner.

## Was das Skript abbildet

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

---
name: perf-loop
description: Agenten-Schleife, die die Spielleistung (CPU- und GPU-Zeit pro Bild) Schritt für Schritt verbessert, ohne dass sich Bild oder Spielablauf ändern — profilieren, eine Hypothese mit vorab benannter Ziel-Kennzahl umsetzen, Basis gegen Kandidat im echten Desktop-Spiel messen, ein Skript urteilen lassen, annehmen oder verwerfen. Nutze diesen Skill bei "Performance verbessern", "schneller machen", "FPS erhöhen", "Ruckler weg", "Perf-Loop", "/loop /perf-loop" und immer, wenn eine Optimierung als gleichwertig in der Qualität belegt werden soll.
---

# Leistungs-Loop: schneller bei gleicher Qualität

Eine Runde dieses Loops prüft **genau eine** Optimierungsidee. Sie endet mit einem Urteil von `scripts/perf-loop-judge.mjs`, nicht mit deiner Einschätzung. Das Skript entscheidet nach festen Regeln; du darfst es weder überstimmen noch so lange neu messen, bis es dir passt.

**Qualität heißt hier streng: pixelgleich.** Das hat der Nutzer am 12.10.2026 so festgelegt. Bei festem Startwert (Seed) müssen drei Testbilder je Karte Bit für Bit gleich sein. Außerdem muss die Simulation (Positionen, Leben, Punkte) exakt gleich ablaufen. Eine Idee, die das Bild auch nur minimal verändert, ist verworfen, auch wenn niemand den Unterschied sehen würde.

**Der Loop committet, er mergt nicht.** Eine angenommene Verbesserung landet als ein Commit auf einem eigenen Branch und wird als „bereit für den Sammellauf“ gemeldet. Merge nach `main` und Push macht der Nutzer oder die Hauptsitzung.

## Werkzeuge

| Befehl | Zweck |
| --- | --- |
| `node scripts/perf-loop.mjs profile --dir <worktree>` | Zeigt, wo die Zeit hingeht: CPU-Selbstzeit je Funktion, Subsysteme (Kollision, Bot-Wahrnehmung, Render …), GPU-Zeit, Draw Calls |
| `node scripts/perf-loop.mjs measure --baseline <dir> --candidate <dir> --target <kennzahl> --label <slug>` | Baut beide Stände, misst sie abwechselnd und fällt das Urteil |
| `node scripts/perf-loop.mjs ledger` | Liste aller bisher gemessenen Ideen mit Ziel und Urteil |
| `node scripts/perf-loop.mjs judge <run-dir>` | Urteil über einen vorhandenen Messordner neu ausgeben |

Die Messung macht `tests/perf-loop-probe.desktop.spec.js` im echten Electron-Fenster. Die Sonde läuft auf HIGH-Qualität bei 1920×1080, im Kampfmodus mit 4 Bots, auf `standard`, `cherry_grove` und `dandelion_sky`. Die Phase „Qualität“ läuft auf einer künstlichen Uhr und zeichnet pro Simulationsschritt genau ein Bild. Deshalb sind ihre Bild-Prüfsummen (Hashes) unabhängig davon, wie schnell der Rechner gerade ist. Die Phase „Zeit“ läuft in Echtzeit und misst die Kosten.

Ziel-Kennzahlen (`--target`):

| Kennzahl | Bedeutung | passt zu |
| --- | --- | --- |
| `cpuUpdate` | Median der Simulationszeit pro Bild | Kollision, Bots, Spielregeln |
| `cpuRender` | Median der CPU-Zeit für das Zeichnen | Szenengraph, Uploads, Effekte auf der CPU |
| `gpu` | Median der Grafikkarten-Zeit pro Bild | Shader, Überzeichnung, Draw Calls |
| `cpu` | Mittelwert Update + Render | nur, wenn beides gleichzeitig sinken soll |

Belege und Ledger liegen außerhalb des Repos unter `%LOCALAPPDATA%\Temp\curvios-perf-loop\` (`AGENTS.md` Regel 10). Exit-Codes von `measure`: `0` angenommen, `3` verworfen, `2` Messung ungültig, `75` Playwright-Schloss belegt, `1` Fehler.

## Ablauf einer Runde

### 0. Lage prüfen

- `git worktree list` und Playwright-Schloss prüfen (`AGENTS.md` Regel 17). Eine Leistungsmessung unter Fremdlast ist wertlos (Regel 16). Läuft gerade ein fremder Electron-Lauf oder eine Bot-Validierung, warte, statt zu messen.
- `node scripts/perf-loop.mjs ledger` lesen. Eine bereits verworfene Idee kommt nur mit einem erkennbar anderen Ansatz wieder.

### 1. Basis bereitstellen

Die Basis ist ein Worktree auf dem aktuellen `main`, ohne eigene Änderungen:

```bash
git worktree add --detach .claude/worktrees/perf-loop-baseline main
```

Existiert er schon, setze ihn mit `git -C .claude/worktrees/perf-loop-baseline checkout --detach main` auf den neuen Stand. Lege in jedem neuen Worktree die `node_modules`-Junctions für das Wurzelverzeichnis und `electron/` an. Entferne sie vor dem Abbau wieder (Skill `worktree-cleanup`).

### 2. Profilieren

```bash
node scripts/perf-loop.mjs profile --dir .claude/worktrees/perf-loop-baseline
```

Lies zuerst, **was** begrenzt. Ist die GPU-Zeit größer als die CPU-Zeit, wartet die CPU auf die Grafikkarte. Dann bringen CPU-Gewinne auf diesem Rechner keine Bilder pro Sekunde, wohl aber auf Rechnern mit starker GPU. Beides zählt als Gewinn, solange das andere nicht schlechter wird. Die Funktionsnamen stammen aus dem verkleinerten Build. Methodennamen bleiben erhalten; such sie mit Grep in `src/`.

### 3. Eine Hypothese wählen

Eine Idee pro Runde, klein und begründet, **mit der Kennzahl, die sinken soll**: „`checkGlobalCollision` prüft jedes Segment gegen alle Kugeln; eine Hüllbox-Vorprüfung mit identischem Ergebnis senkt `cpuUpdate`“. Das Ziel steht fest, bevor gemessen wird. Wer alle Kennzahlen prüft und die beste nimmt, findet durch Zufall fast immer eine.

Erlaubt sind Änderungen, die das Ergebnis **per Konstruktion** nicht verändern:

- Allokationen in Update- und Render-Schleifen entfernen (`AGENTS.md` Regel 7)
- Zwischenergebnisse wiederverwenden statt neu rechnen
- Vorprüfungen, die nur sicher irrelevante Fälle aussortieren
- GPU-Uploads auf den geänderten Bereich begrenzen (Vorbild: `72f74447`, Partikel- und Blatt-Uploads)
- unnötige `needsUpdate`, doppelte Zustandswechsel oder Draw Calls ohne sichtbare Wirkung entfernen

Verboten, auch wenn die Sonde es nicht bemerken würde:

- Qualitätsstufen, Auflösung, Schatten, Bloom, Detailstufen (LOD), Partikelzahlen oder Sichtweiten senken
- die automatische Qualitätsregelung oder ihre Schwellen ändern (die Sonde sperrt sie auf HIGH und sähe das nicht)
- Tick-Rate, Physik, Bot-Entscheidungen, Netzwerk oder Speicherformate ändern
- die Messdateien ändern: Sonde, `tests/helpers*.js`, `scripts/perf-loop*.mjs`. `measure` bricht dann mit „candidate changes measurement files“ ab

Die Sonde sieht nur HIGH, nur den Kampfmodus und nur drei Karten. Betrifft eine Änderung auch andere Stufen, Modi oder Karten, muss sie dort ebenfalls per Konstruktion bildneutral sein. Schreibe die Begründung in den Commit-Body.

### 4. Umsetzen

Eigener Worktree `.claude/worktrees/perf-<slug>` auf Branch `claude/perf-<slug>-<JJJJMMTT>` von `main`. Ändert die Idee Logik (Vorprüfung, Cache), kommt zuerst ein Contract-Test, der alte und neue Rechnung auf denselben Eingaben vergleicht (Skill `red-first-fix`). Dann **Stufe 1** nach Skill `verify-scope`: eigener Test, `npm run lint`, `npm run test:contract:fast` und die Prüfungen aus der Tabelle in `CLAUDE.md`. Ohne grüne Stufe 1 wird nicht gemessen, und während der Messung läuft nichts anderes Rechenintensives.

### 5. Messen

```bash
node scripts/perf-loop.mjs measure --baseline .claude/worktrees/perf-loop-baseline --candidate .claude/worktrees/perf-<slug> --target cpuUpdate --label <slug>
```

Eine Messung besteht aus zwei Runden Basis–Kandidat–Kandidat–Basis über drei Karten, dauert rund 50 Minuten und hält das Playwright-Schloss je App-Start. Starte sie im Hintergrund und warte auf die Meldung, statt abzufragen. Pro Kandidat gilt **eine** Messung. Nur nach `2` (ungültig) oder `75` (Schloss belegt) wird wiederholt. Liegt der Gewinn knapp unter der Schwelle, ist das ein Nein und kein Grund, nochmal zu würfeln.

So urteilt das Skript: Die Rechnergeschwindigkeit driftet, solange andere Sitzungen arbeiten (am 12.10.2026 schwankte die Update-Zeit derselben Version zwischen 10 und 17 ms). Deshalb vergleicht es jeden Kandidaten-Lauf mit dem direkt benachbarten Basis-Lauf; zwei Runden ergeben vier Paare. Die Ziel-Kennzahl gilt als besser, wenn sie im Mittel der Paare um mindestens 3 % und mindestens eine Standardabweichung der Paare sinkt **und jedes Paar** das zeigt. Jede Kennzahl, auch eine fremde, gilt als schlechter ab 5 %, wenn alle Paare das zeigen; dann wird verworfen.

Kalibriert am 12.10.2026: Die gleiche Version gegen sich selbst wurde abgelehnt. Eine Basis mit künstlicher, bildneutraler Zusatzarbeit beim Zeichnen (rund 0,6 ms) wurde mit `--target cpuRender` als +18 % erkannt, in allen vier Paaren. Staubpunkte, die 0,01 Einheiten größer waren, wurden als Qualitätsänderung abgelehnt.

### 6. Urteil umsetzen

- **`accept` (0):** Stufe 2 für die berührten Bereiche (`select-verification.mjs <deine-dateien>`). Dann genau ein Commit nach Skill `atomic-commit`, Typ `perf(<scope>)`, mit `Why:`, `Tests:` und der Messzeile aus der Ausgabe, z. B. `Perf loop: cpuUpdate 26.5 -> 24.1 ms (+9.1 %, required +3.0 %, 4/4 pairs), no metric worse, pixels and simulation identical on standard, cherry_grove, dandelion_sky.` Den Worktree behalten und als „bereit für den Sammellauf“ melden.
- **`reject-quality` / `reject-perf` (3):** Sichere die Idee vor dem Abbau als Patch in den Belegordner (`git -C <worktree> diff > <evidence>\candidate.patch`). Danach Worktree und Branch abbauen (Skill `worktree-cleanup`). Bei `reject-quality` nennt das Urteil die geänderten Bildkacheln (16×9 Raster) und Ticks. Das hilft beim nächsten Versuch.
- **`invalid` (2):** Die Messung selbst taugt nicht, etwa weil die Basis zwischen zwei Starts nicht gleich gerechnet hat oder der Lauf das Schloss verloren hat. Prüfe mit einem A/A-Lauf (`--baseline` und `--candidate` auf denselben Basis-Worktree, `--skip-build`), ob die Sonde auf dem aktuellen `main` deterministisch ist. Schwellen und Sonde werden nicht im Loop „repariert“. Das ist eine eigene Aufgabe mit eigenem Test.
- **`75`:** Eine andere Sitzung misst gerade. Später erneut starten; das ist kein Ergebnis.

### Wenn die Sonde selbst nicht deterministisch ist

`PW_PERF_PROBE_DUMP=<ordner>` speichert die Rohbilder (`<karte>-<tick>[-priming]-1920x1080.rgba`, Ursprung unten links) und eine Kameraspur. Ein Pixelvergleich zweier App-Starts zeigt das Muster: Leuchten im Differenzbild nur Kanten, hat sich die Kamera verschoben. Weichen ganze Flächen ab, ist der Inhalt anders. Weichen nur ein, zwei Kacheln gelegentlich ab, lädt etwas asynchron. `quality.priming` im Bericht enthält die Prüfsummen des Vorlaufs.

Fünf Quellen hat die Sonde schon ausgeschaltet; eine neue Abweichung hat also eine neue Ursache:

1. Zufall beim Hochfahren und beim Kartenbau (z. B. die 200 Staubpunkte aus `ArenaBuilder.compileParticleStage`): `Math.random` ist ab dem ersten Skript und erneut vor der Kartenwahl festgelegt.
2. Absolute Zeit (Kamerawackeln in `CameraShakeSolver` liest `performance.now()`): Die künstliche Uhr startet bei einem festen Wert, nicht bei der echten Laufzeit der App.
3. Der geglättete Bildzeitschritt der Spielschleife (`renderTiming.stabilizedDt`, gelesen in `PlayingStateSystem.render`): Die Sonde setzt ihn vor jedem Bild und meldet beim ersten Bild einer Phase einen Reset, sonst erbt die Kamera den letzten echten Frame.
4. Modelle, die beim ersten Gebrauch asynchron laden (Fahrzeuge in `PlayerView`, Power-ups über `PowerupVisualCatalog`): Ein gleicher Vorlauf füllt die Zwischenspeicher, gewertet wird erst der zweite Durchgang.
5. Ladevorgänge, die über das Ende eines Durchgangs hinaus laufen: Vor jedem Durchgang wartet die Sonde, bis 1,5 s lang keine Datei mehr fertig geladen wurde.

## Den Loop steuern

Mit `/loop /perf-loop` läuft eine Runde nach der anderen; ohne Intervall bestimmt der Agent das Tempo selbst. Zwischen Runden immer vom aktuellen `main` neu ansetzen, nicht auf unverschmolzenen Kandidaten stapeln. Halte an und berichte, wenn

- fünf Runden hintereinander verworfen wurden (die leicht erreichbaren Gewinne sind dann gehoben),
- acht Runden in dieser Sitzung gelaufen sind,
- eine Messung zweimal `invalid` war,
- oder der Nutzer etwas anderes verlangt.

Der Abschlussbericht ist eine kurze Tabelle aus `ledger`: Idee, Ziel, Urteil, Gewinn, Branch für die angenommenen. Dazu kommt ein Satz, was auf diesem Rechner begrenzt (CPU oder GPU).

## Lernschleife

Prüfe vor jeder Schlussantwort die vorhandenen Belege auf eine wiederverwendbare Verbesserung, auch nach erfolgreicher QA oder abgebrochener Arbeit. Signale sind ein `invalid`-Urteil, eine Sonde, die eine sichtbare Änderung nicht bemerkt hat, ein Profil, das auf die falsche Stelle zeigte, oder eine Nutzerkorrektur.

- Übernimm nur eine verstandene Ursache mit am betroffenen Fall verifizierter Abhilfe, die künftige Runden betrifft. Einzelfälle und Vermutungen erzeugen keine neue Regel.
- Verbessere die kleinste zuständige Stelle: Messung in `tests/perf-loop-probe.desktop.spec.js`, Urteilsregel in `scripts/perf-loop-judge.mjs` mit `tests/perf-loop-judge.contract.test.mjs`, Ablauf und Verbote hier. Eine Änderung an Sonde oder Schiedsrichter ist eine eigene Aufgabe mit A/A-Lauf und Kontrollen als Beleg, nie Teil eines Kandidaten.
- Schwellen werden nur strenger oder bleiben gleich, außer der Nutzer verlangt es ausdrücklich anders.

Bewahre Auslöser, Geltungsbereich, Abhilfe und Prüfkriterium in der zuständigen Regel oder Prüfung; keine Fehlerchronik und keine neuen Prozessberichte im Repo. Nenne abschließend knapp das Ergebnis der Lernprüfung: keine neue Lehre, bereits abgedeckt, verbessert mit Prüfergebnis oder ausstehend.

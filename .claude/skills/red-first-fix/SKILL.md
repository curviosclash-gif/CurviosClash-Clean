---
name: red-first-fix
description: Behebt Fehler in diesem Repo mit Rot-Beweis — erst den vollständigen betroffenen Ablauf verstehen, dann einen Contract-Test schreiben, der vor der Korrektur nachweislich fehlschlägt, dann die kleinste Änderung an der gemeinsamen Ursache. Nutze diesen Skill immer wenn etwas nicht funktioniert, falsch berechnet wird, abstürzt, hängt, nicht gespeichert wird oder sich anders verhält als erwartet, und auch bei Formulierungen wie "warum macht das Spiel X", "der Bot fährt in die Wand", "die Einstellung geht verloren", "das kommt nicht an". Verhindert Symptomkuren und Tests, die auch vor der Korrektur grün gewesen wären.
---

# Fehler beheben mit Rot-Beweis

Die Commit-Historie dieses Projekts besteht zu zwei Dritteln aus `fix`. Die guten dieser Commits haben eine Eigenschaft gemeinsam: sie können belegen, dass der Test vor der Korrektur fehlgeschlagen ist. Diese Reihenfolge ist der ganze Punkt. Ein Test, der nach der Korrektur geschrieben wird, prüft meistens genau das, was der Code jetzt tut — er hätte den Fehler nie gefunden und wird ihn auch beim nächsten Mal nicht finden.

## Schritt 0 — prüfen, ob es den Fehler überhaupt noch gibt

Bevor du irgendetwas verstehst, kläre, ob der Fehler im aktuellen Stand noch auftritt. Fehlermeldungen sind oft älter als der Code: eine Beobachtung aus der letzten Woche, ein anderer Branch, ein schon behobener Fall.

```bash
git log --oneline -20 -- <die vermutlich betroffene Datei>
```

Wenn ein Commit die Ursache bereits benennt, prüfe die Stelle im Code nach, bevor du weitersuchst. Fällt auf, dass der Fehler behoben ist, sag genau das — mit dem Commit als Beleg — statt eine Korrektur für einen Zustand zu bauen, den es nicht mehr gibt. Das kostet eine Minute und spart im Zweifel eine Stunde.

Passt die Beschreibung des Nutzers nicht zum Arbeitsbaum (genannte Dateien unverändert, genannte Testdatei existiert nicht), sag das ebenfalls sofort, statt die Abweichung stillschweigend zu überbrücken.

## Schritt 1 — den ganzen Ablauf verstehen, bevor du etwas änderst

`AGENTS.md` Regel 19 verlangt das ausdrücklich, und in dieser Codebasis ist es keine Förmlichkeit: die Schichten sind echt getrennt, und ein Symptom in der UI hat seine Ursache regelmäßig drei Schichten tiefer.

Verfolge den Weg vom Auslöser bis zum Symptom und schreibe ihn dir auf:

- Wo entsteht der Wert? (Eingabe, Contract-Normalisierer, Persistenz)
- Wer verändert ihn? (Runtime-System, Modus-Strategie, Kollisionsauflösung)
- Wo wird er sichtbar? (HUD, Menü, Netzwerkpaket)

Zwei Fragen entscheiden über die Qualität der Korrektur:

- **Gibt es eine zweite Stelle mit demselben Fehler?** Wenn ein Vorzeichen, eine Standardwert-Liste oder eine Umrechnung an mehreren Orten steht, ist die Ursache die Duplikation, nicht die eine falsche Zeile. Ein Beispiel aus der Historie: die Bounce-Normalen für die Z-Wände waren gegenüber `ArenaCollision.getCollisionInfo` vertauscht — die Korrektur war nicht das Umdrehen zweier Vorzeichen, sondern eine gemeinsame reine Funktion, gegen die sich die Konvention testen lässt.
- **Warum ist es niemandem aufgefallen?** Meist, weil die Stelle keinen Test hatte, den man ohne halbes Spiel starten kann. Genau das behebst du in Schritt 2 mit.

Erkläre die Ursache in ein bis zwei Sätzen, bevor du Code änderst. Wenn das nicht gelingt, hast du das Symptom gefunden, nicht die Ursache.

## Schritt 2 — den Test schreiben, der rot ist

Contract-Tests (`tests/*.contract.test.mjs`) laufen im Node-Testrunner ohne Browser und ohne Build. Sie werden allein über das Namensschema eingesammelt — eine neue Datei in `tests/` genügt, es gibt nichts zu registrieren.

Suche die **tiefste Ebene, auf der der Fehler noch sichtbar ist**. Je tiefer, desto schneller läuft der Test und desto genauer benennt er die Ursache. Wenn eine Modus-Strategie falsch rechnet, teste die Strategie — nicht das Menü, das sie startet.

Die Hausform sieht so aus: kleine Stellvertreter-Objekte statt echter Spielobjekte, mit einem Kommentar, der erklärt, **warum** der Stellvertreter so gebaut ist, und Zusicherungen, deren Meldungen sich wie Sätze lesen.

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';

/**
 * Steht für Player: takeDamage delegiert an HealthSystem, genau wie Player.js.
 * Dieser Altpfad kennt nur Hunt und Classic und meldet in Arcade sofortigen Tod —
 * worauf die Arcade-Kollisionsbehandlung gerade nicht bauen darf.
 */
function createPlayer(strategy) { /* ... */ }

test('a wall hit costs health instead of ending the run at once', () => {
    // ...
    assert.equal(died, false, 'one wall hit does not end the run');
});
```

Teste das **beobachtbare Verhalten**, nicht die interne Umsetzung. „Ein Wandtreffer kostet Leben, statt den Lauf zu beenden" bleibt gültig, wenn die Kollisionsauflösung umgebaut wird. „`resolveCollisionDamage` wird einmal aufgerufen" bricht beim ersten Refactoring und schützt vor nichts.

Wenn der Fehler auf Contract-Ebene nicht erreichbar ist — Rendering, echtes DOM, Electron-Fenster — ist ein Playwright-Spec der richtige Ort, und zusätzlich ein Beweis aus der laufenden App (`desktop-proof`). Weiche nicht auf einen Contract-Test aus, der etwas anderes prüft, nur weil er schneller zu schreiben ist.

## Schritt 3 — Rot belegen und den Text aufheben

```bash
node --test tests/arcade-collision-health-pool.contract.test.mjs
```

Der Test **muss** jetzt fehlschlagen, und zwar aus dem erwarteten Grund. Schlägt er aus einem anderen Grund fehl (Tippfehler im Import, falscher Stellvertreter), hast du keinen Beweis, sondern einen kaputten Test.

Halte die entscheidende Zeile der Ausgabe fest — sie geht später wörtlich in den Commit-Body. Nicht „der Test war rot", sondern:

```
one wall hit ended the run where five should
```

**Falls du die Korrektur schon geschrieben hast**, bevor der Test stand: du kannst den Beweis nachholen, ohne den Arbeitsbaum zu gefährden. Lege deine Korrektur beiseite, lass den Test laufen, hole sie zurück:

```bash
git stash push -- src/modes/ArcadeModeStrategy.js
```

```bash
node --test tests/arcade-collision-health-pool.contract.test.mjs
```

```bash
git stash pop
```

Beachte: `git stash` fasst nur die genannten Dateien an, aber der Arbeitsbaum trägt fremde Änderungen — nenne die Pfade deshalb immer ausdrücklich und nie pauschal.

## Schritt 4 — die kleinste tragfähige Korrektur

Reihenfolge der Mittel: nichts tun, was nicht nötig ist (YAGNI); vorhandenes wiederverwenden; Standardbibliothek; native Plattformfunktion; bereits installierte Abhängigkeit. Neue Abhängigkeiten sind der letzte Ausweg, nicht der erste Griff.

Korrigiere an der gemeinsamen Ursache. Wenn dieselbe falsche Annahme an drei Stellen steht, ist eine gemeinsame reine Funktion die Korrektur, nicht drei Einzelkorrekturen.

Vereinfache dabei **niemals** Validierung, Schutz vor Datenverlust, Sicherheit, Barrierefreiheit oder ausdrücklich verlangtes Verhalten — auch nicht, wenn es den Test grün machen würde.

Achte auf die erzwungenen Grenzen, während du schreibst: 500 Zeilen je Datei, kein `innerHTML`, kein DOM außerhalb `src/ui`, keine Importe von `ui` nach `core`. Der PostToolUse-Hook lintet die geänderte Datei sofort; wenn er meckert, ist `boundary-fix` der Weg.

## Schritt 5 — Grün belegen und den Umfang prüfen

Erst der eine Test, dann der Rest:

```bash
node --test tests/arcade-collision-health-pool.contract.test.mjs
```

Danach `verify-scope` für die geänderten Pfade. Ein grüner Einzeltest neben einem roten Cluster ist keine fertige Korrektur.

## Schritt 6 — den Beweis weiterreichen

Der Rot-Text aus Schritt 3 gehört in die `Tests:`-Zeile des Commits, die Ursache aus Schritt 1 in die `Why:`-Zeile. `atomic-commit` übernimmt von hier.

## Woran du merkst, dass es noch nicht fertig ist

- Du kannst nicht sagen, warum der Fehler entstanden ist — nur, dass er weg ist.
- Der Test war vor der Korrektur nie rot.
- Der Test prüft eine Methode, die es nach dem nächsten Umbau nicht mehr gibt.
- Du hast eine Prüfung entfernt, damit etwas durchläuft.

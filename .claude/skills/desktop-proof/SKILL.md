---
name: desktop-proof
description: Belegt eine Änderung in der laufenden Anwendung mit konkreten Zahlen statt nur mit grünen Tests — wählt den günstigsten Weg (Headless-Smoke, Playwright-Desktop-Spec, Browser-Vorschau oder manueller Lauf) und formuliert den Beleg für den Commit-Body. Nutze diesen Skill wenn eine Änderung spürbares Spielverhalten betrifft (Leben, Schaden, Geschwindigkeit, Fortschritt, Punkte, Speichern, Menüzustand, HUD), wenn gefragt wird "funktioniert das wirklich", "sieht man das im Spiel", "starte mal die App", "zeig mir dass es geht", und immer bevor du in einem Commit-Body von "Desktop proof" sprechen willst.
---

# Beweis aus der laufenden Anwendung

Grüne Tests belegen, dass der Code das tut, was der Test erwartet. Sie belegen nicht, dass ein Spieler etwas anderes sieht als vorher. Genau diese Lücke schließt der Beleg, den die Commits dieses Projekts „Desktop proof" nennen:

```
Desktop proof on parcours_rift: health now runs 100, 78, 56, 34, 12, 0 over five
wall hits instead of ending on the first.
```

Was diesen Satz brauchbar macht, sind vier Dinge: ein benanntes Szenario, konkrete Zahlen, der Vorher-Zustand daneben, und genug Angaben, dass jemand es wiederholen kann. „Funktioniert im Spiel" hat keines davon.

Desktop (Electron) ist die Leitplattform. Ein Beleg aus dem Browser ist etwas wert, aber er heißt dann auch „Browser proof".

## Schritt 1 — den günstigsten Weg wählen

Nimm die erste Zeile, auf die dein Fall zutrifft. Jede Stufe kostet spürbar mehr Zeit als die darüber.

| Was du belegen willst | Weg |
| --- | --- |
| Zahlen aus Runtime, Kernel, Rundenlogik, Fortschritt | Headless-Smoke in Node |
| Verhalten im echten Fenster, mehrere Fenster, IPC, Persistenz über Neustart | Playwright-Desktop-Spec |
| Menü, HUD, Einstellungen, Layout — schnell und plattformunkritisch | Browser-Vorschau |
| Alles, was nur ein Mensch beurteilen kann (Gefühl, Kamera, Optik) | Manueller Lauf, Nutzer berichtet |

## Weg A — Headless-Smoke

Am schnellsten und ohne Fenster. Vorhandene Einstiege:

```bash
npm run smoke:headless-kernel
```

```bash
npm run smoke:arcade
```

```bash
npm run smoke:roundstate
```

Wenn keiner davon passt, schreibe ein kurzes Node-Skript, das die echten Module importiert und die Zahlen ausgibt, die du behaupten willst. Lege es **außerhalb des Repos** ab (`$env:TEMP`), damit kein Wegwerf-Skript im Arbeitsbaum landet — `AGENTS.md` verbietet generierte Prozessberichte im Repo. Wenn sich zeigt, dass der Beleg dauerhaft wertvoll ist, wird daraus ein Contract-Test in `tests/`, kein Skript.

## Weg B — Playwright-Desktop-Spec

Die `*.desktop.spec.js`-Tests starten die echte Electron-Anwendung. Über die Fixture aus `tests/helpers.desktop.js` bekommst du `page` (Hauptfenster) und `electronApp` (Anwendung, weitere Fenster):

```js
import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame } from './helpers.js';

test('...', async ({ page, electronApp }) => {
    await waitForLoadedGame(page);
    // ...
});
```

Einen einzelnen Spec startest du gezielt:

```bash
node scripts/run-playwright-targeted.mjs tests/hangar-window.desktop.spec.js
```

Wenn der Beleg bleiben soll, wird der Spec ein regulärer Test — und muss dann in `scripts/playwright-test-clusters.mjs` in einem Cluster registriert werden, sonst läuft er in CI nie. Ein Spec, der nur für diesen einen Beleg existiert, gehört nicht dauerhaft ins Repo; frage den Nutzer, ob er ihn behalten will, bevor du ihn wieder entfernst.

## Weg C — Browser-Vorschau

Für Menü, Einstellungen und HUD reicht der Renderer im Browser und ist deutlich schneller als ein Electron-Start.

```bash
npm run dev
```

Danach die Vorschau öffnen und die Oberfläche über den Barrierefreiheits-Baum lesen statt über Bildschirmfotos — das ist genauer und billiger. Sag im Commit-Body ausdrücklich, dass der Beleg aus dem Browser stammt.

## Weg D — manueller Lauf

Wenn nur ein Mensch beurteilen kann, ob es stimmt:

```bash
npm run app:start
```

Beschreibe dem Nutzer **genau** und in wenigen Schritten, was er tun und worauf er achten soll — welcher Modus, welche Karte, welche Anzeige, welche Zahl. Warte auf seine Beobachtung und übernimm sie wörtlich in den Commit-Body. Erfinde keinen Beleg, den du nicht gesehen hast; ein fehlender Desktop-Beweis ist ehrlich, ein erfundener ist wertlos.

## Schritt 2 — den Vorher-Zustand mitnehmen

Ein Beleg ohne Vergleichswert ist halb so viel wert. Zwei Wege dorthin:

- Den Zustand **vor** der Änderung aufnehmen, solange du ihn noch hast.
- Oder deine Dateien kurz beiseitelegen (`git stash push -- <deine pfade>`, danach zwingend `git stash pop`) und die Messung wiederholen. Nie pauschal stashen — der Arbeitsbaum trägt fremde Änderungen des Nutzers.

## Schritt 3 — den Satz formulieren

Baue ihn aus vier Teilen: Weg, Szenario, Nachher, Vorher.

```
Desktop proof across three separate app starts: 430 xp earned in the parcours,
2710 xp and level 9 after further runs, 2610 points left after a 100 point stone
purchase, and a fresh start spawning at 118 health instead of 100.
```

```
Desktop proof: sector count 8 and the daily challenge flag written through the
real save path were still in storage after a full restart, and the run used
eight sectors instead of five.
```

Beides sind echte Beispiele aus der Historie dieses Projekts. Der Satz gehört in die `Tests:`-Zeile des Commits; `atomic-commit` übernimmt von dort.

## Woran ein Beleg scheitert

- Er nennt keine Zahl, sondern ein Gefühl.
- Er nennt keinen Vorher-Wert, also bleibt offen, ob sich überhaupt etwas geändert hat.
- Er beschreibt, was der Code tut, statt was auf dem Bildschirm passiert — das ist ein Test, kein Beleg.
- Er stammt aus dem Browser, wird aber als Desktop-Beweis verkauft.

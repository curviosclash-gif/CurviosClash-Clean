---
name: desktop-proof
description: Belegt eine Änderung in der laufenden Anwendung mit konkreten Zahlen statt nur mit grünen Tests — wählt den günstigsten Weg (Headless-Smoke, Playwright-Desktop-Spec, Browser-Vorschau oder manueller Lauf) und formuliert den Beleg für den Ergebnisbericht. Nutze diesen Skill wenn eine Änderung spürbares Spielverhalten betrifft (Leben, Schaden, Geschwindigkeit, Fortschritt, Punkte, Speichern, Menüzustand, HUD), wenn gefragt wird "funktioniert das wirklich", "sieht man das im Spiel", "starte mal die App", "zeig mir dass es geht", und immer bevor du "Desktop proof" als belegt meldest.
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
| Eine Neuerung selbst anspielen und Schritt für Schritt erkunden (Karte, Waffe, Menüweg) | MCP-Tool `curvios_playtest` (Weg B2) |
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

## Weg B2 — selbst spielen mit dem MCP-Tool `curvios_playtest`

Ein einziges MCP-Tool steuert die echte Desktop-App aus `dist-app-test`: isolierte Sitzung (eigener Laufordner, eigenes Profil, umgeleitete Download-/Video-/Temp-Ordner), verborgener Start, Runden als Automation markiert. `.mcp.json` (Claude) und `.codex/config.toml` (Codex) verweisen auf den Hauptcheckout.

```bash
npm run build:app:test
```

Der Parameter `operation` wählt die Funktion:

| Operation | Wofür |
| --- | --- |
| `catalog` | Karten, Fahrzeuge, Pilot-Modi, Aktionen, Testhilfen, Szenarien |
| `open` | Sitzung starten: `layout` `single`, `lan` (Host + Gast) oder `with-settings-studio`; meldet `busy` (mit Schlossinhaber und Wartenden), wenn ein anderer Lauf das Schloss hält; mit `queue: true` behält es den Platz in der Warteschlange und öffnet als Auftrag; `blocked`, wenn der Build älter als die Quellen ist |
| `observe` | `include`: `screen` (Bild), `ui` (bedienbare Elemente mit Selektor), `state` (Schiff, Gegner relativ zur Nase, Parcours, Arcade, Punkte, benannter Sensorvektor), `events`, `errors`, `windows`, `metrics`, `pilot` |
| `act` | Maus, Tastatur, Formulare (`click`, `fill`, `press`, `key_down` …), `pause`/`resume`/`step`, `show_windows`/`hide_windows`, Dialogantworten, `helper` (Testhilfe) |
| `pilot` | `maneuver` (`turn`, `climb`, `roll`, `boost`, `fireMG`, `fireRocket`, `ms`) oder Zielflug mit laufender Kurskorrektur: `waypoints`, `parcours`, `pursue`, `combat`, `pickup`, `bot`; Ziele ändern mit `update: true` |
| `scenario` | festen Ablauf als Auftrag starten (Flugabnahme, Menü/Pause, Hangar, Editor, Aufnahme, Splitscreen, LAN, alle Karten, Fehlerfälle, Eingabewege) |
| `job` | Fortschritt abfragen oder mit `cancel: true` abbrechen |
| `close` | eigene Sitzung schließen, Schloss freigeben |

Eine typische Entscheidungsschleife: `act` mit `helper: start_match` und `helperArgs: { map, mode, paused: true }`, dann `observe`, dann `pilot` mit `mode: maneuver`, dann wieder `observe`. Im Pausenzustand läuft das Spiel genau `ms` Spielzeit weiter.

Der Pilot ist ein virtuelles Eingabegerät: Er antwortet dort, wo die Tastatur dieses Spielers abgefragt wird, also auch im Splitscreen und über die reguläre LAN-Weiterleitung des Gasts. Positionen, Treffer und Checkpoints berechnet weiter das Spiel. Belege, die nur mit dem Piloten entstanden sind, nennst du so; der Weg über echte Tasten und Mausklicks ist das Szenario `input_paths`.

Testhilfen (`start_match`, `give_item`, `teleport`, `god_mode`, `set_setting`, `open_tuning`) und beantwortete Dateidialoge stehen in jedem Ergebnis unter `interventions`. Was du so ausgelöst statt gespielt hast, nennst du im Beleg ausdrücklich. Gefundene Spielfehler meldest du getrennt von Werkzeugproblemen; Szenarien führen sie unter `gameBugs` mit Karte und Seed.

Das Windows-Symbol im Infobereich zeigt oder verbirgt die Testfenster ohne Neustart und bietet „Test beenden“. Nach 10 Minuten ohne Aufruf schließt der Server die Sitzung selbst und gibt das Playwright-Schloss frei.

**Für Agenten ohne MCP: der Daemon.**

```bash
npm run playtest:daemon
```

Danach schickst du Schritte als Datei mit `npm run playtest:send -- schritt.mjs` und beendest mit `npm run playtest:send -- --quit`. Die Datei ist der Rumpf einer async-Funktion mit `D` (Bausteine aus `playtest-driver.mjs`, dieselben wie hinter dem MCP-Tool), `S` (App und Seite), `state` und `relaunch`:

```js
const start = await D.startMatch(S, { map: 'parcours_rift', mode: 'ARCADE', bots: 0 });
await D.configurePilot(S, { mode: 'parcours' }); // Zielflug durch die Checkpoints
await D.sleep(20000);
return { start, observed: await D.observe(S, { vector: false }), pilot: await D.pilotStatus(S), shot: await D.shot(S, 'rift') };
```

Ein Schritt, der länger als 5 Minuten läuft, wird durch einen Neustart der App beendet (`CURVIOS_PLAYTEST_STEP_TIMEOUT_MS`), eine abgestürzte App vor dem nächsten Schritt neu gestartet.

Beide Wege halten das Playwright-Schloss, solange die App offen ist. Laufordner, Fotos und Berichte liegen außerhalb des Repos (`%TEMP%\curvios-playtest-<Datum>\runs\`). Die Contract-Tests `tests/playtest-*.contract.test.mjs` prüfen Regler, Aufträge, Werkzeugschnittstelle und melden, wenn eine Spielinterna umbenannt wurde, auf die der Treiber zugreift.

## Weg C — Browser-Vorschau

Für Menü, Einstellungen und HUD reicht der Renderer im Browser und ist deutlich schneller als ein Electron-Start.

```bash
npm run dev
```

Danach die Vorschau öffnen und die Oberfläche über den Barrierefreiheits-Baum lesen statt über Bildschirmfotos — das ist genauer und billiger. Sag im Ergebnisbericht ausdrücklich, dass der Beleg aus dem Browser stammt.

## Weg D — manueller Lauf

Wenn nur ein Mensch beurteilen kann, ob es stimmt:

```bash
npm run app:start
```

Dieser Weg zählt in der Rundentelemetrie als menschliches Spiel, und das ist richtig so: der Nutzer spielt. Steuerst du das Spiel dagegen selbst, ohne Playwright (das meldet sich über die Debug-Schnittstelle von allein, siehe `electron/automation-hint.cjs`), dann starte es mit gesetzter Kennung, damit deine Runden die Statistik nicht verfälschen:

```bash
CURVIOS_AUTOMATION=claude npm run app:start
```

Beschreibe dem Nutzer **genau** und in wenigen Schritten, was er tun und worauf er achten soll — welcher Modus, welche Karte, welche Anzeige, welche Zahl. Warte auf seine Beobachtung und übernimm sie wörtlich in den Ergebnisbericht. Erfinde keinen Beleg, den du nicht gesehen hast; ein fehlender Desktop-Beweis ist ehrlich, ein erfundener ist wertlos.

## Schritt 2 — den Vorher-Zustand mitnehmen

Ein Beleg ohne Vergleichswert ist halb so viel wert. Zwei Wege dorthin:

- Den Zustand **vor** der Änderung aufnehmen, solange du ihn noch hast.
- Oder die Messung in einem getrennten, detached Baseline-Worktree am Ausgangscommit der Aufgabe wiederholen. Prüfe vorher Worktree-Liste und Playwright-Schloss und hole bei erreichter Sitzungsgrenze die nach `AGENTS.md` nötige Zustimmung ein. Benutze keinen Stash: sein Stack wird von allen Worktrees des Repositorys geteilt. Starte Nachher- und Vorher-Anwendung nie gleichzeitig, und entferne den Baseline-Worktree erst nach gesicherter Auswertung gemäß [Worktree Cleanup](../worktree-cleanup/SKILL.md) und den aktuellen Bereinigungsregeln. Bewahre nötige Messbelege und einzigartige Dateien gezielt statt einer zusätzlichen Vollkopie.

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

Beides sind echte Beispiele aus der Historie dieses Projekts. Halte den Satz als überprüfbaren Beleg im Ergebnisbericht fest.

## Woran ein Beleg scheitert

- Er nennt keine Zahl, sondern ein Gefühl.
- Er nennt keinen Vorher-Wert, also bleibt offen, ob sich überhaupt etwas geändert hat.
- Er beschreibt, was der Code tut, statt was auf dem Bildschirm passiert — das ist ein Test, kein Beleg.
- Er stammt aus dem Browser, wird aber als Desktop-Beweis verkauft.

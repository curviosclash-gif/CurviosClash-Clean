---
name: boundary-fix
description: Löst in diesem Repo Verstöße gegen die erzwungenen Architekturgrenzen auf — max-lines 500, Schichtimporte wie ui→core, DOM außerhalb src/ui, innerHTML, CONFIG-Schreibzugriffe, constructor(game), der Determinismus-Guard und die Ratchet-Baselines. Nutze diesen Skill sobald eslint, npm run lint, check:architecture, der PostToolUse-Hook oder typecheck:architecture meckert, bei Meldungen wie "boundary", "max-lines", "disallowed imports", "guard failed", "ratchet", und auch wenn eine Datei zu groß wird oder du aus einer Schicht auf eine andere zugreifen willst. Verhindert angehobene Baselines und neue Einträge in der Legacy-Ausnahmeliste.
---

# Architekturgrenzen auflösen statt umgehen

Die Grenzen in diesem Projekt sind maschinell erzwungen: sie brechen den Build, nicht das Review. Das ist Absicht, und daraus folgt die wichtigste Regel für diesen Skill — **die Grenze hat recht**. Der Ausweg ist nie, die Prüfung leiser zu stellen, sondern den Code so umzustellen, dass die Grenze nicht mehr im Weg ist. In fast allen Fällen ist der so entstehende Code auch der bessere.

Drei Dinge sind deshalb tabu, sofern der Nutzer sie nicht ausdrücklich verlangt:

- Eine Ratchet-Baseline anheben.
- Einen neuen Eintrag in `scripts/architecture/LegacyMaxLinesConfig.mjs`.
- Eine Lint-Regel per Kommentar abschalten.

## Schnellzuordnung

| Meldung | Ursache | Standardantwort |
| --- | --- | --- |
| `max-lines` über 500 | Datei macht mehr als eine Sache | Reine Helfer in ein eigenes Modul auslösen |
| `ui -> core disallowed imports` | UI greift direkt auf die Runtime zu | Port in `src/composition/core-ui/` |
| `core -> ui`, `state -> ui` | Untere Schicht ruft nach oben | Rückruf oder Ereignis, statt Import |
| `entities -> core`, `state -> core` | Spielobjekt braucht Runtime-Wissen | Wert hineinreichen, nicht holen |
| `shared/contracts -> implementation` | Contract importiert Code oberhalb | Die gebrauchte Form in den Contract ziehen |
| `DOM outside src/ui` | `document`/`window` in `core` | Zugriff nach `src/ui` verlagern oder Port |
| `no-innerHTML` | HTML als String zusammengebaut | `createElement` + `textContent` |
| `CONFIG writes` | globale Konfiguration beschrieben | Abgeleiteten Laufzeitwert übergeben |
| `constructor(game)` | Gott-Objekt durchgereicht | Nur die wirklich gebrauchten Abhängigkeiten |
| Determinismus-Guard | `Date.now`, `Math.random`, `performance.now` | Zeit und Zufall injizieren |
| `no-undef` | fehlender Import | Import ergänzen, nicht global deklarieren |
| Ratchet gestiegen | mehr Verstöße als in der Baseline | Verstöße abbauen, Baseline nicht anheben |

## max-lines: 500 Zeilen

Die Regel läuft mit `skipBlankLines` und `skipComments` (`eslint.config.js`). Gezählt werden also echte Code-Zeilen — Kommentare zusammenstreichen oder Leerzeilen entfernen bringt nichts und macht die Datei nur schlechter lesbar.

Die Grenze ist kein Stilmaß, sondern ein Hinweis: eine Datei über 500 Code-Zeilen macht in der Regel zwei Dinge gleichzeitig. Der Schnitt, der hier am besten funktioniert und im Projekt mehrfach so gemacht wurde, trennt **reine Berechnung von Wirkung**.

Konkret: Alles, was aus Eingaben nur einen Wert bildet — Beschriftungen, Umrechnungen, Auswahlregeln, Projektionen — wandert in ein eigenes Modul neben der Datei. Was übrig bleibt, ist das Anwenden dieses Werts auf die Welt: rendern, senden, speichern.

Der Gewinn ist doppelt. Die Datei ist unter der Grenze, und der herausgelöste Teil ist ohne Spielobjekte testbar — was ihn erst zum Gegenstand eines schnellen Contract-Tests macht.

Im Repo stehen fertige Vorbilder für genau diesen Schnitt, an denen du dich orientieren kannst: `src/ui/hangar/HangarProgressionProjection.js` (leitet Level, gesammelte Erfahrung, Restbedarf und Slot-Zustand aus Profil und Regeln ab), `src/ui/hangar/HangarStatProjection.js` und `src/ui/hangar/HangarWorkshopRenderText.js` (reine Beschriftungshelfer). Der Renderer formatiert seitdem nur noch.

`LegacyMaxLinesConfig.mjs` listet bestehende Ausnahmen. Das sind Schulden mit Zahl daneben, keine Erlaubnis. Keine neuen Einträge.

## Schichtimporte

Die erlaubte Richtung ist immer nach unten: `ui` → Contracts, `core` → `entities`/`state`/Contracts, alles → `shared/contracts`. Nach oben oder quer ist verboten, und die meisten dieser Budgets stehen in der Baseline auf **0** — es gibt also keinen Spielraum.

Wenn du auf eine solche Grenze stößt, ist fast immer eine dieser drei Fragen die richtige:

**Brauche ich Daten oder Verhalten?** Wenn UI nur eine Datenform braucht, die auch die Runtime kennt, gehört diese Form nach `src/shared/contracts/` — dann importieren beide nach unten und niemand quer. Das ist der häufigste und billigste Fall (`contract-change` beschreibt ihn im Detail).

**Kann der Aufruf umgedreht werden?** Wenn eine untere Schicht die obere benachrichtigen will, importiert sie sie nicht, sondern nimmt einen Rückruf entgegen, den die obere Schicht einhängt. Aus „`state` ruft UI" wird „UI hört auf `state`".

**Ist ein Port nötig?** Wenn UI echtes Verhalten aus `core` braucht, läuft der Zugriff über eine bestehende Port-Kette, nicht über einen Import. Sieh **zuerst nach, ob der Weg schon existiert** — meistens tut er das, und dann fehlt nur ein Feld in der Projektion:

- `src/shared/runtime/GameRuntimeFeaturePorts.js` — fachliche Ports wie `createArcadePort`.
- `src/shared/runtime/UiControllerRuntimePorts.js` — hängt sie an den Zugriff, den die UI kennt.
- `src/composition/core-ui/` — der Ort, an dem Core und UI verdrahtet werden (`CoreRuntimeAccessFactory`, `CoreUiMenuPorts`, `CoreSettingsPorts`).

Auf der UI-Seite liest sich das dann als `runtimeAccess?.getArcadeMenuSurfaceState?.()` — keine Kenntnis darüber, wo der Wert herkommt. Fehlt dir ein Feld, ergänzt du es in der Projektion auf der `core`-Seite und reichst es durch die Kette; das sind meist ein paar Einzeiler. Der Port veröffentlicht genau die benötigte Fähigkeit, nicht die ganze Runtime. Diese Kante wird gezählt (`coreToUiCompositionImportEdges`), ist also erlaubt, aber nicht gratis: erweitere lieber einen bestehenden Port, als einen neuen anzulegen.

Was du **nicht** tust: den Import über eine Zwischendatei verstecken, damit der Guard ihn nicht sieht. Der Guard prüft die Kanten, aber die Regel schützt die Verständlichkeit — ein verschleierter Verstoß ist schlimmer als ein sichtbarer.

## DOM außerhalb `src/ui`

`document` und `window` gehören ausschließlich nach `src/ui`. Die Baseline erlaubt acht Altlast-Dateien; neue kommen nicht dazu. Wenn `core` etwas über die Anzeige wissen muss (Größe, Sichtbarkeit, Eingabefokus), reicht die UI diesen Wert hinein, statt dass `core` ihn sich holt.

## `innerHTML`

Verboten, weil daraus Cross-Site-Scripting entsteht: Text aus einer Speicherdatei, einem Kartennamen oder einer Netzwerknachricht würde als Markup ausgeführt. Der Ersatz ist immer derselbe:

```js
const row = document.createElement('div');
row.className = 'hangar-slot';
row.textContent = slotLabel;
parent.appendChild(row);
```

Lint zählt das als Warnung, und `--max-warnings 0` macht daraus einen Fehler.

## Determinismus-Guard

In `src/network/SessionAdapterBase.js`, `LANSessionAdapter.js`, `OnlineSessionAdapter.js`, `src/ui/menu/MenuMultiplayerBridge.js` und `src/core/runtime/MenuRuntimeSessionService.js` sind `Date.now`, `Math.random` und `performance.now` verboten.

Der Grund ist im Mehrspielerbetrieb sichtbar: Jede Maschine würfelt sonst eigene Werte, und die Spielstände laufen auseinander. Ein realer Fall aus der Historie: die Lücken in den Spuren wurden mit `Math.random` gezogen, obwohl das Match längst einen gesetzten Zufallsgenerator mitführte — jede Maschine öffnete die Lücken an anderer Stelle.

Die Antwort ist immer Hineinreichen statt Aufrufen: eine `random`-Funktion oder eine Uhr als Abhängigkeit entgegennehmen. In Match-Code ist der gesetzte Generator der Runtime die richtige Quelle. Achte darauf, **wann** der Generator entsteht — wenn er später als das Objekt erzeugt wird, muss der Wurf an der Aufrufstelle aufgelöst werden, nicht im Konstruktor gemerkt.

## Ratchets

Zwei Baselines vergleichen den Ist-Zustand gegen gespeicherte Zahlen: `architecture-budget-ratchet.json` und `product-typecheck-ratchet.json`. Werte dürfen sinken, nicht steigen.

Wenn eine Zahl gestiegen ist, **schlüssle sie zuerst auf**, bevor du irgendetwas anfasst. Beim Typecheck-Ratchet sind rund drei Viertel der Meldungen fehlende oder ungenaue JSDoc-Angaben und keine echten Fehler; die Zahl steigt also leicht aus harmlosem Anlass. Nenne die konkreten neuen Meldungen, ordne sie ein, und behebe die echten. Eine Baseline anzuheben ist nur mit ausdrücklichem Auftrag zulässig — und der Ratchet ist genau dafür da, dass diese Entscheidung bewusst fällt.

## Nach der Änderung

Der PostToolUse-Hook lintet die geänderte Datei sofort, das ersetzt aber nicht den vollen Lauf:

```bash
npm run lint
```

```bash
npm run check:architecture
```

Danach `verify-scope`, weil eine Umstellung dieser Art oft mehrere Bereiche berührt. Ein herausgelöstes Modul verdient außerdem meist direkt seinen ersten Contract-Test — das ist der Grund, warum sich der Schnitt gelohnt hat.

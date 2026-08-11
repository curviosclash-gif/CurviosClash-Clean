---
name: contract-change
description: Legt in diesem Repo einen neuen Datenvertrag unter src/shared/contracts an oder ändert einen bestehenden — mit Normalisierer, beiden Aufrufseiten, striktem Typecheck und dem Coverage-Ratchet. Nutze diesen Skill wenn eine Datenform über Schichten hinweg gebraucht wird, wenn ein gespeicherter Wert nicht ankommt oder beim Speichern verloren geht, wenn ein Wert an zwei Stellen unterschiedlich verstanden wird, und bei Formulierungen wie "neues Feld in den Einstellungen", "Speicherformat erweitern", "Contract anlegen", "das kommt in der Runtime anders an als gespeichert".
---

# Einen Datenvertrag ändern oder anlegen

`src/shared/contracts/` ist die unterste Schicht: sie darf aus `core`, `ui`, `state` und allen anderen Implementierungen **nichts** importieren. Alles andere darf von hier importieren. Dadurch ist ein Contract der einzige Ort, an dem eine Datenform für mehrere Schichten zugleich verbindlich festgelegt werden kann.

Der Fehler, den Contracts verhindern, sieht in diesem Projekt so aus: ein Wert wird gespeichert, aber der Sanitizer baut den gespeicherten Zustand aus den Standardwerten neu auf — und weil dort ein Block fehlt, verschwindet er bei jedem Speichern. Der Wert war schreibbar, lesbar und trotzdem unerreichbar. Ein Contract schließt das, weil Speicherpfad und Runtime durch **dieselbe** Funktion gehen.

## Schritt 1 — prüfen, ob es wirklich ein Contract sein muss

Ein Contract lohnt sich, wenn mindestens zwei Schichten dieselbe Form brauchen oder wenn die Form persistiert wird. Für einen Wert, der nur innerhalb eines Moduls lebt, ist ein Contract zu viel Apparat.

Sieh vorher nach, ob es schon einen gibt: `ls src/shared/contracts/` zeigt rund 60 Verträge. Ein bestehender zu erweitern ist fast immer besser, als einen zweiten für dasselbe Thema anzulegen.

## Schritt 2 — die Datei schreiben

Die Hausform ist durchgehend gleich und lohnt sich einzuhalten, weil sie das Verhalten in Grenzfällen vorhersagbar macht.

```js
// Kurz und in Prosa: welche Daten, wer schreibt sie, wer liest sie, und warum
// beide Seiten durch dieselbe Funktion müssen.

export const ARCADE_RUN_SETTINGS_RANGES = Object.freeze({
    sectorCount: Object.freeze({ min: 1, max: 20 }),
});

const DEFAULTS = Object.freeze({
    sectorCount: 5,
});

export function createDefaultArcadeRunSettings() {
    return { ...DEFAULTS };
}

/**
 * @param {any} source persistierter Block, in beliebigem Zustand
 * @returns {ReturnType<typeof createDefaultArcadeRunSettings>}
 */
export function normalizeArcadeRunSettings(source) {
    const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    return {
        sectorCount: clampInteger(input.sectorCount, ARCADE_RUN_SETTINGS_RANGES.sectorCount, DEFAULTS.sectorCount),
    };
}
```

Vier Eigenschaften, die dabei zählen:

- **Der Normalisierer nimmt alles entgegen.** `undefined`, `null`, ein Array, ein String aus einer alten Speicherdatei — er gibt immer ein vollständiges, gültiges Objekt zurück. Er wirft nicht. Das ist der Grund, warum eine alte Speicherdatei nach einem Update noch lädt.
- **Bereiche sind Daten, keine Zahlen im Code.** Ein exportiertes `*_RANGES`-Objekt kann von der Oberfläche für Schieberegler und vom Test für Grenzfälle gelesen werden. `Object.freeze` verhindert, dass jemand die Grenze zur Laufzeit verstellt.
- **Wiederverwenden statt neu schreiben.** `ContractNormalizeUtils.js` hat bereits `normalizeString` und `normalizeText`. Prüfe dort zuerst.
- **Nichts importieren, was oberhalb liegt.** `scripts/check-architecture-boundaries.mjs` bricht den Build, wenn ein Contract eine Implementierung importiert.

## Schritt 3 — beide Aufrufseiten anschließen

Das ist der Schritt, der den Nutzen erzeugt, und der am leichtesten vergessen wird. Ein Contract, durch den nur eine Seite geht, verhindert gar nichts.

Suche alle Stellen, die die Form heute schon anfassen:

```bash
rg "sectorCount" src/ --type js
```

Führe **jede** davon durch den Normalisierer — den Speicherpfad (was einen Neustart überlebt) genauso wie die Runtime (womit ein Match tatsächlich läuft). Wenn danach noch irgendwo ein `?? 5` oder ein eigener Standardwert steht, ist das eine zweite Wahrheit und gehört weg.

Der Speicherpfad liegt in `src/core/settings/SettingsSanitizerOps.js`. Dort steht der Arcade-Block als Vorbild:

```js
merged.arcade = normalizeArcadeRunSettings(src?.arcade ?? defaults.arcade);
```

Und hier lauert die Falle, die genau diesen Kommentar im Code erzeugt hat: **der Sanitizer baut aus den Standardwerten auf**. Ein Feld, das die Defaults nicht kennen, fällt beim Speichern heraus, egal wie sauber der Contract ist — der Wert ist dann schreibbar, lesbar und trotzdem unerreichbar. Prüfe deshalb ausdrücklich als dritte Stelle, dass die Standardwerte den neuen Block oder das neue Feld führen.

Die benachbarten Hunt-Werte (`deathmatchKillLimit`, `timeLimitEnabled`) werden dort noch direkt im Sanitizer begrenzt, mit Zahlen im Code. Das ist der ältere Stil. Ein neuer Wert, den auch die Runtime lesen muss, gehört in einen Contract — sonst entsteht genau die zweite Wahrheit, gegen die der Contract antritt.

## Schritt 4 — strikt typprüfen

Hier liegt eine Falle: `tsconfig.contracts.json` prüft **nicht** den ganzen Ordner, sondern eine ausdrückliche Dateiliste.

```json
"files": [
    "src/shared/contracts/ContractNormalizeUtils.js",
    "src/shared/contracts/EditorPathContract.js",
    "src/shared/contracts/GameStateIds.js",
    "src/shared/utils/CanonicalJson.js"
]
```

Ein neuer Contract wird also nicht automatisch streng geprüft. Trage ihn in die Liste ein, wenn er die strenge Prüfung bestehen soll — und rechne damit, dass `strict: true` dann fehlende oder ungenaue JSDoc-Angaben anmerkt.

```bash
npm run typecheck:contracts
```

Wenn du ihn nicht einträgst, sag im Commit-Body, dass er nur unter der lockeren Produktprüfung läuft. Stillschweigend auslassen ist die schlechteste Variante, weil später niemand erkennt, ob das Absicht war.

## Schritt 5 — testen und das Coverage-Tor bedienen

Ein Contract-Test gehört als `tests/<thema>.contract.test.mjs` angelegt; das Namensschema genügt, es gibt nichts zu registrieren. Prüfe mindestens:

- den Standardfall,
- Müll als Eingabe (`undefined`, `null`, `[]`, `'abc'`) — kommt ein vollständiges Objekt zurück?
- beide Enden jedes Bereichs, also auch den Wert knapp außerhalb,
- den Rundweg: schreiben, normalisieren, lesen — kommt derselbe Wert an?

`src/shared/contracts` hat die höchste Coverage-Untergrenze im Projekt. Die aktuellen Werte stehen in `scripts/architecture/coverage-ratchet.json` und liegen bei **90 % Zeilen, 75 % Zweige, 85 % Funktionen** — deutlich über den 70/60/60, die in `CLAUDE.md` stehen. Die Grenzen dürfen steigen, nicht fallen, und werden nur mit ausdrücklichem Auftrag abgesenkt.

```bash
npm run test:contract:coverage
```

Der Ratchet misst außerdem `src/state`, `src/entities/systems` und `src/modes` im selben Lauf. Wenn du in Schritt 3 dort Code hinzugefügt hast, kann die Grenze auch dort reißen — dann fehlen Tests für den neuen Zweig, nicht für den Contract.

## Schritt 6 — Umfang und Commit

```bash
npm run check:architecture
```

Danach `verify-scope` für die tatsächlich geänderten Pfade, dann `atomic-commit`. Der `Why:`-Teil sollte benennen, welche zwei Seiten jetzt durch dieselbe Funktion gehen und welche Abweichung dadurch unmöglich geworden ist.

## Bestehende Verträge ändern

Beim Ändern kommt eine Frage dazu: **was passiert mit bereits gespeicherten Daten?** Ein neues Feld mit Standardwert ist unkritisch, weil der Normalisierer es ergänzt. Ein umbenanntes oder entferntes Feld ist es nicht — dann braucht es eine Übernahme des alten Werts im Normalisierer, und `ArtifactVersionMigrationContract.js` ist der Ort, an dem dieses Projekt Versionsübergänge behandelt. Ein Test mit einer alten Speicherform als Eingabe belegt, dass nichts verlorengeht.

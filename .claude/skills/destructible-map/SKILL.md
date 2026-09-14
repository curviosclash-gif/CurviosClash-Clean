---
name: destructible-map
description: Baut in diesem Repo eine neue Karte mit einem Bauwerk, das im Match zerschossen werden kann und dann einstürzt oder einen Ereignis-Effekt zündet — nach dem Muster der Eiffelturm-Belagerung (eiffel_tower_siege). Führt in zehn Phasen vom Bruchplan über das intakte Bauwerk, die in Blender vorberechneten Bruchszenen, das Preset und die Contract-Tests bis zum Desktop-Beleg, deckt die Erweiterungsfälle ab (mehrere Bauwerke pro Karte, Kettenreaktionen, neue Segmentarten, anderes HUD-Wort, Druckwelle) und die Sonderfälle Atompilz (nicht fallende Effektszene) und Tyrannosaurus rex (bewegliches, treffbares Ziel). Nutze diesen Skill bei Formulierungen wie "einstürzende Struktur", "zerstörbare Karte", "Turm umkippen", "Brücke/Burg/Staudamm einstürzen lassen", "Atompilz", "Explosion auf der Karte", "T-Rex", "Dinosaurier auf der Karte", "Monster das man abschießen kann", "Bruchszene", "wie der Eiffelturm", "destructible", "Kollaps in Blender backen", und immer wenn ein Preset einen destructibles-Block bekommen soll oder MapDestructibleContract erweitert werden müsste.
---

# Eine Karte mit einstürzendem Bauwerk bauen

Die Eiffelturm-Belagerung (`da82143`) hat die gesamte Maschinerie dafür angelegt. Sie ist **wiederverwendbar**: Eine zweite Karte braucht keine neue Laufzeit, sondern ein Bauwerk, einen Bruchplan, vorberechnete Sturzszenen und ein Preset. Dieser Skill sagt, in welcher Reihenfolge das entsteht, welche Zahlen wo herkommen und an welchen Stellen die Maschinerie erweitert werden muss, wenn das neue Bauwerk nicht in das Turm-Schema passt.

Drei Begriffe tragen alles, deshalb vorab:

- **Segment** — ein Teil des Bauwerks mit eigenen Lebenspunkten (Beispiel: das nordwestliche untere Bein). Waffen treffen ein *Mesh*, also ein Stück gezeichnete Geometrie mit Namen; das Segment beansprucht Mesh-Namen über Präfixe.
- **Stück (piece)** — ein Teil des Bauwerks, der beim Sturz *zusammen* fällt (Beispiel: alles über der ersten Galerie). Ein Segment gehört zu genau einem Stück. Jedes Stück existiert genau einmal in der Welt, deshalb kann es nur einmal fallen.
- **Bruchszene (break scene)** — ein eigenes GLB-Modell, das das Bauwerk ab einer Bruchlinie enthält und einen einzigen Sturz als vorberechnete Animation trägt. Es ist unsichtbar geladen, wird beim Bruch eingeblendet, auf die Fallrichtung gedreht und einmal abgespielt, während die intakten Modelle verschwinden.

Dazu drei Zahlen: der **Anker** eines Segments (sein Fußpunkt in Kartenkoordinaten; unterscheidet gleichnamige Segmente und gibt die Fallrichtung vor), der **bakedHeading** einer Szene (die Weltrichtung, in die der Clip in Blender gefallen ist) und das **Ereignis-Yaw** (die Fallrichtung eines Bruchs; die Laufzeit dreht die Szene um die Differenz der beiden). Alle Richtungen sind `atan2(x, z)`: +Z ist 0, +X eine Vierteldrehung.

## Die eine Regel, die nicht verhandelbar ist

**Der Sturz wird in Blender simuliert und als Keyframes gebacken. Es gibt keinen Live-Integrator im Spiel.** Der erste Versuch am Eiffelturm war ein handgeschriebener 2D-Integrator; er teleportierte Stücke 40 m pro Bild, fror sie senkrecht ein und stellte einen 159 m langen Stumpf 133 m neben den Turm. Blenders Rigid-Body-Welt (die Physik-Bibliothek *Bullet*) macht das deterministisch — zwei Läufe ergeben byteidentische Dateien — und die Laufzeit muss nur Ereignisse abspielen. Das hält Host und Replikat ohne jede Animationsnachricht identisch, siehe Phase 8.

## Was schon da ist und was nicht

| Schicht | Datei | Wiederverwendbar? |
| --- | --- | --- |
| Datenvertrag | `src/shared/contracts/MapDestructibleContract.js` | Ja: Normalisierer, Trefferauflösung, Schaden, Versiegelung, Zeitleiste, Netz-Serialisierung, HUD-Zustand |
| Laufzeit-Besitzer | `src/entities/systems/MapDestructibleSystem.js` | Ja: liest `destructibles` aus jeder Karte, Modus-Schranke, Anker-Skalierung |
| Treffer | `src/entities/arena/ArenaRayQuery.js`, `MGHitResolver.js`, `ProjectileHitResolver.js` | Ja: MG und Raketen melden den Mesh-Namen und den Treffpunkt für jede Karte |
| Szenen abspielen | `src/entities/arena/MapBreakSceneController.js`, `GlbModelVisibilityOps.js` | Ja: `hiddenUntilTriggered`, Uhrmodus `once`, `piece_<id>`-Rigs, dynamische Kollision aus bewegten Meshes |
| Netz | `src/hunt/HuntNetworkState.js` (Block `mapDestructibles`) | Ja, im Hunt-Zustandsblock |
| HUD | `src/ui/MapDestructibleStatusText.js`, `HUD.js` | Teils: Text sagt fest „TURM" |
| Segmentarten | `MAP_DESTRUCTIBLE_KINDS` im Contract | **Nur vier**: `leg_lower`, `leg_mid`, `shaft`, `summit` |
| Versiegelung | `state.sealed` im Contract | **Global pro Karte**, nicht pro Bauwerk |
| Bots | — | Bots zielen nicht bewusst auf das Bauwerk (offene Etappe 6 des Eiffel-Plans) |
| Blender-Simulation | `scripts/generate_eiffel_tower_siege_assets.py` | Als Vorlage: Massenmodell, Gelenke und Schnitte sind turmspezifisch |

Die drei fetten Einträge sind die Stellen, an denen ein komplexeres Bauwerk die Maschinerie erweitert. Phase 7 sagt wie.

## Phase 0 — der Bruchplan, bevor irgendetwas gebaut wird

Ein Bruchplan ist eine Tabelle, keine Idee. Ohne sie werden Segmentnamen, Stücke und Szenen dreimal umbenannt. Beantworte diese Fragen schriftlich und lege die Antwort als Kommentarblock oben in die spätere `<Name>Destructibles.js`:

1. **Welches Bauwerk, aus welchen Teilen?** Teile, die ein Spieler als Ziel erkennt: Pfeiler, Bogen, Fahrbahn, Mauer, Turm. Höchstens 16 Segmente, 16 Stücke, 16 Szenen (`MAP_DESTRUCTIBLE_LIMITS`).
2. **Was fällt mit wem?** Daraus folgen die Stücke. Beim Turm: Unteres Bein weg → alles fällt; Schaft weg → Schaft und Spitze fallen. Bei einer Brücke: Pfeiler weg → die zwei anliegenden Felder fallen.
3. **Wohin fällt es?** Zur eigenen Seite (Bein → auf seine Ecke) oder in Schussrichtung (Spitze → vom Schützen weg)? Das entscheidet über die Segmentart (Phase 1).
4. **Was beendet das Zerlegen?** Ein Bruch, nach dem nichts mehr brechen darf, ist ein *versiegelnder* Bruch. Ohne einen solchen kann alles nacheinander fallen — erlaubt, aber dann brauchen die Szenen alle Kombinationen (siehe Frage 6).
5. **Welche Modi?** `gameModes: ['HUNT']` ist die getroffene Entscheidung für den Turm: Arcade wird über Fortschritt gewertet, ein entfernbares Wahrzeichen würde die Wertung ändern. Leer heißt alle Modi.
6. **Welche Reihenfolgen sind möglich?** Jede Szene ersetzt das Bauwerk ab ihrer Bruchlinie. Fällt erst die Spitze und dann der Schaft, muss die Schaft-Szene die schon gefallene Spitze ausblenden — das kann die Zeitleiste (`hiddenPieceIds`). Fällt erst ein *unteres* Teil, sind die oberen mit weg (Versiegelung oder `collapseScenePieces`). Male den Baum: Welche Szene läuft nach welcher, und welche Stücke sind dann schon am Boden?
7. **Wie groß wird das Feld?** Der Sturz reicht weiter als das Bauwerk hoch ist. Die Feldgröße kommt aus den gebackenen Clips (Phase 3), nicht aus einer Schätzung. Reserviere im Plan einen Platzhalter.
8. **Ein Bauwerk oder mehrere?** Zwei Türme auf einer Karte teilen sich heute *eine* Versiegelung: Fällt Turm A ganz, kann Turm B nicht mehr brechen. Wenn das nicht gewollt ist, ist Phase 7c Pflicht, **bevor** das Preset entsteht.

Halte fest, was der Nutzer entschieden hat und was du angenommen hast. Für den Turm steht das in der Memory-Notiz `eiffelturm-belagerung-plan`; für die neue Karte gehört es in den Kommentarkopf der Preset-Dateien.

## Phase 1 — Segmente auf die vier Rollen abbilden

Der Contract kennt vier Segmentarten. Sie sind nach dem Turm benannt, bedeuten aber Rollen:

| Art | versiegelt | Fallrichtung | Standard-Stück | Rolle in Worten |
| --- | --- | --- | --- | --- |
| `leg_lower` | ja | eigener Anker | `lower` | trägt alles; sein Bruch beendet das Zerlegen |
| `leg_mid` | nein | eigener Anker | `mid` | trägt einen Teil; fällt zur eigenen Seite |
| `shaft` | nein | Schussrichtung | `shaft` | steht mittig, hat keine Seite |
| `summit` | nein | Schussrichtung | `summit` | die billige Trophäe oben |

Ein Brückenpfeiler ist ein `leg_mid` (fällt zur eigenen Seite, versiegelt nicht) mit `piece: 'span_west'`. Eine Burgmauer, deren Bruch das Tor freigibt, kann ein `leg_lower` sein, wenn danach nichts mehr fallen soll. **Das Feld `piece` überschreibt das Standard-Stück pro Segment** — das ist der vorgesehene Weg, ein anders geschnittenes Bauwerk auf die vier Arten zu legen, ohne den Contract anzufassen.

Wenn eine Rolle fehlt (etwa „versiegelt *und* fällt in Schussrichtung" oder „fällt zur eigenen Seite und versiegelt nur sein eigenes Bauwerk"), erweiterst du `MAP_DESTRUCTIBLE_KINDS` und `resolveMapDestructibleKindRule`. Das ist eine Contract-Änderung: `contract-change` beschreibt den Ablauf, `red-first-fix` den Test, der vorher rot ist. Beide Aufrufseiten sind der Normalisierer (verwirft unbekannte Arten stillschweigend!) und `applyMapDestructibleNetworkState` (verwirft Ereignisse unbekannter Art). Der Test `tests/map-destructible.contract.test.mjs` prüft die Artenregeln ausdrücklich („kind rules seal only for a lower leg") und muss mitziehen.

Grenzen, die der Normalisierer stillschweigend anwendet: `hp` 1 bis 100 000 (Rückfall 300), höchstens 8 Mesh-Präfixe pro Segment, Anker ±4000, Ids bis 80 Zeichen, Labels bis 40. Ein Segment ohne bekannte Art oder ohne Präfix wird **verworfen, nicht gemeldet** — das Prüfskript aus Phase 5 macht genau das sichtbar.

## Phase 2 — das intakte Bauwerk

Das intakte Bauwerk ist eine normale GLB-Karte mit vier Anforderungen, die der Sturz stellt:

- **Ein Teil pro Segmentgruppe, ein Mesh pro Material.** Der Turm exportiert `02_legs_lower.glb` mit drei Meshes (`legs_lower_iron`, …). Alle vier Beine tragen dieselben Namen; der Anker unterscheidet sie. Ein Präfix darf nichts beanspruchen, was nicht zum Segment gehört: `shaft_` hätte auch die Aufzugsführungen `shaft_lift_*` erwischt, deshalb heißt der Präfix `shaft_iron`. Maschinen (Aufzüge, Leuchtfeuer) bekommen eigene Dateien und eigene Präfixe.
- **`glbColliderMode: 'scene'`** in der Karte: Kollision kommt aus den Dreiecken, jedes Mesh ohne `_nocol` im Namen ist treffbar. Zierwerk mit `_nocol` kann nie einen Treffer melden.
- **`scaleAuthoredAnchors: true`**, wenn die Karte mit `MAP_SCALE` ≠ 1 gebaut wird (der Turm läuft mit 3). Sonst misst die Laufzeit Treffer gegen unskalierte Anker und ordnet jeden Schuss dem falschen Bein zu.
- **Die Unterseite jedes Teils messen.** Der Loader setzt ein Modell auf seine eigene Bounding-Box. Die Szene, die ein Teil ersetzt, muss auf exakt derselben Höhe stehen, sonst springt das Bauwerk im Moment des Bruchs. Der Generator berichtet die Unterseiten (`baseMetres`); die Zahlen wandern in `<Name>Models.js` **und** in den Asset-Test.

Wenn das intakte Bauwerk schon als Karte existiert (wie `eiffel_tower`), wird es **nicht neu gebacken**. Die eingecheckte `01_champ_de_mars.glb` ist mit dem heutigen Generator nicht mehr reproduzierbar; `--pack eiffel_tower` nicht beiläufig laufen lassen. Die Belagerungskarte importiert die intakten Modelle aus `../eiffel_tower/EiffelTowerModels.js` und tauscht nur, was der Sturz braucht (die breitere Esplanade).

## Phase 3 — die Bruchszenen in Blender backen

Ein *abgeleitetes Pack*: `scripts/generate_<name>_assets.py` mit `BASE = <intaktes Modul>`, das die intakten Builder aufruft und Bewegung hinzufügt. Verzeichnisse `assets/maps/<pack>/blender/` (die `.blend`-Quellen, bleiben eingecheckt) und `assets/maps/<pack>/glb/`. Blender 4.2 LTS; Aufruf über den Dispatcher, nie direkt:

```bash
node scripts/generate-map-assets.mjs --map <mapKey> --dry-run
```

```bash
node scripts/generate-map-assets.mjs --map <mapKey>
```

Der Dispatcher findet Blender unter `Program Files\Blender Foundation` oder über `BLENDER_BIN`. Registriere das Pack an **beiden** Stellen — `BLENDER_ASSET_GENERATORS` in `scripts/map-asset-jobs.mjs` und `GENERATORS` in `scripts/generate_map_assets.py` — und hebe in `tests/map-asset-jobs.contract.test.mjs` die Zählungen (Karten, Jobs) um die neue Karte an. Das sind Zählungen, keine Ratchets.

Die Szenen selbst folgen einem festen Aufbau, und jede Zeile davon hat einen Grund:

- **Eine Szene pro Bruchlinie, ein Clip pro Datei**, Clipname `<Etwas>Once`. `SCENES = ((stem, clipName, pieces_von_unten_nach_oben), …)`, daraus `SETPIECES` für den Exporter des Basis-Packs.
- **Ein Rig-Empty `piece_<id>` pro fallendem Stück**, alle Meshes des Stücks darunter geparentet, und **jedes** Mesh der Datei unter einem gekeyframten Rig — auch Stücke, die zunächst nur mitfahren. Die Laufzeit leitet aus jedem bewegten Mesh einen dynamischen Kollider ab; ein Mesh außerhalb eines Rigs hielte einen alten Kollider in der Luft.
- **Bild 1 ist die Ruhepose, exakt** (Position auf dem Fuß, Rotation Identität). Das Preset setzt die Szene nach der Bounding-Box dieser Pose, und die Laufzeit dreht die Szene um ihren eigenen Fußpunkt.
- **Simulation statt Handanimation**: aktive Körper als konvexe Hülle pro Stück mit der Masse aus dem Massenmodell; Boden und das noch stehende Bauwerk unterhalb der Bruchlinie als passive Körper; `FIXED`-Gelenke an den Bruchlinien, die per Skript getrennt werden, sobald das Biegemoment die Kapazität übersteigt; 12 Substeps, 24 Solver-Iterationen, ein Thread, kein Zufall. **Keine Impulse, keine Anfangsgeschwindigkeit**: Was das Bauwerk in Bewegung setzt, ist der Schnitt — der Treffer nimmt einen Teil dessen weg, worauf es steht, und die Schwerkraft macht den Rest. Der Schnitt liegt `SEAT_CUT` (6 m) hinter der Achse, sonst läge der Schwerpunkt genau auf der Kante und Rundung entschiede die Richtung.
- **Seitwärtsdrift in der Fallebene halten**: Die Fallrichtung ist gesetzt (das Preset dreht die Szene), aber Hüllen sind nicht spiegelsymmetrisch und ein taumelndes Stück driftet pro Aufprall ein paar Grad. Drehung bleibt frei, nur die Drift wird herausgenommen.
- **Determinismus prüfen**: `simulate` spielt den letzten Durchlauf erneut und vergleicht. Ohne diesen Vergleich merkst du eine nichtdeterministische Einstellung erst am Replikat.
- **Beim Stillstand schneiden**: Stillstand = unter 5 cm und 0,5° pro Bild über 30 Bilder, dann 1 s Nachlauf, damit der Clip nicht auf einem Sprung endet. `SIM_MAX_SECONDS` 57 als Wächter; der Asset-Test erlaubt 60 s. Ein Bauwerk in echtem Maßstab fällt langsam — die längste Turmszene dauert 50 s.
- **Der Generator berichtet die Reichweite** (`collapse.report`): wie weit das fernste Stück von der Achse zur Ruhe kommt. Das ist die Zahl, aus der die Feldgröße folgt.
- **Der Boden muss unter der Reichweite liegen.** Der Turm bekam dafür `01_champ_de_mars_wide` (480 m statt 250 m) als *ersetzendes* statisches Teil — zwei Rasenflächen auf gleicher Höhe würden um jeden Pixel streiten.

Bekannte Schwächen der Turmszenen, die du beim neuen Bauwerk nicht wiederholen musst, aber kennen solltest: die aus der Hülle geschnittenen Ecken lassen ein liegendes Stück bis 15 m in den Boden sinken (der Stumpf 26 m), weil die gezeichnete Geometrie vollständig bleibt; das stehende Bauwerk ist eine massive Hülle, Galerien sind keine Landeflächen; in Szene 20 bricht die zweite Galerie schon beim Absacken (1°) statt beim Aufschlag.

**Beim zweiten Bauwerk** das Simulationsgerüst (`rigid_world`, `add_body`, `hull_object`, `add_constraint`, `trim`, die Determinismus-Gegenprobe) in ein gemeinsames Modul `scripts/blender_collapse.py` ziehen, statt es zu kopieren. Massenmodell, Gelenkhöhen und Schnitte bleiben pro Bauwerk. Nicht schon beim ersten — eine Abstraktion aus einem Fall ist meistens falsch geschnitten.

## Phase 4 — der Asset-Contract-Test

`tests/<map-key-mit-bindestrichen>-blender-assets.contract.test.mjs`, nach Vorlage von `tests/eiffel-tower-siege-blender-assets.contract.test.mjs`. Er liest die GLBs direkt (glTF-Header, JSON-Chunk, Float-Accessoren) und ist die eine Hälfte des Vertrags zwischen Blender und Preset. Was er mindestens prüft, mit dem Grund:

| Prüfung | Warum |
| --- | --- |
| Blender-Quelle und nicht-leeres GLB pro Teil, Gesamtgröße unter Budget | ein Pack kann sonst den Download stillschweigend verdoppeln |
| Der Boden reicht weiter als das fernste Wrack, gemessen aus den Clips | eine Konstante driftet von den Dateien weg |
| Genau ein benannter Clip pro Szene, plausible Länge | die Karte adressiert Clips über Namen |
| Jedes Mesh gehört zu einem `piece_`-Rig und wird bewegt | veralteter Kollider in der Luft |
| Dreieck- und Knotenbudget | die Szene wird aus denselben Buffern gezeichnet wie das stehende Bauwerk |
| Bild 1 = intakte Teile, Unterseite exakt auf `baseMetres` | Sprung beim Bruch |
| Kein Sprung > 6 m oder 8° pro Bild | „Teleport" statt Fall |
| Echter Stillstand, gehalten vor dem Ende | eingefrorenes Gleiten |
| Kein Stück endet aufrecht auf dem eigenen Fuß (außer dem Stumpf) | die Pose des Integrator-Fehlers |
| Vergrabung unter Grenze | Hüllenschnitt vs. gezeichnete Geometrie |
| Nichts kommt in stehender Geometrie zur Ruhe | Silhouette des Restbauwerks als Tabelle |

Die Silhouettentabelle (`SPREAD`, `LEG_WIDTH`), das Taumel-Limit (540°) und die Vergrabungsgrenzen sind bauwerksspezifisch und werden aus dem Generator abgeleitet, nicht geraten. Schreibe an jede Zahl, woher sie kommt.

## Phase 5 — das Preset

Drei Dateien unter `src/core/config/maps/presets/<map_key>/`, wie beim Turm:

- **`<Name>Models.js`** — intakte Modelle (importiert oder neu), plus die Szenen über eine `breakScene(id, file, clipName, baseMetres)`-Hilfe mit `hiddenUntilTriggered: true`, `animationClock: { mode: 'once', clipName }`, Position auf der Unterseite des ersetzten Teils, Rotation `[0, 0, 0]`, ein gemeinsamer Maßstab, kein `targetSize`. Exportiere `*_SCENE_CLIPS` und `*_SCENE_BASE_METRES`, damit der Preset-Test dieselben Zahlen liest.
- **`<Name>Destructibles.js`** — `gameModes`, `segments` (mit `id`, `label` für das HUD, `kind`, `hp`, `meshPrefixes`, `anchor`, bei Bedarf `piece`), `pieces` und `breakScenes` (`trigger: { kind }` oder `{ segmentId }`, nie beides; `modelId`; `bakedHeading`; `pieces`; `hideModelIds` = **alle** Modelle der fallenden Stücke, Maschinen eingeschlossen — ein hängen gebliebener Aufzug über leerer Esplanade verrät den Trick). Ein `trigger.segmentId` schlägt `trigger.kind`, so kann die Spitze einen eigenen Sturz haben und eine generische Szene den Rest derselben Art abdecken.
- **`index.js`** — Feldgröße ≥ Reichweite + 20 Einheiten Rand (Reichweite aus Phase 3, in Kartenmaßstab umgerechnet); der Rückfall-Boden (`compileWithGlb`, `kind: 'foam'`) wächst mit dem Feld; gezeichnete Kisten (`renderWithGlb`), die nach dem Sturz in der Luft hängen würden, fliegen raus; keine Portale, die in fallende Geometrie enden; Spawns außerhalb des Bauwerks; `singlePlayerScenario` mit dem Modus, in dem gebrochen werden darf.

Registrierung an drei Stellen: `MapPresetCatalog.js` (Import + Spread), `BASE_MAP_KEYS` in `MapPresetsBase.js` (sonst bietet der Picker die Karte nie an) und eine Sammlung in `src/ui/menu/MenuMapCollectionCatalog.js`. Danach:

```bash
rg "eiffel_tower_siege" tests/ scripts/
```

Jede Fundstelle außerhalb der Eiffel-eigenen Tests ist eine Liste, in die die neue Karte ebenfalls gehört (Beleuchtungs-Checks, Katalogzählungen, Cluster).

Dann das Prüfskript dieses Skills. Es leitet aus Katalog und GLB-Dateien ab, was der Eiffel-Preset-Test von Hand behauptet, und meldet, was der Normalisierer sonst stillschweigend verwirft:

```bash
node .claude/skills/destructible-map/scripts/audit-destructible-map.mjs <mapKey>
```

`FAIL` ist ein Fehler im Preset oder in den Dateien (unbekannte Art, Clipname passt nicht zur Datei, Rigs passen nicht zu `pieces`, Mesh ohne Rig, `bakedHeading` weicht vom gemessenen Sturz ab, Wrack über den Feldrand, Präfix beansprucht nichts, Szene nicht `once`). `WARN` ist eine Entscheidung, die du bewusst getroffen haben musst (keine versiegelnde Art, keine Picker-Sammlung, noch kein Desktop-Spec). `--json` für Weiterverarbeitung. Gegen `eiffel_tower_siege` ist das Skript grün — das ist die Referenz.

## Phase 6 — der Preset-Contract-Test

`tests/<map-key-mit-bindestrichen>.contract.test.mjs`, nach Vorlage von `tests/eiffel-tower-siege.contract.test.mjs`. Das Prüfskript ersetzt ihn nicht: Der Test hält die **bauwerksspezifischen** Aussagen fest, die ein Skript nicht wissen kann.

- Die Karte erreicht die Laufzeit (`getRuntimeMapDefinition`), nicht nur den Katalog, und liegt in der beabsichtigten Sammlung.
- Welche intakten Modelle zu welchem Stück gehören (`PIECE_MODELS`) und dass jede Szene genau diese ausblendet.
- Welches intakte Teil jede Szene ersetzt (`SCENE_INTACT_MODEL`) und dass beide dieselbe Slot-Höhe haben.
- Präfixe beanspruchen jedes kollidierbare Mesh ihres Teils und **nichts** in den Dateien der Maschinen.
- Ein Bein bringt das Bauwerk auf seine eigene Ecke: Sturz um das Zeitleisten-Yaw drehen und mit der Ankerrichtung vergleichen. Mittige Segmente folgen dem Schuss.
- Das Feld ist breit genug, der Rückfall-Boden deckt es, nichts Gezeichnetes bliebe hängen, Spawns liegen im Feld.
- Der Block überlebt die Normalisierung ohne Verlust (Anzahl, Reihenfolge, `hp`, `pieces`, `hideModelIds`, Labels ≠ Ids).

Die generischen Contract-Tests (`tests/map-destructible*.contract.test.mjs`) laufen ohnehin; wenn Phase 7 den Contract erweitert, wachsen sie dort mit.

## Phase 7 — Erweiterungen der Maschinerie, nur wenn der Plan sie verlangt

Jede dieser Erweiterungen ist eine eigene Aufgabe mit rotem Test zuerst (`red-first-fix`) und, wo der Contract betroffen ist, `contract-change` samt Coverage-Tor (`npm run test:contract:coverage`, 90/75/85 in `src/shared/contracts`). Keine davon nebenbei im Preset-Commit.

**7a — Anderes HUD-Wort.** `formatMapDestructibleStatus` sagt „TURM STÜRZT / TURM BRICHT / TURM · SEGMENT 40 %". Für eine Brücke braucht die Definition ein Wort: neues optionales Feld `hudNoun` im `destructibles`-Block (Normalisierer mit Rückfall `TURM`), durch `resolveMapDestructibleHudState` in den HUD-Zustand, und `MapDestructibleStatusText.js` liest es. Test: `tests/map-destructible-hud.contract.test.mjs`. Prüfe, dass die Projektion in `MatchRuntimeProjectionContract.js` das Feld mitnimmt — sonst kommt es am Spieler-HUD nicht an.

**7b — Neue Segmentart.** Siehe Phase 1. Denke an beide Verwerfungsstellen (Normalisierer, Netz-Ereignisse) und an die Aufzählung der Arten im Test.

**7c — Mehrere Bauwerke pro Karte.** Heute ist `sealed` ein Schalter pro Karte. Erweiterung: Segmente bekommen ein optionales Feld `structure` (Rückfall: eine Struktur), `state.sealed` wird zu einer Liste versiegelter Strukturen, `applyMapDestructibleDamage` prüft die Struktur des getroffenen Segments, `serialize`/`applyNetworkState` tragen die Liste, und das HUD nennt die Struktur unter Feuer. `collapseScenePieces` bleibt, weil Stücke ohnehin pro Karte eindeutig sind — nenne sie dann `<struktur>_<stück>`.

**7d — Kettenreaktion.** „Fällt der Turm auf die Brücke, bricht die Brücke." Das ist ein zweites Ereignis, das aus einem Ereignis folgt, zeitversetzt. Der richtige Ort ist der Contract, nicht der Controller: eine Szene darf `follow: [{ segmentId, afterSeconds }]` tragen; `applyMapDestructibleDamage` erzeugt daraus ein weiteres Ereignis mit `atSeconds + afterSeconds`, und die Zeitleiste bleibt rein aus Ereignissen ableitbar. **Nie** im `MapBreakSceneController` einen Timer setzen — der läuft auf dem Replikat ohne Ereignis, und die beiden Türme laufen auseinander.

**7e — Trümmer verletzen.** Das gibt es schon: Aus jedem bewegten Mesh entsteht ein dynamischer Kollider, und die Hunt-Wandkollision kostet 120 Schaden. Nichts zu bauen, aber im Desktop-Beleg zeigen (Phase 9: Bodensonden auf der Falllinie finden nach dem Sturz `piece_`-Meshes).

**7f — Bots zielen auf das Bauwerk.** Offen seit dem Turm. Der Einstiegspunkt ist die Bot-Zielwahl, nicht der Contract; wenn du das anfasst, ist es eine Aufgabe für `src/entities/Bot.js` mit den Clustern `physics-hunt` und `gameplay-smoke`.

**7g — Mehrstufiger Schaden am selben Segment** („beschädigt → geborsten → gefallen" mit sichtbaren Zwischenstufen). Heute gibt es nur intakt/gefallen; Zwischenstufen wären zusätzliche `hiddenUntilTriggered`-Modelle, die an Schwellen des `hp`-Verhältnisses ein- und ausgeblendet werden. Das braucht ein Ereignis pro Schwelle (sonst sieht das Replikat es nicht) und ist die aufwendigste Erweiterung. Erst dann, wenn eine Karte sie wirklich verlangt.

**7h — Folgen eines Bruchs jenseits der Szene** (Druckwelle, Blitz, Fallout). `MapDestructibleSystem._onSegmentDestroyed` ruft `owner.onMapDestructibleBreak(event, { sourcePlayer, cause })` auf — der `EntityManager` implementiert diese Naht heute **nicht**, sie wartet genau auf so etwas. Die Daten gehören in den Contract (`breakScenes[].blast: { radius, damage, delaySeconds }`, normalisiert und gekappt), die Wirkung in den Host: Radialschaden an Spielern mit einer eigenen Ursache `BLAST`, die in `ENVIRONMENT_KILL_CAUSES` (`src/hunt/EnvironmentKillCreditOps.js`) eingetragen wird, damit der Schütze den Kill gutgeschrieben bekommt wie bei Wand und Spur. Das Replikat erfährt davon über den Spielerzustand, nicht über eine neue Nachricht. Siehe den Atompilz-Abschnitt unten für den vollständigen Fall.

## Sonderfall Atompilz — ein Ereignis-Effekt statt eines Sturzes

Ein Atompilz fällt nicht, er steigt. In den Begriffen der Maschinerie ist er trotzdem eine Bruchszene: ein verstecktes Modell mit einem einmaligen Clip, ausgelöst durch den Bruch eines Segments. Was sich ändert, ist die Richtung (keine), die Kollision (keine) und die Herkunft der Animation (Kurven statt Bullet). Die Eine-Regel oben betrifft *fallende Körper*; eine Wolke darf von Hand animiert sein, aber aus Kurven, nicht aus Gefühl.

**Die Karte dazu.** Als eine der neuen Karten bietet sich ein Reaktorgelände an, weil es beides zeigt: Kühltürme, die nach dem Turm-Muster gebacken auf ihre Seite fallen, und ein Reaktorblock, dessen Bruch den Pilz zündet. Bruchplan in Kurzform:

| Segment | Art | Stück | Szene | Bemerkung |
| --- | --- | --- | --- | --- |
| `cooling_tower_w`, `cooling_tower_e` | `leg_mid` | `tower_w`, `tower_e` | je eine gebackene Sturzszene | fallen zur eigenen Seite, versiegeln nicht |
| `reactor_dome` | `leg_lower` | `reactor` | `mushroom_cloud` | versiegelt: nach dem Pilz bricht nichts mehr |

Die Kuppel als `leg_lower` ist die Entscheidung, dass der Pilz das Finale ist. Sollen die Türme *danach* noch fallen dürfen, ist die Kuppel ein `summit` (fällt „in Schussrichtung" — irrelevant, weil die Szene sich nicht dreht) und nichts versiegelt.

**Die Szene.** `yawFromEvent: false` im `breakScenes`-Eintrag — der Contract kennt das Feld, die Laufzeit dreht die Szene dann nicht, und `bakedHeading` ist bedeutungslos (das Prüfskript überspringt Richtungs- und Feldprüfung für solche Szenen). Im GLB:

- Ein Rig `piece_reactor` mit **allen** Meshes darunter: Stiel, Kappe, Bodenring und die Ruine des Reaktorblocks. Die Ruine bekommt Kollision (kein `_nocol`), braucht deshalb einen Keyframe — ein konstanter genügt. Wolkenmeshes heißen `cloud_stem_nocol`, `cloud_cap_nocol`, `cloud_ring_nocol`: Eine Wolke ist keine Wand, und ohne `_nocol` würde die Laufzeit aus jedem bewegten Mesh einen dynamischen Kollider bauen — ein Schiff würde an der Kappe zerschellen.
- Kurven statt Simulation: Position (Aufstieg) und Skalierung (Ausdehnung) als Keyframes auf Stiel, Kappe und Ring. Der Treiber (`GlbAnimationDriver`, Three.js-Mixer) spielt alle drei Transformkanäle. Anhaltspunkte in echtem Maßstab: die Kappe steigt in den ersten Sekunden schnell und flacht ab (Höhe etwa proportional zur Wurzel der Zeit), der Bodenring wächst gleichmäßig; nach 40 bis 60 s hält der Clip die Endpose. Kein Material-Fading — glTF animiert keine Materialien; die Wolke endet gehalten oder wächst über `fog.far` hinaus, wo sie im Nebel versinkt.
- Materialien gegen das Tone Mapping (Memory-Notiz `leuchtende-materialien-gegen-tonemapping`): dunkle Grundfarbe, Emission unter 2, sonst reißt der Himmel auf. Das Rig nie rotieren.
- `hideModelIds`: der intakte Reaktorblock. `pieces: ['reactor']`. Slot-Höhe = Unterseite des Reaktorblocks, wie bei jeder Szene.

**Druckwelle, Blitz, Fallout** sind nicht Teil der Szene, sondern Folgen des Ereignisses (Erweiterung 7h):

- *Druckwelle*: `blast: { radius, damage, delaySeconds }` an der Szene; der Host wendet den Schaden zur Kartenuhr `atSeconds + delaySeconds` an. Todeskredit an den Schützen über `EnvironmentKillCreditOps`.
- *Blitz*: ein HUD-Overlay in `src/ui`, gespeist aus der Projektion (`MatchRuntimeProjectionContract` trägt heute `breakingSecondsRemaining`; ein `flashSeconds` daneben ist der kleine Weg). Kein DOM außerhalb `src/ui`, kein Zugriff der UI auf `core`.
- *Fallout*: `GlobalFogEffectSystem.activate()` gibt es bereits, netzsynchron, mit fester Dauer aus `GlobalFogEffectContract` — der billige Weg. Dauerhafte Zonen mit Schaden wären `mapHazards` (`MapHazardContract`), die heute ab Rundenstart stehen; „Zone erst nach Ereignis aktiv" wäre eine eigene Contract-Erweiterung.

**Tests.** Der Asset-Test einer Wolke prüft anderes als der eines Sturzes: alle Wolkenmeshes `_nocol`, die Ruine unter dem Rig, Skalierung monoton bis zur gehaltenen Endpose, kein Sprung pro Bild, Dreiecksbudget, Clip ≤ 60 s. Der Preset-Test hält `yawFromEvent: false`, die Slot-Höhe und die Kuppel in `hideModelIds` fest. Der Desktop-Beleg zeigt: nach dem Bruch ist die Szene sichtbar, die Kolliderzahl der Arena ist um genau die Ruine gewachsen und um nichts aus der Wolke, das HUD meldet, und (mit 7h) ein Spieler im Radius verliert die erwartete Zahl Leben zur erwarteten Sekunde.

## Sonderfall Tyrannosaurus rex — ein bewegliches Ziel

Ein T-Rex ist kein Bauwerk, aber die Maschinerie kann ihn tragen, solange drei Dinge auseinandergehalten werden: seine *Bewegung* (eine Maschine wie die Eiffel-Aufzüge), seine *Treffbarkeit* (Segmente) und sein *Tod* (eine Bruchszene). Was sie nicht kann, ist Verhalten: ein T-Rex, der Spieler jagt, ist eine Entität mit eigener Zielwahl wie ein Bot, kein Kartenteil — das wäre eine Aufgabe in `src/entities` und nicht in diesem Skill.

**Bewegung.** Ein eigenes GLB mit einer Schleife (Gehen, Stampfen, Brüllen) unter dem normalen Uhrmodus der Maschinen: Die Pose folgt der Kartenuhr, deshalb zeigen Host und Replikat dieselbe Pose ohne Nachricht. Jedes Mesh, das die Schleife bewegt, bekommt automatisch einen dynamischen Kollider — ein Schiff, das den Schwanz berührt, stirbt an der Hunt-Wandkollision (120 Schaden). Das ist gewollt und braucht nichts Neues; Kill-Gutschrift an einen Schützen gibt es dabei nicht, weil niemand den Tod erzwungen hat. Meshes, die nicht töten sollen (Zähne als Zierwerk, Schatten-Platten), heißen `_nocol`.

**Treffbarkeit.** Segmente `trex_head`, `trex_body`, `trex_tail` mit *eindeutigen* Präfixen. Anker sind dann unnötig, weil kein Segment den Namen eines anderen teilt — und das ist wichtig: Die Ankerauflösung misst gegen *feste* Punkte, ein laufendes Tier hat keine. Arten: Kopf als `leg_lower` (der tödliche Treffer, versiegelt das Tier), Körper und Schwanz als `summit` (bluten, fallen nicht) oder als eigene Art „verwundet" (Phase 1, wenn Zwischenzustände gewünscht sind, 7g).

**Tod.** Eine Bruchszene `trex_fall` mit einem einmaligen Clip, `yawFromEvent: false` oder mit der Schussrichtung (`summit`-Regel), `hideModelIds` = das laufende Tier. Und hier liegt die eine echte Lücke: **Die Szene erscheint am Slot des Presets, das Tier steht aber irgendwo auf seiner Schleife.** Drei Wege, vom kleinsten zum größten:

1. *Fester Platz.* Der T-Rex bewegt sich auf der Stelle — stampft, dreht sich, brüllt — oder pendelt um einen Punkt so eng, dass die Sturzszene über diesem Punkt glaubwürdig bleibt. Kein neuer Code. Das ist die richtige erste Fassung.
2. *Schleife mit Rückkehr.* Die Gehschleife führt nach genau N Takten wieder durch den Startpunkt; die Szene startet nicht bei `atSeconds`, sondern beim nächsten Durchgang durch den Startpunkt. Das braucht ein Feld `startAtLoopPhase` an der Szene und eine kleine Änderung in `MapBreakSceneController._applyEntry`, deterministisch, weil die Phase aus `atSeconds` und der Schleifenlänge folgt. Der Spieler sieht das Tier noch ein paar Sekunden weiterlaufen, dann fällt es.
3. *Szene erbt die Pose der Maschine* (Erweiterung 7i). Beim Bruch wird die Transformation des Lauf-Rigs zur Kartenuhr `atSeconds` abgetastet und auf den Slot der Szene gelegt — Position und Yaw. Das ist deterministisch, weil die Schleife rein aus der Uhr folgt, und das Replikat kann dieselbe Abtastung machen. Die Daten gehören in den Contract (`breakScenes[].inheritPoseFrom: <modelId>`), die Abtastung in `ArenaGlbSceneOps`, und der Preset-Test belegt an einer festen Uhrzeit, dass beide Seiten dieselbe Pose berechnen. Erst dann läuft der T-Rex wirklich frei.

**Kettenreaktion.** Ein T-Rex, der durch den Turm läuft und ihn umwirft, ist 7d: die Bruchszene des Tiers trägt `follow: [{ segmentId: 'legs_lower_sw', afterSeconds: 3 }]`. Auch das ist nur Daten und Ereignisse, kein Timer im Controller.

**Blender.** Gehen und Sterben sind Kreaturanimationen, keine Simulation — hier ist Handanimation richtig, aber aus Referenz (Schrittlänge, Schrittfrequenz, Kopfhöhe in Metern), nicht aus Gefühl. Rig-Namen `piece_trex` in der Sturzszene wie bei jedem Stück; das gehende Tier ist eine Maschine und braucht kein `piece_`. Der Asset-Test prüft bei der Schleife, dass sie nahtlos schließt (letzter = erster Frame), beim Sturz das Übliche minus Vergrabung.

## Kartenideen, die in dieses Schema passen

| Karte | Bauwerk | Was fällt, was bleibt | Besonderheit |
| --- | --- | --- | --- |
| Reaktorgelände | zwei Kühltürme, ein Reaktorblock | Türme gebacken auf die Seite, Block zündet den Pilz | Atompilz, 7h |
| Hängebrücke | zwei Pylone, Fahrbahnfelder | Pylon → beide anliegenden Felder fallen | Stücke pro Feld, `piece` pro Segment |
| Burg | Mauerabschnitte, Bergfried | Mauer öffnet einen Weg, Bergfried versiegelt | zwei Bauwerke → 7c, wenn beide unabhängig sein sollen |
| Staudamm | Mauerfelder | Feld bricht → Flut als `_nocol`-Effekt + Nebel | Effekt-Szene wie beim Pilz, ohne Radialschaden |
| Urzeit-Ruine | T-Rex zwischen Säulen | Kopftreffer versiegelt das Tier, es fällt; Säulen gebacken | bewegliches Ziel, Weg 1 zuerst, dann 7i |

## Phase 8 — Netz

Der Zustand reist im Hunt-Zustandsblock (`mapDestructibles`) als vollständiger Ersatz: Ein Replikat rechnet keinen Schaden, es übernimmt den Zustand und leitet dieselbe Zeitleiste ab. Für eine neue Karte ist nichts zu tun. Für jede Erweiterung aus Phase 7 gilt: Neues Feld → `serializeMapDestructibleState` und `applyMapDestructibleNetworkState` → Rundweg-Test („serialize and apply round trip without loss"). Und in den fünf Dateien des Determinismus-Wächters sind `Date.now`, `Math.random`, `performance.now` verboten; Zeit ist immer die Kartenuhr (`glbAnimationElapsedSeconds`).

## Phase 9 — der Desktop-Beleg

`tests/<map-key-mit-bindestrichen>.desktop.spec.js` nach Vorlage von `tests/eiffel-tower-siege.desktop.spec.js`, eingetragen im Cluster `desktop-flows` in `scripts/playwright-test-clusters.mjs`. Vier Fragen, die nur die laufende App beantwortet, plus die Modus-Schranke:

1. **Was lädt**: Anzahl Slots und Clips, Szenen unsichtbar, keine Ladewarnungen.
2. **Treffer sind rückführbar**: Punktabfrage und Strahl auf das Bauwerk melden den Mesh-Namen; der Anker ordnet ihn dem richtigen Segment zu.
3. **Die Waffe bucht Schaden** über den echten Feuerweg (MG: 5 pro Pellet, `MAP_DESTRUCTIBLE_DAMAGE.MG`), und nur auf dem getroffenen Segment.
4. **Der Bruch wirkt**: versiegelt (falls Art versiegelt), blendet die intakten Slots aus, blendet die Szene ein, dreht sie auf die Ankerrichtung, HUD meldet — und nach N gesteppten Sekunden finden Bodensonden auf der Falllinie `piece_`-Meshes, wo vorher Luft war.
5. **Außerhalb des Modus** installiert dieselbe Karte keine Segmente.

Praktische Regeln aus den Memory-Notizen: Das Fenster muss sichtbar sein (verdeckt läuft die Schleife mit 1 fps), die Runde wird per `manager.update`-Schleife gesteppt, die Sekundenzahl richtet sich nach der längsten Szene (Turm: 52 s bei 50 s Clip), und `desktop-flows` verliert pro Lauf gern einen anderen Spec an ein Teardown-Timeout — einzeln nachfahren statt Cluster wiederholen. `desktop-proof` formuliert den Beleg für den Commit-Body.

## Phase 10 — Prüfumfang und Commit

`verify-scope` mit den eigenen Pfaden ergibt die Liste; für diese Kartenart läuft es meist auf Folgendes hinaus:

| Geändert | Pflicht |
| --- | --- |
| immer | `npm run lint`, `npm run test:contract:fast`, das Prüfskript aus Phase 5 |
| Preset, Modelle, `assets/maps/**` | `npm run test:desktop:smoke`, Cluster `desktop-flows` |
| Contract (Phase 7) | `npm run typecheck:contracts`, `npm run test:contract:coverage`, `npm run check:architecture` |
| `src/entities/**` (Treffer, Kollision) | Cluster `physics-core`, `physics-hunt`, `physics-policy` |
| Generator-Registrierung | `node --test tests/map-asset-jobs.contract.test.mjs` |
| HUD (`src/ui/**`) | Cluster `core-surface` |

Die Diagnostik-Cluster sind teilrot ohne eigenes Zutun; `failure-baseline` belegt das, bevor der Commit-Body „known pre-existing failures" schreibt. Dann `atomic-commit`: nur eigene Dateien stagen, die `.blend`-Quellen gehören dazu, und der Body nennt im `Why:` den Bruchplan (welche Segmente, welche Szenen, wohin) und in `Tests:` den Desktop-Beleg mit Zahlen.

Ein Sturz ist ein Commit. Bauwerk, Szenen, Preset und Beleg gehören zusammen — eine Karte, die im Katalog steht, aber deren Szenen noch nicht existieren, wäre im Picker wählbar und im Match kaputt. Wenn die Arbeit über mehrere Sitzungen geht, bleibt sie bis zum Beleg uncommittet; lege den Stand in einer Memory-Notiz ab, wie bei `eiffelturm-belagerung-plan`.

## Checkliste vor dem Commit

- [ ] Bruchplan steht als Kommentarkopf in `<Name>Destructibles.js`, mit Nutzerentscheidungen und Annahmen getrennt.
- [ ] Jedes Segment hat Art, `hp`, Label, Präfixe, Anker und (wo nötig) `piece`; keine Verwerfung im Prüfskript.
- [ ] Jede Szene: `hiddenUntilTriggered`, `once`, Clipname aus der Datei, `bakedHeading` gemessen, `pieces` = Rigs, `hideModelIds` vollständig, Slot-Höhe = ersetztes Teil.
- [ ] Feldgröße und Rückfall-Boden aus der berichteten Reichweite, nicht geschätzt.
- [ ] Pack an beiden Generatorseiten registriert, Zählungen im Jobs-Test angehoben.
- [ ] Asset-Test und Preset-Test grün; alle Zahlen darin mit Herkunft kommentiert.
- [ ] Erweiterungen aus Phase 7 als eigene Commits mit rotem Test zuerst.
- [ ] Desktop-Spec im Cluster `desktop-flows`, Beleg mit Zahlen im Commit-Body.
- [ ] `verify-scope` gelaufen, Alt-Fehler per `failure-baseline` belegt.

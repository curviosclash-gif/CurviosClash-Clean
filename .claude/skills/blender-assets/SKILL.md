---
name: blender-assets
description: Baut, ändert und prüft in diesem Repo Blender-Assets für CurviosClash — Kartenpacks unter assets/maps/<pack>/{blender,glb}, abgeleitete Packs, Kartenwelten, Prop-Familien, Pickups, Map-Units, Bäume und Pflanzen — mit deterministischem bpy-Generator, dem Dispatcher `npm run maps:generate`, den Namensmarkern des GLB-Loaders (_nocol, _colonly, _dyn, _foam, _noshadow), der Platzierung über Bounding Box und targetSize, Leucht- und Vertex-Farben gegen das Tone Mapping, Mehrfachansichten und einem Contract-Test, der die GLB-Dateien direkt liest. Nutze diesen Skill bei Formulierungen wie "in Blender bauen", "neues Modell", "GLB exportieren", "Karte aus Blender", "Prop", "Asset-Pack", "Generator-Skript", "bpy", "Modell neu backen", "Kollision im Modell", "leuchtet nicht", "Modell sitzt falsch auf der Karte", "Animation im GLB fehlt", "Dreiecke/Dateigröße zu hoch", und immer wenn eine Datei unter scripts/generate_*.py, scripts/*_common.py, assets/maps/**/blender, assets/maps/**/glb oder assets/models/** entsteht oder geändert wird. Für einstürzende Bauwerke, Bruchszenen, Atompilz oder T-Rex zusätzlich den Skill destructible-map laden; dieser Skill liefert dort die allgemeinen Blender- und Exportregeln.
---

# Blender-Assets für CurviosClash

Ein Blender-Asset ist hier erst fertig, wenn das **Spiel** es richtig lädt: richtige Stelle, richtige Größe, richtige Kollision, sichtbare Farben, laufende Animation, erträgliche Last. Ein schönes Bild aus Blender beweist davon nichts. Dieser Skill führt vom Auftrag bis zum Beleg und sagt, welche Regeln des Spiels Blender nicht kennt.

Er ist aus den Codex-Skills `blender-workflows` und `blender-object-batches` abgeleitet (dort allgemein gehalten) und auf die Pipeline dieses Repos zugeschnitten.

Zwei Begriffe vorab:

- **Generator** — ein Python-Skript (`scripts/generate_<name>_assets.py`), das Blender ohne Fenster startet, die Szene aus Code baut (`bpy` ist Blenders Python-Schnittstelle), eine `.blend`-Quelle speichert und das GLB exportiert. *Das Skript ist die Wahrheit, nicht die `.blend`.* Wer in der `.blend` von Hand nachbessert, verliert das beim nächsten Lauf.
- **GLB** — die binäre Form von glTF 2.0, dem Austauschformat, das three.js (die 3D-Bibliothek des Spiels, Version r186) lädt. Die `.blend` ist die Werkstatt, das GLB die Lieferung.

## Die Regeln, die nicht verhandelbar sind

1. **Deterministisch.** Jeder Zufall kommt aus `random.Random(<fester Seed>)`, nie aus `random.random()`. Zwei Läufe müssen dieselben Zahlen im Bericht liefern. Sonst lässt sich ein Fehler nicht nachstellen und jeder Neu-Export verändert die Karte unbemerkt.
2. **Kein Handeingriff in die `.blend`.** Änderungen gehen in den Generator. Ausnahme nur, wenn der Nutzer eine Szene ausdrücklich als Handarbeit bestimmt.
3. **Eingecheckte Packs nicht beiläufig neu backen.** Manche GLBs sind mit dem heutigen Generator nicht mehr reproduzierbar (z. B. `eiffel_tower/01_champ_de_mars.glb`). Vor jedem Lauf über ein fremdes Pack: `npm run maps:generate -- --map <key> --dry-run` und `git diff --stat assets/` nach dem Lauf. Unbeabsichtigt geänderte GLBs zurücksetzen, nicht committen.
4. **Nur Kern-glTF plus das, was three.js ohne Zusatzdecoder liest.** Das Spiel registriert **keinen** Draco-, Meshopt- oder KTX2-Decoder. Ein GLB mit `KHR_draco_mesh_compression`, `EXT_meshopt_compression` oder KTX2-Texturen lädt nicht. Das Prüfskript meldet das als FAIL.
5. **`.blend`-Quellen bleiben im Repo, landen aber nie im Build.** Der Build kopiert nur `.glb` (`dev/vite/productAssetCopyPlugin.js`), der Spiel-Export verbietet `blender/`-Ordner und `.blend` (`scripts/game-export-contract.mjs`). `*.blend1`-Sicherungen ignoriert git.

## Schritt 0 — Asset-Klasse bestimmen

Die Klasse entscheidet über Ablage, Aufruf und Vorlage. Details und Vorlagen je Klasse in [references/asset-classes.md](references/asset-classes.md).

| Klasse | Ablage | Aufruf | Vorlage |
| --- | --- | --- | --- |
| Kartenpack (Architektur + animierte Setpieces) | `assets/maps/<pack>/{blender,glb}/NN_<teil>` | Dispatcher `npm run maps:generate -- --map <key>` | `generate_eiffel_tower_assets.py`, `generate_chrono_forge_blender_assets.py` |
| Abgeleitetes Pack (nutzt Builder eines anderen) | wie oben, eigenes `<pack>` | Dispatcher, Modul setzt `BASE = <basis>` | `generate_notre_dame_fire_assets.py`, `generate_eiffel_tower_siege_assets.py` |
| Kartenwelt aus Preset-Daten | `assets/maps/<key>/glb/01_world.glb` | Dispatcher, Daten per stdin | `generate_map_world.py` + `scripts/map-world-source.mjs` |
| Zerstörbares Bauwerk / Bruchszene | Kartenpack | Dispatcher | **Skill destructible-map**, `scripts/blender_collapse.py` |
| Prop-Familie (mehrere Varianten) | `assets/maps/<pack>/props/…` oder `assets/models/<familie>/` | direkt `blender --background …` | `generate_falkenwacht_prop_asset.py`, `crystal_ruins_asset_common.py` |
| Pickups (eine Bibliothek) | `assets/items/{blender,glb}/pickup_library` | direkt | `generate_pickup_blender_assets.py` |
| Map-Units (Teile, Laufzeit setzt zusammen) | `assets/models/map_units/` | direkt | `generate_map_unit_blender_assets.py` |
| Bäume, Pflanzen, Pilze | `assets/models/<art>/` | direkt | `generate_ancient_tree_asset.py`, `generate_glowing_mushroom_assets.py` |

Passt nichts: Kartenpack, wenn es fest auf einer Karte steht; Prop-Familie, wenn es mehrfach platziert wird.

## Schritt 1 — Den Vertrag vor dem ersten Polygon festlegen

Schreib diese Punkte in den Kopf-Docstring des Generators (so machen es alle Generatoren im Repo, siehe `generate_map_unit_blender_assets.py`):

- **Einheiten und Maßstab**: 1 Blender-Einheit = 1 Spieleinheit *vor* `MAP_SCALE`. Karten wie Eiffelturm laufen mit Maßstab 3; die Laufzeit multipliziert Position und Größe.
- **Achsen**: Blender ist Z-oben, das Spiel Y-oben. Mit `export_yup=True` gilt: Blender X → Spiel X, Blender Z → Spiel Y (Höhe), Blender **−Y** → Spiel **+Z**. Ein Modell, das im Spiel nach +Z schaut, schaut in Blender nach −Y.
- **Platzierung**: Der Loader verschiebt jedes GLB so, dass die **Mitte der Bounding Box** in X/Z und ihr **Boden** in Y auf der Preset-Position liegt, und skaliert mit `targetSize` die größte Kante auf diesen Wert (`GLBMapLoader.js`, Funktion mit `glb-normalizer-`). Der Blender-Ursprung ist für die Platzierung also egal — die Bounding Box zählt. Ein einzelner verirrter Vertex verschiebt das ganze Modell.
- **Budgets**: Dreiecke, Draw Calls (≈ Primitive = Mesh × Material), Dateigröße. Richtwerte aus dem Repo: ein Setpiece ≤ 20 Primitive, ≤ 2 500 Dreiecke, ≤ 180 KiB (`tests/chrono-forge-blender-assets.contract.test.mjs`). Die Ziel-GPU ist eine Intel UHD 630 — Punktlichter, Transparenz und viele Einzelobjekte kosten dort am meisten.
- **Rollen**: was ist sichtbar, was kollidiert, was bewegt sich, was ist nur Deko.

## Schritt 2 — Generator bauen

Gerüst, das alle Generatoren teilen (Vorlage: `export_part` / `export_setpiece` in `scripts/generate_eiffel_tower_assets.py`):

```python
ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "<pack>" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "<pack>" / "glb"

def reset_scene(name, duration_seconds=0):
    bpy.ops.wm.read_factory_settings(use_empty=True)   # bekannter Startzustand
    ...                                                 # fps, frame_end, LINEAR-Keyframes
```

Die Modulvariablen `ROOT`, `SOURCE_DIR`, `GLB_DIR` **müssen** so heißen: der Dispatcher `scripts/generate_map_assets.py` biegt sie für `--output-dir` um. Teile stehen in Tupeln `ARCHITECTURE = (("01_hall", build_hall), …)` und `SETPIECES = (("05_gate", "GateLoop", 10, build_gate), …)`; der Dispatcher liest genau diese Namen.

Bauen von groß nach klein: Silhouette und Massen → Übergänge → Material → Detail. Kleinteile (Zierleisten, Nieten) als eigene Meshes mit `_noshadow_nocol`, damit sie weder Schatten noch Kollisionsflächen kosten.

**Neues Kartenpack registrieren — an beiden Stellen**: `BLENDER_ASSET_GENERATORS` in `scripts/map-asset-jobs.mjs` und `GENERATORS` in `scripts/generate_map_assets.py`; danach die Zählungen in `tests/map-asset-jobs.contract.test.mjs` anheben (das sind Zählungen, keine Ratchets). Assets unter `assets/models/<familie>/` brauchen zusätzlich einen Eintrag in `GLB_ONLY_MODEL_DIRS` oder `OBJ_ASSET_COPY_ENTRIES` in `dev/vite/productAssetCopyPlugin.js` — sonst fehlen sie im Build, obwohl der Test in Node grün ist.

## Schritt 3 — Namen sind die Schnittstelle zum Spiel

Der Loader liest Rollen aus **Mesh-Namen** (Groß-/Kleinschreibung egal, Teilstring genügt). Das ist der wichtigste Unterschied zu allgemeinen Blender-Regeln: hier gibt es keine eigenen Kollisionsobjekte mit Präfix `COLLIDER_`.

| Marker | Wirkung im Spiel |
| --- | --- |
| *(keiner)* | sichtbar **und** fest (Mesh-Kollision aus den gezeichneten Dreiecken) |
| `_nocol` | sichtbar, durchfliegbar |
| `_colonly` | unsichtbar, aber fest (grobe Kollisionshülle unter feiner Optik) |
| `_dyn` | Kollision folgt der Bewegung, auch ohne Animationsspur |
| `_foam` | weiche Kollision (`kind: 'foam'`) statt hart |
| `_noshadow` | wirft keinen Schatten (das Schattenbudget geht sonst an die größten Meshes) |

Weitere Namensregeln, Animationen, Materialien und Erweiterungen: [references/runtime-contract.md](references/runtime-contract.md). Kurz das Wichtigste:

- **Keine Punkte, Leerzeichen oder Umlaute in Node-Namen.** three.js säubert Namen (`PropertyBinding.sanitizeNodeName`: Leerzeichen → `_`, alles außer `[A-Za-z0-9_-]` fällt weg). Blenders `.001`-Endungen werden so zu `001`. Clips binden trotzdem (der Loader säubert beide Seiten gleich), aber Laufzeitcode, der ein Teil über seinen Blender-Namen sucht, findet es nicht mehr.
- **Ein Setpiece = genau ein Clip.** `export_animation_mode="SCENE"`, der Clip heißt wie die Szene; die Laufzeit spricht ihn über diesen Namen an.
- **Leuchtendes**: Grundfarbe fast schwarz, Emissionsfarbe mit **einem** dominanten Kanal, Stärke etwa 0,55–1,0 auf hellen Karten, höchstens 2. Sonst macht das Tone Mapping (die Helligkeitsanpassung des Renderers) daraus Weiß.
- **Vertex-Farben nur abdunkeln**, nie über 1,0: der Exporter schreibt sie als normierte 16-Bit-Zahl, 1,02 kommt als 0,02 (schwarz) wieder heraus.

## Schritt 4 — Export

Die Export-Argumente, die sich im Repo bewährt haben (Blender 4.2 LTS):

```python
bpy.ops.export_scene.gltf(
    filepath=str(glb_path), export_format="GLB",
    export_yup=True, export_apply=True, export_extras=True,
    export_cameras=False, export_lights=False,
    export_vertex_color="ACTIVE", export_all_vertex_colors=False,  # nur wenn Tints auf dem Mesh liegen
    export_animations=False,                                         # statisch
    # animiert: export_animations=True, export_animation_mode="SCENE",
    #           export_anim_scene_split_object=False, export_anim_slide_to_zero=True,
)
```

- `export_apply=True` wendet Modifikatoren an, **verträgt sich aber nicht mit Shape Keys** (Morph-Ziele). Für Morph-Animationen `export_apply=False` und die Modifikatoren vorher im Generator anwenden (so `generate_giant_dandelion_asset.py`).
- `export_lights=False`: Licht kommt aus dem Preset, nicht aus dem GLB.
- Exporter-Argumente ändern sich zwischen Blender-Versionen. Bei neuer Version erst einen Minimal-Export testen, nicht blind übernehmen.
- Nach jedem Teil druckt der Generator eine Zeile mit Dreiecken, Nodes, Mitte und Boden (Vorlage `report()` im Eiffel-Generator). Diese Zahlen gehören ins Preset.

Aufruf:

```bash
npm run maps:generate -- --map <key> --dry-run
```

```bash
npm run maps:generate -- --map <key> --part <teil>
```

Blender wird über `--blender`, `BLENDER_BIN` oder `C:\Program Files\Blender Foundation\*` gefunden (installiert: 4.2). Nicht-Kartenpacks direkt:

```bash
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_<name>.py -- <optionen>
```

`--python-exit-code 1` ist Pflicht: ohne das endet Blender bei einem Python-Fehler mit Code 0, und der Lauf sieht grün aus.

## Schritt 5 — Prüfen: Datei, Bild, Spiel

Drei Stufen, jede fängt andere Fehler:

1. **Datei** — das Prüfskript liest die GLBs direkt, ohne Blender:

   ```bash
   node .claude/skills/blender-assets/scripts/audit-glb.mjs assets/maps/<pack>/glb --max-triangles 20000 --max-kib 400
   ```

   Es meldet FAIL für nicht ladbare Erweiterungen, kaputte Dateien, fehlende Meshes, übergelaufene Vertex-Farben und Budgetüberschreitungen; WARN für Namen, die three.js verändert, BLEND-Transparenz, Emission über 2, helle Grundfarbe unter Leuchten, mehrere Clips und Kollision auf Kleinteilen. Warnungen sind Entscheidungen, keine Fehler: die Chrono-Forge-Kristalle leuchten bewusst mit 3. Es listet Clips mit Dauer, bewegte Meshes und Marker. `--json` für Maschinen.

2. **Bild** — Mehrfachansichten mit transparentem Hintergrund und gleichbleibender Kamera. Eine gute Vorderansicht beweist kein gutes Modell:

   ```bash
   blender assets/maps/<pack>/blender/<teil>.blend --background --python .claude/skills/blender-assets/scripts/render_views.py -- --output-dir <scratchpad>/views --views 8
   ```

   Bilder in den Scratchpad, **nie ins Repo**. Ansehen (Read-Werkzeug zeigt PNGs) und dem Nutzer mindestens eine Ansicht zeigen, wenn sich Material oder Form sichtbar geändert hat. Das Skript blendet `_colonly`-Hüllen aus und meldet das Silhouetten-Verhältnis (sehr dünn aus einer Richtung = flaches Modell).

3. **Spiel** — Contract-Test und Desktop-Beleg, siehe Schritt 6.

**Volumen-Licht backen (Rauch, Nebel) nur in Cycles.** EEVEE (4.2) rechnet Volumenschatten in einem an der Kamera ausgerichteten Gitter; Licht quer zur Blickrichtung kommt dort nicht an (Seitenlicht im Rauch-Bake lag bei 0,002 statt ~0,38). Vorbild: `scripts/bake_reactor_smoke.py`, sechs Sonnenrichtungen je Kachel, Dichte-Rauschen zwischen Durchgängen mitteln.

Ob etwas **leuchtet**, lässt sich an der Datei nicht messen (die Datei kennt keine Verdeckung). Beleg: dieselbe Ansicht im Spiel zweimal rendern, mit und ohne Emission, und vergleichen (Vorbild `tests/mushroom-proof.desktop.spec.js`).

## Schritt 6 — Contract-Test und Pflichtprüfung

Jedes Pack bekommt `tests/<pack-mit-bindestrichen>-blender-assets.contract.test.mjs`. Vorlage: `tests/chrono-forge-blender-assets.contract.test.mjs`. Er liest die eingecheckten GLBs, braucht also kein Blender, und prüft mindestens:

- `.blend` und GLB existieren, GLB nicht leer, Größe unter Budget;
- genau ein Clip pro Setpiece mit der gewollten Dauer (±1/30 s);
- keine `_nocol` auf Meshes, die fest sein müssen;
- **mit dem echten Loader** (`loadGLBMap` + `geometryOnlyGlbLoader` aus `tests/helpers/`): Bounding Box, Kollidernamen und bei Bewegung die Kollision über den ganzen Clip (Frame für Frame abtasten, nicht nur Anfang und Ende).

`geometryOnlyGlbLoader` wirft Materialien weg. Farbe und Emission prüft der Test deshalb am GLB-JSON selbst (`baseColorFactor`, `emissiveFactor × emissive_strength`, `COLOR_0`), nicht über den geladenen Szenengraphen.

Danach die Pflichtprüfung aus `CLAUDE.md` (Skill **verify-scope**): mindestens `npm run lint`, `npm run test:contract:fast`, der neue Test vorher nachweislich rot. Für Karten-GLBs und Map-Presets nennt die Tabelle zusätzlich `npm run test:desktop:smoke` und Cluster `desktop-flows` (Stufe 2 gezielt, Stufe 3 nur in der Hauptsitzung). Beleg im Spiel über Skill **desktop-proof**. Commit über Skill **atomic-commit**: `.blend` + `.glb` + Generator + Preset + Test in einem Commit, nur die eigenen Dateien.

## Schritt 7 — Bericht an den Nutzer

Kurz und in Zahlen: welche Dateien entstanden, Dreiecke und Größe je GLB, Clips mit Dauer, welche Meshes kollidieren, welche Prüfungen liefen (mit Ergebnis), eine Vorschau. Offene Grenzen ausdrücklich nennen („leuchtet in der Datei, im Spiel noch nicht belegt").

## Lernschleife

Vor der Schlussantwort eine Frage: *Gab es in dieser Aufgabe eine belegte, wiederverwendbare Lehre, die hier fehlt?* (Beispiel: ein Exporter-Argument, das in einer neuen Blender-Version anders heißt.) Wenn ja, die kleinste zuständige Stelle ergänzen — eine Zeile hier, in einer Referenz oder eine Prüfung im Skript — und das dem Nutzer sagen. Wenn nein, nichts ändern. Vermutungen gehören nicht in den Skill.

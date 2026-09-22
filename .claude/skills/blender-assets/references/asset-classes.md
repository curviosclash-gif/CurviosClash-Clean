# Asset-Klassen: Ablage, Vorlage, Besonderheiten

Lies nur den Abschnitt der Klasse, die du baust.

## Kartenpack

- Ablage `assets/maps/<pack>/blender/NN_<teil>.blend` und `assets/maps/<pack>/glb/NN_<teil>.glb`. Die Nummer ordnet, der Teil nach dem ersten `_` ist der Name, den `canvas.emit(...)` bzw. der Preset verwendet.
- Der Build kopiert jedes `assets/maps/*/glb` und `assets/maps/*/props` automatisch.
- Registrierung an zwei Stellen (`scripts/map-asset-jobs.mjs`, `scripts/generate_map_assets.py`) plus Zählungen in `tests/map-asset-jobs.contract.test.mjs`. Der Job-Resolver leitet das Pack aus den `glbModels`-URLs der Karte ab (`^assets/maps/<pack>/glb/<teil>.glb$`) — kleine Buchstaben, Ziffern, `_`.
- Statische Architektur bekommt Umgebungsverdeckung (Ambient Occlusion) als Vertex-Farbe gebacken (`bake_ambient_occlusion` im Eiffel-Generator); bewegte Setpieces nicht, weil sich ihre Verschattung mit jeder Pose ändert.
- Vorlagen: `generate_eiffel_tower_assets.py` (Architektur + Setpieces), `generate_chrono_forge_blender_assets.py` (nur Setpieces), `generate_reactor_site_assets.py` (großes Pack mit Props und Rauch).

## Abgeleitetes Pack

Eine Variante einer bestehenden Karte (brennende Notre-Dame, Eiffel-Belagerung). Das Modul importiert das Basismodul als `BASE`, ruft dessen Builder und exportiert über dessen `export_part`/`export_setpiece`. Der Dispatcher setzt `BASE.ROOT` mit um, damit `--output-dir` nicht neben die Originale schreibt. Nur tauschen, was sich wirklich ändert; der Rest bleibt Import. Licht in Presets bewusst kopieren statt importieren, damit sich die alte Karte frei ändern kann.

## Kartenwelt aus Preset-Daten

`generate_map_world.py` baut Boden, Wände und Hindernisse einer Karte aus den Preset-Daten, die `scripts/map-world-source.mjs` per stdin liefert. Nur Teil `01_world`. Nach Änderungen an Parcours-Karten `npm run check:parcours`, und bei Ring-Karten die Welt neu erzeugen, sonst misst der Wächter den alten Stand.

## Zerstörbares Bauwerk

Immer zusammen mit dem Skill **destructible-map**. Dort: Bruchplan, `piece_<id>`-Rigs, `blender_collapse.py`, Anker und `bakedHeading`, Audit-Skript. Von hier gelten Namen, Export und Prüfung.

## Prop-Familie (Varianten eines Objekts)

Mehrere Varianten aus **einem** Vertrag statt einzeln beschrieben — Vorgehen nach dem Codex-Skill `blender-object-batches`, im Repo schon umgesetzt:

- Ein gemeinsames Modul mit `build_variant(context)` (z. B. `crystal_ruins_asset_common.py`), dünne Einstiegsskripte je Familie (`generate_crystal_ruins_broken_arches.py`, 14 Zeilen).
- Seed je Variante aus `context["seed"]`; Varianten-IDs und Seeds bleiben bei Überarbeitungen gleich, damit nur betroffene Varianten neu entstehen.
- Standard: zehn Varianten, außer der Nutzer sagt anderes. Variante 1 ist die kanonische; bei unsicherer Form erst sie bauen, zeigen, dann den Rest.
- Manifeste und Prüfberichte nicht ins Repo (AGENTS.md: keine generierten Prozessberichte) — in den Scratchpad oder `%TEMP%`.
- Ein Kontaktbogen (alle Varianten in einem Bild) ersetzt zehn Einzelbilder; Vorbild `scripts/render_eiffel_historic_prop_contact_sheet.py`.
- Statische Props: keine Kameras, keine Lichter, keine Animation — `crystal_ruins_asset_common.py` bricht dann ab.

## Pickups

Eine Bibliothek `assets/items/{blender,glb}/pickup_library.*` für alle Item-Typen. Farben und Grundgrößen (`COLORS`, `SEMANTIC_BASELINES`) sind an die Item-IDs gebunden; ein neues Item braucht Einträge dort **und** in `src/entities/powerup/PowerupVisualCatalog.js`. Prüfung: `tests/pickup-blender-assets.contract.test.mjs` und `tests/pickup-blender.desktop.spec.js`. Pickups sind die größte Menge gleichzeitig sichtbarer Objekte (bis 100) — Dreiecke und Materialien hier besonders knapp halten.

## Map-Units (Panzer usw.)

Eine Teilebibliothek, kein fertiges Fahrzeug: die Laufzeit setzt die Einheit aus benannten Nodes zusammen, damit der Turm sich unabhängig drehen kann. Alles im Bodenraum (Ursprung = Standpunkt), Maße folgen dem Box-Modell, das es ersetzt (Trefferradius, Turmhöhe, Lebensbalken). Laufzeit: `src/entities/systems/map-units/MapUnitModelCache.js`. Node-Namen sind API — umbenennen heißt Laufzeit ändern.

## Bäume, Pflanzen, Pilze

Vorlagen `generate_ancient_tree_asset.py` (+ `_variants.py`), `generate_giant_dandelion_asset.py`, `generate_glowing_mushroom_assets.py`, `generate_verdant_wildwuchs.py`. Regeln:

- Drei Dateien je Variante, wenn sie auf einer Karte kollidieren: Ansicht (`_lod1`/`_lod2`) und grobe Hülle (`_collision.glb`, auf der Karte mit `collisionOnly: true`). Ohne Hülle ist der Baum durchfliegbar.
- Blätter `MASK`, nicht `BLEND`; `doubleSided` bewusst setzen.
- Morph-Animation (Wiegen) nur mit `export_apply=False` und vorher angewendeten Modifikatoren. Morph-Ziele verdoppeln die Vertexdaten — Dateigröße prüfen.
- Die Codex-Skills `blender-trees` und `blender-plants` enthalten botanische Regeln (Verzweigung, Arten-Profile). Bei einer neuen Art dort nachlesen: `C:\Users\Gunda Bluecher\.codex\skills\blender-trees\references\`, `…\blender-plants\references\`.

## Fahrzeuge

Fahrzeuge entstehen im Vehicle-Lab (`prototypes/vehicle-lab/`), nicht per Blender-Generator. Wer trotzdem ein Fahrzeug in Blender baut: `src/entities/obj-vehicle-mesh.js` normiert die größte Kante auf 4,5; die Fahrtrichtung vorher an einem bestehenden Fahrzeug im Spiel nachmessen, nicht annehmen.

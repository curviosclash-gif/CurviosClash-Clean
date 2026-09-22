# Laufzeitvertrag: was das Spiel aus einem GLB liest

Lies das vor jedem Export und immer, wenn ein Modell im Spiel anders aussieht, sitzt oder kollidiert als in Blender. Quelle der Wahrheit ist der Code; die Zeilen hier sagen, wo man nachsieht.

## Laden und Platzieren (`src/entities/GLBMapLoader.js`)

- Eine Karte nennt ihre Modelle in `glbModels: [{ id, url, position, rotation, scale | targetSize, collision, collisionOnly, hiddenUntilTriggered, maxRenderDistance, scaleAuthoredAnchors }]`. Erlaubte URLs prüft `normalizeAllowedGLBUrl` (`src/entities/mapSchema/MapSchemaGlbOps.js`).
- **Verschiebung**: Das Modell wird um `(-mitte.x, -boden.y, -mitte.z)` seiner eigenen Bounding Box versetzt. Die Preset-Position ist also *Mitte unten* des Modells, nicht der Blender-Ursprung.
- **Größe**: `targetSize > 0` skaliert die **größte** Kante auf diesen Wert; sonst gilt `scale`. Beides wird mit dem Kartenmaßstab multipliziert.
- **Folge**: Ein Hilfsobjekt, ein vergessener Vertex oder ein weit ausschwingender Animationsteil im Ruhebild vergrößert die Box und verschiebt oder verkleinert das ganze Modell. Der Generator druckt Mitte und Boden je Teil; diese Zahlen sind die Preset-Position.
- **Wurzel-Meshes ohne Rig nicht drehen**, wenn ein Generator sie später zusammenführt: eine Neigung von 0,7 rad machte aus einem 10 m breiten Glutbett eine 105 m breite Box.
- `maxRenderDistance` blendet das Modell über eine `THREE.LOD` ab dieser Entfernung aus — billig für Deko weit außen.
- Unveränderte Modelle mit `collision: false` oder `collisionOnly: true` werden geklont statt neu geladen (ein Wald aus hundert Bäumen kostet so eine Datei).

## Kollision

- Standardmodus `glbColliderMode: 'scene'`: jedes gezeichnete Mesh ohne `_nocol` wird Mesh-Kollision aus seinen Dreiecken. `'dynamic'`: nur bewegte Meshes kollidieren, die Karte behält ihre Box-Hindernisse. `'fallbackOnly'`: nur die Box-Hindernisse der Karte („Box-Collider" im Ladehinweis), das GLB ist reine Optik.
- Bewegt gilt ein Mesh, wenn eine Transform-Spur (translation/rotation/scale) es **oder einen Vorfahren** bewegt, wenn es `_dyn` trägt oder in einem `hiddenUntilTriggered`-Modell liegt. Morph- und Materialspuren machen ein Mesh *nicht* bewegt.
- Ein bewegtes Mesh, das sich nicht verfolgen lässt (Skinning, entartet), bekommt **gar keine** Kollision.
- Kollision kommt nur von gezeichneten Flächen: Rippen oder Gewölbe mit `_nocol` sind durchfliegbar, auch wenn sie massiv aussehen. Für feine Optik mit grober Hülle: Optik `_nocol`, Hülle `_colonly`.
- Parcours-Karten: Ringe dürfen nicht in Kollisionsgeometrie stecken — `npm run check:parcours`.

## Namen

- three.js ersetzt in Node-Namen Leerzeichen durch `_` und entfernt alles außer `[A-Za-z0-9_-]`; der Originalname steht danach in `userData.name`. Punkte (`gate.001`), Umlaute und Sonderzeichen deshalb schon in Blender vermeiden. [three.js #12956](https://github.com/mrdoob/three.js/issues/12956)
- Marker (`_nocol` usw.) wirken als Teilstring irgendwo im Namen, ohne Rücksicht auf Groß-/Kleinschreibung. Ein Name wie `fanocollar` löst `_nocol` nicht aus, `pipe_nocolumn` aber schon — Marker ans Ende setzen und keine Wortteile verwenden, die zufällig passen.
- Präfixe, über die Laufzeitcode Teile findet (Segmente zerstörbarer Bauwerke, Map-Unit-Teile, `sandstorm_beacon_`), dürfen nichts Fremdes miterfassen: `shaft_` hätte `shaft_lift_*` erwischt, deshalb heißt es `shaft_iron`.
- Benutzerdefinierte Eigenschaften in Blender werden mit `export_extras=True` zu glTF-`extras` und landen in `userData`. Bei gleichzeitigen Node- und Mesh-Extras überschreiben die Node-Extras die des Meshes ([three.js #15728](https://github.com/mrdoob/three.js/issues/15728)).

## Animation

- Kern-glTF bewegt nur Nodes (Position, Drehung, Skalierung), Knochen und Morph-Gewichte. Material-, Licht-, Physik-, Modifikator- und Geometry-Nodes-Animation wird **nicht** exportiert — in Transform-Keyframes backen.
- Setpieces: ein Clip, `export_animation_mode="SCENE"`, `export_anim_scene_split_object=False`, `export_anim_slide_to_zero=True`, Keyframes `LINEAR`, 30 fps. Nahtlose Schleife: letzter Frame = erster Frame. Die Laufzeit (`GlbAnimationDriver`) legt Wiedergabe, Schleife und Tempo fest, nicht das GLB.
- Physik (Rigid Body) wird nicht exportiert: simulieren, dann in Keyframes backen (`scripts/blender_collapse.py`). Blender nimmt den **Objektursprung als Schwerpunkt** — Rigs an den berechneten Schwerpunkt, Meshdaten relativ dazu.
- In NLA-Modus gilt: Spuren gleichen Namens auf verschiedenen Objekten werden **ein** Clip. [Blender-glTF-Doku](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst)
- Blender 4.4 hat „Slotted Actions" eingeführt und das Exportverhalten von Aktionen geändert. Wer über 4.2 hinausgeht, prüft die Clip-Zahl im exportierten GLB, nicht in Blender.
- Nicht behaupten, dass Animation existiert, weil Keyframes in der `.blend` stehen — im GLB nachzählen (Prüfskript listet Clips und Dauer).

## Materialien und Farbe

- Nur **Principled BSDF** mit direkt angeschlossenen Werten oder Bildtexturen wird übersetzt; andere Knoten fallen still weg. Prozedurale Muster in Vertex-Farben oder Texturen backen.
- Farbe muss im GLB stehen: `baseColorFactor`, `baseColorTexture` oder `COLOR_0`. Eine bunte Viewport-Farbe in Blender beweist nichts.
- **Vertex-Farben** (`COLOR_0`): Das Repo schreibt Tints direkt aufs Mesh und exportiert mit `export_vertex_color="ACTIVE"`; glTF multipliziert sie auf die Grundfarbe. Nur abdunkeln: Werte über 1,0 laufen als normierte Ganzzahl über (1,02 → 0,02). Dunkelster legitimer Wert laut `tests/map-vertex-colors.contract.test.mjs`: 0,18. Neutrale (weiße) Vertex-Farben weglassen (`prune_neutral_vertex_colors` im Eiffel-Generator), sie kosten nur Speicher.
- **Emission**: Der Exporter schreibt `KHR_materials_emissive_strength` nur, wenn ein Kanal über 1,0 läge; darunter wird die Stärke in die Farbe gefaltet. Tests messen deshalb **Farbe × Stärke**. Gute Werte: Grundfarbe ≈ (0,06, 0,025, 0,012), ein dominanter Emissionskanal, wirksame Stärke 0,55–1,0 auf hellen Karten, nie über 2.
- **Nebel** wirkt nach dem Tone Mapping; Himmelskuppeln bleiben `toneMapped: false`. Sichtweite ist klein gegen große Karten (200 Einheiten gegen 1380 bei Notre-Dame) — sehr große Modelle verschwinden im Nebel, Detail dort ist verschenkt.
- Transparenz: `OPAQUE` für Festes, `MASK` für Blätter und Gitter (keine Sortierfehler), `BLEND` nur wenn Halbtransparenz nötig ist. Durchsichtige Meshes werfen im Spiel keine Schatten. Glas mit Transmission ist auf der iGPU teuer.

## Erweiterungen

three.js r186 `GLTFLoader` liest ohne Zusatz u. a.: `KHR_materials_emissive_strength`, `…_transmission`, `…_ior`, `…_specular`, `…_clearcoat`, `…_unlit`, `…_volume`, `KHR_texture_transform`, `KHR_mesh_quantization`, `EXT_mesh_gpu_instancing`, `EXT_texture_webp`. Einen Decoder bräuchten `KHR_draco_mesh_compression`, `EXT_meshopt_compression` und KTX2 (`KHR_texture_basisu`) — im Spiel ist keiner registriert (`src/` enthält weder `DRACOLoader` noch `setMeshoptDecoder`). Solche Dateien laden nicht. [three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)

Instancing wurde für Power-ups gemessen und verworfen: −25 % Draw Calls, aber −4 % FPS auf der UHD 630, weil das Culling pro Objekt entfällt. `EXT_mesh_gpu_instancing` also nicht aus Gewohnheit einschalten.

## Quellen

- [Blender glTF-2.0-Exporter, Doku im Khronos-Repo](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst)
- [Blender-Handbuch 4.2, glTF 2.0](https://docs.blender.org/manual/en/4.2/addons/import_export/scene_gltf2.html)
- [Blender-Handbuch, Kommandozeilenargumente](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html)
- [Khronos glTF-2.0-Spezifikation](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)

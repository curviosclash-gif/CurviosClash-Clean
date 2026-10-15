# Kirschhain: Export und Laufzeitdateien

Die Blender-Autoren und editierbaren Szenen bleiben die Quellen. Nach einem erneuten
Export mit `scripts/generate_cherry_grove_assets.py` folgt im Repository:

```powershell
node scripts/compress-cherry-grove-glb.mjs
```

Der Packschritt komprimiert nur eine Indexliste von Akebono 01 mit
`EXT_meshopt_compression` im Modus `INDICES`. Er verändert weder Indexreihenfolge
noch Positionen, Materialien, Hierarchie oder Windanker. Vor dem Schreiben
vergleicht er sämtliche dekodierten Buffer-Views und semantischen Modellfelder.
Ein erneuter Aufruf auf der gepackten Datei ist wirkungslos.

Der Kartenlader verwendet den mit Three.js gelieferten Meshopt-Decoder.
`scripts/validate_cherry_grove_assets.py` dekodiert die Laufzeitdatei bei Bedarf
für den Blender-Roundtrip in ein temporäres GLB. Die Prüfungen bleiben dieselben.

Nach Export und Packschritt die Asset-QA mit dem vorhandenen Blender-Validator
erneuern. Anschließend mindestens `cherry-grove-compression`, `cherry-grove`,
`cherry-grove-giant`, `map-glb-budget` und `map-picker-meta` prüfen sowie die Karte
im Desktop laden. Ladebudget und Darstellungsqualität bleiben unverändert.

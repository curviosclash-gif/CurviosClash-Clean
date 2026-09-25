# Prunus × yedoensis 'Akebono'

Deterministischer, editierbarer Frühlingsbaum, erzeugt mit Blender 4.2.16 LTS. Die Geometrie verwendet Haupttrieb, fünf asymmetrische Gerüstäste, hierarchisch verjüngte Sekundär- bis Feinverzweigung, einzelne horizontale Lentizellen und konsolidierte 3D-Blüten mit fünf leicht gekerbten Blütenblättern, Kelch und Staubblättern. Zarte junge Blätter bleiben selten. Samen: Wachstum `270425`, Blütenverteilung `811907`.

Die Vollansicht zeigt eine dichte, stilisierte Blüte ohne rosa Kugel- oder Blob-Cluster. Die Äste und Blüten sind echte, konsolidierte Mesh-Geometrie. Die Baumkrone bleibt zwischen den Branch-Gruppen sichtbar offen und erfüllt den vereinbarten 55%-Blütenmasken-Richtwert nicht: Der Pink-Anteil innerhalb der Baum-Silhouette liegt über acht Azimute im Mittel bei 38,13%, im schlechtesten Blick bei 18,45%; nur 135° erreicht mit 54,07% annähernd den Richtwert. Die zusätzlichen radialen Blütengruppen sitzen auf Tertiär- und Fein-Ästen; kurze Stiele und variierte Ausrichtung reduzieren die vorher auffälligen geraden Rosetten-Spokes. Das Makro zeigt weiterhin kantige Petalen und einzelne sichtbare grüne Pedicel. Diese Grenzen sind bewusst dokumentiert, nicht als photorealistische Vollblüte ausgegeben.

Die Preview-Maske nutzt zwei Nenner. Die feste Ellipse (Mitte 500,355; Radien 400,250; Pixel x=80–919 und y=100–609) zählt auch Studiohintergrund mit und ergibt 22,34% Pink im Mittel. Der Baum-Silhouettenwert nutzt dieselbe Ellipse, teilt Pink-Pixel aber nur durch Pixel mit einer Farbabweichung von mehr als 12 vom Studiohintergrund RGB(56,73,88); das ergibt 38,13%. Der Review-Zielwert 55% wird in keiner Ansicht vollständig erreicht. Sektoren unter 40% Baum-Silhouette verbleiben bei 0°, 225°, 270° und 315°.

## Lieferumfang

| Datei | Zweck | Dreiecke | Bounds (m) | Größe |
| --- | --- | ---: | --- | ---: |
| `sakura_akebono.blend` | Editierbare Hero-Szene und Studio | 2.836.796 Render-Tris | 9,975 × 9,829 × 9,946 | 186,8 MB |
| `sakura_akebono.glb` | Hero-Modell | 2.836.796 | 9,975 × 9,829 × 9,946 | 116,9 MB |
| `sakura_akebono_lod1.glb` | Mittlere Distanz; 1.726 Blüten | 176.402 | 9,728 × 9,647 × 9,846 | 6,35 MB |
| `sakura_akebono_lod2.glb` | Ferne Distanz; 573 Blüten | 85.418 | 9,803 × 9,618 × 9,906 | 2,92 MB |
| `sakura_akebono_collision.glb` | Holz-Kollisionsproxy | 524 | 6,610 × 6,423 × 9,785 | 18 KB |
| `qa_metrics.json` | Geometrie-, Größen-, Preview- und Reimport-Metriken | – | – | – |

Hero verwendet 7 Materialien, LOD1 6, LOD2 5 und Kollision 1. Die Hero-Datei enthält 23.590 Blütenköpfe und überschreitet 2,8 Mio. Dreiecke; sie ist ein hochauflösendes Art-/Hero-Asset mit entsprechendem Speicherbedarf. LOD1 und LOD2 reduzieren Blütensites profilabhängig und unterschreiten die Tri-Ziele 200k/90k. LOD-Form und Bounds wurden in getrennten leeren Blender-Szenen geprüft; die Blütenfläche der LODs wurde nicht als eigener Bildmesswert neu gerendert.

## QA

`SakuraAkebono_Render`, `SakuraAkebono_Collision` und `Presentation_Studio` sind in der Blender-Szene getrennt. Die gespeicherte Szene ließ sich wieder öffnen (23 Objekte: 9 Render-Meshes, Boden, 3 Studio-Lichter und 10 Kameras; 3 Sammlungen; aktive Kamera `Camera_Azimuth_000`). Jedes der vier GLBs wurde einzeln in eine leere Szene importiert. Triangle Counts und Bounds stimmen mit den Generator-Metriken überein. Der Collision-Export enthält ausschließlich zwei Holz-Meshobjekte ohne Blüten, Laub oder Render-Materialien. GLB-importierte Objekte behalten ihre aussagekräftigen Namen und Materialien; benutzerdefinierte Blender-`role`-Properties werden vom glTF-Roundtrip nicht wiederhergestellt.

Die acht `previews/azimuth_000.png` bis `azimuth_315.png` zeigen 45°-Schritte; `macro_blossom.png` und `macro_bark.png` sind Detailbilder. Die Hero-Previews wurden nach der LOD-Reduktion beibehalten, weil nur LOD-Dichteparameter geändert wurden. Vollansicht und Makros bleiben als Stil-/Masken-QA in `qa_metrics.json` eingeordnet.

## Regeneration

Vom Repository-Root:

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_sakura_akebono_asset.py
```

Nur Szene/GLBs neu generieren und die bestehenden Hero-Previews beibehalten:

```powershell
$env:SAKURA_AKEBONO_SKIP_PREVIEWS='1'
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_sakura_akebono_asset.py
```

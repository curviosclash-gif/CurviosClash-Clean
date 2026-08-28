# Nebel wird global über Three.js-ShaderChunks ersetzt

## Kontext

`THREE.Fog` kennt nur Entfernung: `smoothstep(fogNear, fogFar, depth)`. Die Kurve
sättigt bei `fogFar` vollständig, kennt keine Höhe und keine Struktur. Damit
erhält jede Fläche in gleicher Entfernung exakt dieselbe Farbe, unabhängig von
Höhe und Position. Das Ergebnis wirkt nicht wie Luft, sondern wie eine
gestrichene Fläche vor der Kamera.

Höhenabhängiger Nebel ist in Three.js nicht vorgesehen. Möglich wären nur zwei
Wege: `onBeforeCompile` pro Material, oder ein einmaliger globaler Austausch der
Nebel-Bausteine. Der erste Weg müsste jedes Material in `src/entities/**`, im
GLB-Loader und in allen Map-Presets erreichen; jedes neue Material wäre
stillschweigend wieder ohne Nebel.

## Entscheidung

`src/core/renderer/AtmosphericFogShaderPatch.js` ersetzt einmalig und global die
vier Nebel-Bausteine (`fog_pars_vertex`, `fog_vertex`, `fog_pars_fragment`,
`fog_fragment`) und ergänzt `THREE.Material.prototype.onBeforeCompile`, um die
gemeinsam genutzten Uniform-Objekte einzuhängen. Der Einbau passiert im
`Renderer`-Konstruktor, vor der ersten Material-Übersetzung.

Dies ist die einzige Stelle in `src/`, die Three.js-Shaderquellen verändert.
Weitere Patches dieser Art brauchen einen eigenen ADR.

Die Nebeldichte ergibt sich aus drei Faktoren: einer exponentiellen
Entfernungskurve ohne Sättigungsplateau, einem Höhenabfall über `fogHeightBase`
und `fogHeightFalloff`, und einem weltraumfesten Dichtefeld über
`fogTurbulence`. Die Werte kommen ausschließlich aus `MapLightingContract` und
werden ausschließlich von `SceneLightingRig.apply` geschrieben.

**Entfernte Flächen nehmen die Himmelsfarbe an, nicht die Nebelfarbe.** Der
maßgebliche Wert ist `skyDome.horizonColor`; `fog.color` wird über `fog.skyBlend`
dorthin überblendet, Standard 1. Eine Nebelfarbe, die dunkler ist als der Himmel
dahinter, lässt die Ferne in eine schwarze Platte fallen — das Gegenteil von
Tiefe. In der Natur werden ferne Dinge heller und nehmen die Farbe des Himmels
an. `skyBlend: 0` gibt einer Karte den authored Wert zurück, falls sie bewusst
eine Leere hinter sich will.

Die Farbe läuft auf der Blickhöhe: `fog.color` liegt am Horizont,
`fog.colorHigh` am oberen und `fog.colorLow` am unteren Ende des Dunstbandes.
Oberes und unteres Ende bleiben getrennt, weil eine schwarze Himmelsfarbe nicht
zugleich entfernten Boden schwarz färben darf. Direkte Aufrufer ohne
`colorLow` erhalten aus Kompatibilitätsgründen weiterhin `colorHigh` auf beiden
Seiten; normalisierte Kartenprofile tragen beide Werte explizit.

**Jeder Übergang ist steigungsstetig.** Ein Sprung im Wert fällt als Kante auf,
ein Sprung in der *Steigung* aber ebenso — deshalb reicht Stetigkeit allein
nicht. Konkret: die Entfernungskurve lautet `1 - exp(-rate * t²)` und nicht
`1 - exp(-rate * t)`, damit die Steigung am Nebelbeginn bei null startet und der
Nebel nicht entlang einer Linie bei `fogNear` einsetzt; der Höhenabfall benutzt
statt `max(0, y - base)` einen über sechs Welteinheiten gerundeten Knick, sonst
zieht sich in Höhe der Nebelbasis eine waagerechte Falte durchs Bild. Die Rate
ist so gewählt, dass die Kurve bei `fogFar` 0,982 erreicht: dicht genug, dass der
Rest beim Abschneiden an der Kameraebene nicht aufploppt, ohne dabei flach zu
werden.

Das Feld ist bewusst **nicht** zeitabhängig. Three.js lädt Material-Uniforms nur
hoch, wenn der Renderer ohnehin auf ein anderes Material umschaltet; eine
Zeit-Uniform wäre damit nicht verlässlich pro Bild aktualisiert. Außerdem darf
keine Renderzeit in die Spiellogik zurückfließen.

Der Nebel wird von Three.js bewusst **nach** Tone Mapping und Farbraum-Kodierung
gemischt (`fog_fragment` steht in allen ShaderLib-Fragmentshadern hinter
`tonemapping_fragment` und `colorspace_fragment`), und `fogColor` wird im
Ausgabefarbraum hochgeladen. Eine voll benebelte Fläche zeigt daher exakt die
hinterlegte Nebelfarbe. Der Himmelsdom bleibt deshalb ohne Tone Mapping — nur
so landen beide Seiten auf demselben Pixelwert. Diese Reihenfolge bleibt beim
Austausch der Bausteine unverändert.

## Folgen

Alle Materialien mit `fog: true` erhalten die neue Kurve, ohne dass Aufrufer
etwas tun müssen. Ein Three.js-Update kann die Bausteine ändern; die
Contract-Tests prüfen deshalb die Namen der Varyings und Uniforms sowie die
Rückkehr zum Originalzustand.

Der Programm-Cache wird nicht fragmentiert: `customProgramCacheKey` liefert
standardmäßig `onBeforeCompile.toString()`, und alle Materialien teilen sich
dieselbe Funktion.

Die Welt-Position wird im Vertex-Shader aus `mvPosition`, `viewMatrix` und
`cameraPosition` rekonstruiert, nicht aus `worldpos_vertex` — Three.js erzeugt
diesen Block nur für Envmap-, Schatten- und Transmissionsmaterialien. `inverse()`
wird nicht verwendet, damit der Shader auch unter GLSL ES 1.00 übersetzt.

## Test/Absicherung

`tests/atmospheric-fog-shader.contract.test.mjs` prüft Einbau und Rückbau, das
Fehlen der sättigenden Kurve, die Deklaration jedes benutzten Varyings und
Uniforms auf beiden Shader-Seiten und dass alle Materialien dasselbe
Uniform-Objekt erhalten statt einer Kopie.
`tests/atmosphere-horizon-seam.contract.test.mjs` sichert die zugehörige
Horizont-Farbe ab. `tests/notre-dame-atmosphere.desktop.spec.js` rendert in der
Electron-App feste Notre-Dame-Perspektiven gegen die frühere schwarze
Kontrollkonfiguration und misst den Rückgang gleichförmiger dunkler Flächen.

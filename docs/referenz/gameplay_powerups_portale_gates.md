# Gameplay-Referenz: Powerups, Portale und Gates

Stand: 2026-09-15

## Zweck

Diese Uebersicht beschreibt die aktuell im Code vorhandenen Powerups, Portale, Exit-Portale und Spezial-Gates sowie deren Laufzeitverhalten.

## Grundablauf fuer Items

- Items spawnen ueber den `PowerupManager`.
- Auf Maps mit festen `items`-Ankern oder explizitem `itemSpawnMode` entscheidet die Runtime zwischen `anchor-only`, `hybrid` und `fallback-random`.
- `toArenaMapDefinition()` liefert dafuer den maschinenlesbaren Spawn-Vertrag unter `map.itemSpawnAuthoring`.
- Ein eingesammeltes Item landet im Inventar des Spielers.
- `useItem` verbraucht nur self-usable Items als Selbst-Effekt; verbotene Nutzungen bleiben im Inventar und liefern stabile Result-Codes.
- `shootItem` verschiesst offensive Status-Items und Raketen als Projektil.
- Jedes registrierte Item hat genau eine primaere Aktion: Buffs/Deployments werden genutzt, Debuffs/Raketen verschossen. Bei gleichzeitigem `useItem`/`shootItem` hat `useItem` Prioritaet; pro Simulationstick wird hoechstens ein Inventaritem verbraucht.
- Projektil-Treffer uebertragen Status-Items weiterhin auf das Ziel.
- In Hunt sind Raketen projektil-only Schadens-Projektile und koennen nicht mehr per `useItem` verbrannt werden.
- HUD- und Touch-Oberflaechen lesen denselben Capability-Vertrag und markieren Slots bzw. Buttons als `USE`, `SHOT`, `DUAL` oder Cooldown.
- `HudRuntimeSystem` und `TouchInputSource` konsumieren dafuer denselben Resolver `src/shared/contracts/GameplayActionAvailabilityContract.js`, der Runtime-Projection, Cooldowns und Pickup-Normalisierung auf einen gemeinsamen UI-Vertrag hebt.

## Powerup-Typen

| Typ | Selbstnutzung | Projektil | Wirkung | Modus |
| --- | --- | --- | --- | --- |
| `SPEED_UP` | ja | nein | `baseSpeed * 1.6` fuer 4s | `CLASSIC`, `ARCADE`, `HUNT` |
| `SLOW_DOWN` | nein | ja | `baseSpeed * 0.5` fuer 4s | `CLASSIC`, `ARCADE`, `HUNT` |
| `THICK` | ja | nein | Trailbreite auf `1.8` fuer 5s | `CLASSIC`, `ARCADE`, `HUNT` |
| `THIN` | nein | ja | Trailbreite auf `0.2` fuer 5s | `CLASSIC`, `ARCADE`, `HUNT` |
| `SHIELD` | ja | nein | Shield aktiv; in Hunt persistent solange `shieldHP > 0`, sonst Schutz fuer den naechsten Treffer | `CLASSIC`, `ARCADE`, `HUNT` |
| `HEALTH` | ja | nein | stellt 35 HP wieder her | `ARCADE`, `HUNT` |
| `MG_TURRET` | ja | nein | stellt ein zerstoerbares MG-Geschuetz auf | `HUNT` |
| `SLOW_TIME` | ja | nein | setzt globale Spielzeit auf `0.4x`, solange aktiv; Hunt entfernt Legacy-Instanzen beim Effekt-Recompute | `CLASSIC`, `ARCADE` |
| `GHOST` | ja | nein | ignoriert Wand- und Trail-Kollisionen waehrend der Laufzeit | `CLASSIC`, `ARCADE`, `HUNT` |
| `INVERT` | nein | ja | invertiert die Steuerung fuer 4s | `CLASSIC`, `ARCADE`, `HUNT` |
| `TRAIL_GAP` | ja | nein | unterbricht die eigene Spur fuer 3s | alle |
| `EMP` | nein | ja | entfernt Buffs/Schild und blockiert Itemaktionen fuer 3s | alle |
| `MAGNET` | ja | nein | vergroessert den gesamten Pickup-Radius fuer 6s auf `2.4x` | alle |
| `DECOY` | ja | nein | stoert fuer 5s gegnerische Homing-Erfassung | alle |
| `PURGE` | ja | nein | entfernt sofort alle aktiven Debuffs | alle |
| `SWAP` | nein | ja | tauscht beim Treffer die Positionen von Schuetze und Ziel, inklusive Trail-Unterbrechung | alle |
| `MINE` | ja | nein | legt hinter dem Spieler eine 10s aktive Mine mit 25 Schaden | alle |
| `ROCKET_WEAK` | nein | ja | 10 Schaden | `HUNT` |
| `ROCKET_MEDIUM` | nein | ja | 20 Schaden | `HUNT` |
| `ROCKET_HEAVY` | nein | ja | 40 Schaden | `HUNT` |
| `ROCKET_MEGA` | nein | ja | 70 Schaden | `HUNT` |

## Wichtige Item-Details

- Inventarlimit: `5`.
- Feldlimit gleichzeitig gespawnter Items: `10`.
- Spawnintervall: `3.0s`.
- Pickup-Radius: `2.5`.
- Ein volles Inventar lehnt die Aufnahme mit `item.pickup.inventory-full` ab; das Pickup bleibt auf dem Feld und zaehlt nicht als Collect-Erfolg.
- Die Capability-Matrix ist zentral in `src/shared/contracts/PickupRegistryContract.js` gepflegt und steuert Typ-Normalisierung, Modusfreigabe, Visuals, Bot-Gewichte und Observation-Slots.
- Freie Spawns pruefen mit deterministischem Runtime-RNG bis zu zwoelf Kandidaten gegen Waende, Trails, Spieler, andere Pickups, Portale und Gates. Authored Anchors bleiben bewusste Map-Entscheidungen.
- Neue Pickups werden `0.75s` sichtbar telegraphiert und sind in diesem Fenster noch nicht einsammelbar.
- Status-Stacks sind explizit: gleiche Effekte refreshen; `SPEED_UP`/`SLOW_DOWN` sowie `THICK`/`THIN` ersetzen jeweils ihre Kategorie; Instant- und Deployment-Items erzeugen keinen Nullzeit-Stack.
- Netzwerk-Clients blenden akzeptierte Pickups optimistisch aus. Bestaetigt der Host den Claim nicht innerhalb von `0.35s`, stellt der autoritative Snapshot das Pickup wieder her und die Inventar-Reconciliation rollt den lokalen Eintrag zurueck.
- Heuristische Bots bewerten Feld-Pickups nach Distanz, Inventarplatz, HP/Schild, Debuffs und aktuellem Survival-Druck; defensive Ziele schlagen unter Gefahr naehere offensive Pickups.
- Classic und Arcade lesen modusspezifische Spawn-Gewichte aus derselben Registry; der Runtime-RNG steuert Typ, Anker, Ebene und Animationsphase reproduzierbar und vermeidet direkte Typwiederholungen.
- Laufende Status-Effekte verwenden reale Effektzeit. Globale Zeitlupe verlangsamt daher die Physik, verlaengert aber weder sich selbst noch andere `activeEffects`.
- Das Desktop-HUD zeigt aktive Effekte samt Restzeit beziehungsweise Schild-HP und bei gegnerischen Treffern die Spielerquelle. Raketenstufen tragen zusaetzlich die sichtbaren Badges `S`, `M`, `L` und `XL`.
- In Planar-Maps koennen freie Spawns auf `portalLevels` gelegt werden.
- Map-Autoren koennen per `pickupType` feste Item-Typen an Anchors erzwingen.
- `GHOST` und Spawn-Schutz ueberspringen den normalen Wand-/Trail-Kollisionspfad komplett.
- In Hunt haben Item-Selbstnutzungen einen Cooldown; fuer `SHIELD` gilt ein eigener Mindest-Cooldown.
- Recorder und Diagnostik aggregieren stabile Action-Result-Codes wie `item.spawn.success`, `item.pickup.success`, `item.hit.success`, `item.use.cooldown`, `item.shoot.success`, `portal.travel`, `portal.travel.cooldown`, `portal.exit.trigger`, `portal.exit.inactive`, `gate.trigger.boost` oder `gate.trigger.cooldown` in `actionResultCodeTotals`.
- Balance-Telemetrie fuehrt pro Typ Spawn-, Collect-, Reject-, Use-/Shoot-, Treffer- und Schadenssummen; Rundendauer und Bot-Survival bleiben als Outcome-Metriken erhalten.
- Fehlgeschlagene Item-Aktionen sind im Recorder jetzt explizit auswertbar: `failedItemActions`, `failedItemActionModeCounts` (`use|shoot|mg|other`) und `failedItemActionCodeCounts` liefern pro Runde und aggregiert denselben Code-Vertrag wie die Runtime (`item.use.*`, `item.shoot.*`, `mg.shoot.*`).

## Normale Portale

- Normale Portale sind immer paarweise aufgebaut: `A <-> B`.
- Spieler und Projektile koennen beide teleportieren.
- Trigger-Radius: `4.0`.
- Pro Entity wird ein Cooldown gesetzt, damit kein direktes Rueck-Teleportieren passiert.
- Der Cooldown ist dynamisch: mindestens `1.2s`, je nach Distanz bis maximal `2.5s`.
- Eine kurze Energiewelle laeuft beim Durchqueren ueber beide Portal-Endpunkte und hebt den Zielimpuls hervor. Der persoenliche Entity-Cooldown veraendert weder Oeffnung noch Sichtbarkeit fuer andere Entities.
- Spieler landen am Zielportal plus kleinem Vorwaerts-Offset.
- Die Gameplay-Einstellung `portalCount` zaehlt sichtbare Portal-Eingaenge; zwei Eingaenge ergeben ein Paar.
- Portale mit authored Rotation loesen beim Kreuzen ihrer Ebene aus und drehen Spieler- sowie Projektilrichtung in die Ausgangsorientierung.
- Nicht orientierte Legacy-Portale behalten den bisherigen radialen Trigger.
- Alle Portalformen behalten eine statische, offene Metallrahmen-Silhouette. Ein Paar teilt Farbe und ein stabiles geometrisches Randzeichen; neutrale weisse Pfeile markieren `UP` beziehungsweise `DOWN` unabhaengig von der Paarfarbe.
- Im Planar-Mode wird beim Teleport auch die aktive Ebene (`currentPlanarY`) auf die Zielhoehe gesetzt.
- Projektile behalten bei Legacy-Portalen ihre Flugrichtung; orientierte Portale drehen sie relativ zum Ausgang. Sie werden leicht nach vorne versetzt und verlieren ihr bisheriges Homing-Ziel bis zur erneuten Erfassung.
- Projektile besitzen stabile Traversal-IDs; Pooling oder Array-Umsortierung kann ihren Portal-Cooldown nicht mehr auf andere Projektile uebertragen.
- Der Runtime-Rueckgabevertrag fuer Portal-Interaktionen ist jetzt ebenfalls result-code-basiert: Erfolg liefert `portal.travel`, Cooldown-Blocker `portal.travel.cooldown`, deaktivierte Portale `portal.travel.inactive`.
- `matchRuntimeProjection.players[*].traversal` zeigt den Runtime-Signalvertrag fuer Portal-/Gate-Interaktionen: `portalCooldownRemaining`, `gateCooldownRemaining`, Exit-Portal-Aktivstatus (`exitPortal.totalCount|activeCount|inactiveCount`) sowie Post-Portal-Fenster (`postPortalActive`, `postPortalRemainingSeconds`, `lastPortalTravelAtMs`).
- Portal-Parsing normalisiert unvollstaendige Legacy-Paare nicht mehr still auf Ursprungspunkte; ungueltige oder positionslose Eintraege werden verworfen und als Warnung gemeldet.

## Exit-Portale

- Exit-Portale sind ein eigener Portal-Typ mit nur einem Eintrittspunkt.
- Sie koennen zu Matchbeginn sichtbar, aber inaktiv gedimmt sein.
- Maps koennen definieren, dass sie erst nach einem Clear-Zustand aktiviert werden.
- Der Trigger-Radius ist groesser als bei normalen Portalen.
- Bei Aktivierung leuchten Rahmen und eindeutige Kronenmarke staerker und das Portal kann als Ziel/Exit genutzt werden.
- Die offene Silhouette behaelt im inaktiven, aktiven und Puls-Zustand dieselbe Groesse; das HUD zeigt `EXIT GESPERRT` beziehungsweise `EXIT BEREIT`.
- Exit-Portale liefern denselben Result-Vertrag wie andere Traversal-Pfade: `portal.exit.trigger`, `portal.exit.cooldown` und `portal.exit.inactive`.

## Spezial-Gates

Aktuell existieren genau zwei Gate-Typen:

| Gate | Aktivierung | Wirkung |
| --- | --- | --- |
| `boost` | Ueberqueren der Gate-Ebene in Vorwaertsrichtung | kurzer Vorwaertsschub, setzt Mindesttempo, markiert Boost-Status |
| `slingshot` | Ueberqueren der Gate-Ebene in Vorwaertsrichtung | Vorwaerts- plus Auftriebsschub, kurze Lenksperre |

Weitere Gate-Details:

- Gates haben einen eigenen Radius und einen Entity-Cooldown.
- Standard-Cooldown fuer Gates: `4.0s`, falls die Map nichts anderes in `params.cooldown` vorgibt.
- `boost` liest typischerweise `duration`, `forwardImpulse` und optional `bonusSpeed`.
- `slingshot` liest typischerweise `duration`, `forwardImpulse` und `liftImpulse`.
- Traversal-Result-Codes sind auch fuer Spezial-Gates standardisiert: erfolgreiche Aktivierungen liefern `gate.trigger.boost` bzw. `gate.trigger.slingshot`, Cooldown-Blocker `gate.trigger.cooldown`.
- Unbekannte Gate-Typen laufen ueber einen sichtbaren Legacy-/Warnpfad; Runtime-Diagnostik behaelt `legacyType` und `warningCode`.
- Gate-Parsing verwirft nicht-objektfoermige oder positionslose Gate-Eintraege mit sichtbaren Warnungen statt stiller `0/0/0`-Normalisierung.
- Hunt-Bots und Hunt-Bridge-Fallbacks koennen nahe, bereite Special Gates unter hohem Survival-Druck als Retreat-Anker priorisieren.
- Wenn kein bereites Special Gate verfuegbar ist, duerfen dieselben Hunt-Fallbacks auch nahe, bereite Portale als Traversal-Ausweichpfad ansteuern.
- Hunt-spezifische Fallback-Policies ignorieren Nicht-Raketen-Items nicht mehr pauschal: defensive Self-Use-Pickups wie `SHIELD`, `GHOST`, `THICK` oder `SPEED_UP` koennen unter Druck denselben Retreat- oder Survival-Pfad stuetzen.

## Map-seitige Steuerung

Maps koennen folgende Felder verwenden:

- `portalMode`: `dynamic`, `authored` oder `hybrid`.
- Runtime-Maps mit Portalpaaren und ohne expliziten Modus verwenden aus Kompatibilitaetsgruenden `authored`; Maps ohne Portalpaare verwenden `dynamic`.
- `dynamic` ignoriert authored Portal-Knoten bewusst und meldet dies als Runtime-Warnung.
- `authored` verlangt mindestens ein vollstaendiges A/B-Portalpaar; ohne Paar bleibt Dynamic-Fallback bewusst deaktiviert und wird als Warnung ausgewiesen.
- `hybrid` kombiniert authored Paare mit dynamischen Restslots; wenn kein authored Paar vorliegt, faellt die Runtime sichtbar auf dynamic-only zurueck.
- Ungerade authored Portal-Knoten werden nicht still normalisiert: Der letzte Knoten wird verworfen und als Authoring-Vertragswarnung gemeldet.
- `toArenaMapDefinition()` liefert den maschinenlesbaren Portalvertrag unter `map.portalAuthoring` (`mode`, `authoredNodeCount`, `authoredPairCount`, `usesAuthoredPortals`, `usesDynamicPortals`, `hasDanglingPortalNode`).
- `portals`: feste Portal-Paare.
- Portal-Endpunkte koennen Editor-Visuals (`portal_ring`, `portal_cross`, `portal_diamond`, `portal_hex`, `portal_octagon`, `portal_square`, `portal_star`, `portal_triangle`) und Rotationen tragen; beides bleibt bis zur Runtime erhalten.
- `preferAuthoredPortals`: feste Portal-Paare gegenueber dynamischen Runtime-Portalen bevorzugen.
- `portalLevels`: feste Hoehen fuer Planar-Portal-/Item-Layouts.
- `itemSpawnMode`: `anchor-only`, `hybrid` oder `fallback-random`; authored Anker werden in `fallback-random` bewusst ignoriert und als Runtime-Warnung gespiegelt.
- Ungueltige `itemSpawnMode`-Werte werden deterministisch auf `anchor-only`/`fallback-random` normalisiert und als Warnhinweis protokolliert.
- Editor-Export, Disk-Save, Import und Playtest zeigen dieselben Schema-Hinweise jetzt bereits vor dem Runtime-Load sichtbar an.
- `anchor-only` deaktiviert Random-Fallback strikt: ohne verfuegbare authored Anchors entstehen keine neuen Item-Spawns.
- `hybrid` nutzt bevorzugt authored Anchors und faellt ohne Anchor sichtbar auf Random-Spawn zurueck.
- `toArenaMapDefinition()` liefert den Spawnvertrag unter `map.itemSpawnAuthoring` (`mode`, `authoredAnchorCount`, `requiresAuthoredAnchor`, `usesAuthoredAnchors`, `usesRandomFallback`, `disablesSpawnWithoutAnchor`).
- `gates`: `boost`- oder `slingshot`-Definitionen.
- `items`: feste Pickup-Anker mit optionalem `pickupType`; ungueltige Typen werden beim Schema-Export sichtbar gemeldet und fallen deterministisch auf `type`/`model` zurueck.
- `exitPortal`: einzelnes Exit-Portal mit optionaler spaeter Aktivierung.

## Neuen Parcours hinzufuegen

Ein Parcours ist reine Map-Autorenarbeit. Es ist **kein Codeeingriff noetig**, damit er im
Arcade-Modus XP und Fortschritt liefert.

1. Map-Definition anlegen (`src/core/config/maps/presets/parcours_maps.js` oder Editor-Export).
2. Block `parcours` setzen:
   - `enabled: true` — ohne dieses Flag entsteht keine Route.
   - `routeId`: stabile Kennung; Bestzeiten und Ghosts haengen daran.
   - `checkpoints`: geordnete Liste mit `id`, `pos`, `radius`, `forward`. Ohne Checkpoints
     entsteht keine Route und es wird kein XP vergeben.
   - `finish`: Zielcheckpoint. Fehlt er, meldet der Editor eine Authoring-Warnung.
   - `rules` ist optional; alle Werte haben Defaults (siehe `buildRouteFromParcours`).
3. Fertig. `ParcoursProgressSystem` baut die Route aus der Map, und
   `GameRuntimeArcadeSupport` verbindet ihre Ereignisse mit dem Fahrzeugprofil.

Die XP-Betraege stehen ausschliesslich in `XP_REWARD_TABLE`
(`src/state/arcade/ArcadeVehicleProfile.js`): `parcoursCheckpoint`, `parcoursFinish` und
`parcoursNewBestTime`. Eine neue Map bringt **keine eigenen XP-Werte** mit.

Vergeben wird das XP nur, wenn der Lauf im Arcade-Pfad startet
(`localSettings.modePath === 'arcade'`, intern `gameMode === 'ARCADE'`); im Klassik- und
Kampfpfad laeuft derselbe Parcours ohne Fortschritt.

Abgesichert durch `tests/parcours-new-route-xp.contract.test.mjs`: dort wird eine frisch
erfundene Parcours-Definition abgeflogen und der ausgezahlte XP-Betrag geprueft.

## Editor-Authoring-Vertrag

Der `EditorAuthoringContract.js` (`src/shared/contracts/EditorAuthoringContract.js`) definiert die autoritative Grenze zwischen Content-Descriptor-Feldern und UI-Metadaten:

- `EDITOR_OBJECT_TYPES`: Die acht autoritativen Platzierungstypen (`hard`, `foam`, `portal`, `spawn`, `item`, `aircraft`, `tunnel`, `checkpoint`), die uebergreifend in `EditorBuildCatalog`, `EditorMapSerializer` und `MapSchema` gelten. Neue Objekttypen werden ausschliesslich hier registriert.
- `EDITOR_CONTENT_DESCRIPTOR_FIELDS`: `tool` und `subType` — die einzigen Felder eines Katalog-Eintrags, die der Serializer und Runtime verarbeiten.
- `EDITOR_UI_METADATA_FIELDS`: Alle rein editor-seitigen Praesentationsfelder (Label, Glyph, Token, sortOrder, badge, isFeatured, isDefault, keywords usw.).
- `isKnownEditorObjectType(type)`: Guard-Funktion, die `createBuildEntry` in `EditorBuildCatalog.js` nutzt, um unbekannte Typen frueh als Fehler zu melden.
- `getEditorAuthoringDescriptor()`: Maschinenlesbarer Snapshot des Authoring-Vertrags fuer Diagnostik und Tests.

Authoring-Warnungen waehrend des Exports (`EditorMapSerializer.generateJSONExport`):

- Fehlender Spieler-Spawn → Standardposition wird verwendet.
- Fehlende Bot-Spawn-Punkte → Warnhinweis.
- Parcours aktiviert ohne Finish-Checkpoint → Warnhinweis.
- Ungerade Portal-Anzahl → Warnhinweis (ein Portal ohne Partner).

Alle Warnungen landen in `manager.lastSchemaWarnings` und werden von `EditorSessionControls` beim Export, Import, Disk-Save und Playtest als Dialog sichtbar.

`resolveMapAuthoringStatus(manager)` in `EditorMapSerializer.js` gibt jederzeit (ohne vollen Export) den aktuellen Authoring-Stand zurueck: `playerSpawnPlaced`, `botSpawnCount`, `portalCount`, `parcoursEnabled`, `parcourHasFinish` sowie eine deduplizierte `warnings`-Liste. Der Editor-Runtime-Snapshot (`CURVIOS_EDITOR.getState()`) enthaelt diesen Status als `authoringStatus`.

## Editor-Hinweise und Custom-Map-Warnpfad

- `EditorSessionControls` zeigt fuer Export, Import, Disk-Save und Playtest dieselben deduplizierten Schema-Hinweise (`MapSchemaSanitizeOps`) und unterscheidet normale Hinweise von Migrationshinweisen.
- Editor-Tooltips spiegeln den Authoring-Vertrag sichtbar: Build-Katalog-Descriptor (`descriptorVersion`/`entryCount`), Template-Import-Capability und `editor-disk-io.v1`.
- `CustomMapLoader` liefert fuer Runtime-Lesen einen strukturierten Vertrag aus `reason`, `message`, `warnings`, `details`, optionaler `migration`-Markierung und der Capability `custom-map-storage-capability.v1`.
- `MatchSessionFeedbackPlan` nutzt denselben Vertrag fuer sichtbare Laufzeitwarnungen:
  - Fallback auf Standard-Map erzeugt Error-Toast plus Konsoleintrag.
  - Erfolgreich geladene Custom-Maps mit Hinweisen erzeugen Info- bzw. Warning-Toast (bei Migration) und behalten den Warn-Detailpfad in der Konsole.
  - Bei mehreren Warnungen enthaelt der Toast den Zusatz `(+N Hinweis(e) in Konsole)`, damit kein Warnfokus still verloren geht.

## Relevante Runtime-Module

- `src/entities/Powerup.js`
- `src/entities/player/PlayerEffectOps.js`
- `src/entities/systems/lifecycle/PlayerActionPhase.js`
- `src/entities/systems/lifecycle/PlayerInteractionPhase.js`
- `src/entities/systems/lifecycle/PlayerCollisionPhase.js`
- `src/entities/arena/portal/PortalRuntimeSystem.js`
- `src/entities/arena/portal/PortalLayoutBuilder.js`
- `src/entities/arena/portal/SpecialGateRuntime.js`
- `src/entities/player/PlayerMotionOps.js`
- `src/entities/systems/HuntCombatSystem.js`
- `src/entities/systems/ProjectileSystem.js`
- `src/entities/systems/projectile/ProjectileSimulationOps.js`

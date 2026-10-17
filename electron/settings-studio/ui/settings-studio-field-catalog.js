// Presentation metadata; stable contract paths and runtime values stay unchanged.
const TEXT = Object.fromEntries(`
combatProfile|Arcade-Kampfprofil|Wählt das Kampfprofil für den Arcade-Lauf.
comboDecayPerSecond|Kombo-Abbau|Wie viel Kombowert pro Sekunde abgebaut wird.
comboWindowMs|Kombo-Zeitfenster|Zeit für den nächsten Treffer innerhalb einer Kombo.|ms
companionCount|Begleiter|Anzahl der Begleiter im Arcade-Lauf.
dailyChallenge|Tagesherausforderung|Aktiviert den Tagesherausforderungs-Lauf.
demolitionProfileIds|Zerstörungsprofile je Spieler|Profilkennungen in Spielerreihenfolge; leere Einträge verwenden den normalen Einstieg.
difficultyTierId|Arcade-Schwierigkeitsstufe|Kennung der Schwierigkeitsstufe des Arcade-Laufs.
huntParcoursVariantId|Kampf-Parcours-Variante|Kennung der gewünschten Parcoursvariante; leer verwendet die normale Auswahl.
intermissionSeconds|Pause zwischen Etappen|Dauer der Pause zwischen Arcade-Etappen.|s
journeyStageId|Reise-Etappe|Kennung der Startetappe für den Reiseablauf.
maxMultiplier|Maximaler Punktemultiplikator|Obergrenze des Arcade-Punktemultiplikators.|×
nightmare|Albtraum-Modus|Aktiviert die Albtraum-Variante des Arcade-Laufs.
playerProfileIds|Spielerprofile|Profilkennungen in der Reihenfolge der Spieler.
portalChainId|Portalkette|Kennung der Portalkette für den Arcade-Lauf.
profileId|Arcade-Profil|Kennung des verwendeten Arcade-Regelprofils.
replayHooksEnabled|Replay-Anbindung|Erlaubt die Replay-Anbindung des Arcade-Laufs.
runType|Arcade-Laufart|Bestimmt die Art des Arcade-Laufs.
scoreModel|Punkteberechnung|Technische Kennung des Punktevertrags; nur mit passender Spielversion ändern.
sectorCount|Sektoren|Anzahl der Sektoren des Arcade-Laufs.
seed|Zufallsstartwert|Startwert für reproduzierbare Zufallsfolgen.
autoRoll|Automatische Rollbewegung|Aktiviert die automatische Rollfunktion.
enabled|Externe Bot-Anbindung|Aktiviert die Verbindung zur externen Bot-Schnittstelle.
maxRetries|Verbindungsversuche|Anzahl zusätzlicher Verbindungsversuche nach einem Fehler.
resumeCheckpoint|Bot-Fortsetzungsstand|Kennung des Fortsetzungsstands der externen Bot-Anbindung.
resumeStrict|Strikte Bot-Fortsetzung|Verlangt einen passenden Fortsetzungsstand bei der externen Bot-Anbindung.
retryDelayMs|Wartezeit vor erneutem Versuch|Pause zwischen den Verbindungsversuchen.|ms
timeoutMs|Bot-Antwortzeit|Maximale Wartezeit auf eine Bot-Antwort.|ms
url|Bot-Verbindungsadresse|Adresse des externen Bot-Dienstes.
botDifficulty|Bot-Schwierigkeit|Schwierigkeitsstufe der KI-Gegner.
botHeuristicProfile|Bot-Verhaltensprofil|Ausgewogenes, defensives oder aggressives Bot-Verhalten.
aggression|Angriffsneigung|Gewichtung des Angriffsverhaltens im zugehörigen Bot-Profil.
survivalFocus|Überlebensfokus|Gewichtung der Gefahrenvermeidung im zugehörigen Bot-Profil.
botPolicyStrategy|Bot-Entscheidungsstrategie|Wählt die vom Spiel unterstützte Bot-Strategie.
normal|Standard-Kameraperspektive|Kameraperspektive für den normalen Flugbetrieb.
reactorCameraShakeEnabled|Reaktor-Kamerawackeln|Schaltet Kamerawackeln durch Reaktoreffekte ein oder aus.
reactorFlashEnabled|Reaktor-Lichtblitze|Schaltet Reaktor-Lichtblitze ein oder aus.
reduceMotion|Bewegungseffekte reduzieren|Reduziert die dafür vorgesehenen Kamera- und Bewegungseffekte.
speedFovEnabled|Geschwindigkeits-Sichtfeldeffekt|Aktiviert die Sichtfeldänderung bei Geschwindigkeit.
speedFovIntensity|Stärke des Sichtfeldeffekts|Gewichtung der geschwindigkeitsabhängigen Sichtfeldänderung.|×
thrusterExhaustEnabled|Antriebseffekt|Schaltet den sichtbaren Antriebseffekt ein oder aus.
thrusterExhaustIntensity|Stärke des Antriebseffekts|Gewichtung des sichtbaren Antriebseffekts.|×
gameMode|Spielmodus|Wählt den Spielmodus; weitere Regeln hängen vom gewählten Modus ab.
fightMgDamage|MG-Schaden im Kampf|Lebenspunkte, die ein MG-Treffer im Kampfmodus abzieht.
fightPlayerHp|Lebenspunkte im Kampf|Start-Lebenspunkte der Spieler im Kampfmodus.
fireRate|Schussintervall|Pause zwischen abgefeuerten Projektilen oder schießbaren Items. Größer bedeutet eine längere Pause; die MG-Schussfolge ist separat.|s
gapFrequency|Wahrscheinlichkeit einer Spurlücke|Wahrscheinlichkeitswert für eine neue Lücke in der Spur.
gapSize|Dauer einer Spurlücke|Wie lange eine neu erzeugte Spurlücke offen bleibt.|s
gravityStrength|Schwerkraftstärke|Stärke des Schwerkrafteffekts in den dafür vorgesehenen Spielabläufen.
itemAmount|Gegenstandsdichte|Gegenstandsdichte relativ zur Standardarena; Kartenmaß und Obergrenze beeinflussen die tatsächliche Menge.
lockOnAngle|Zielerfassungswinkel|Öffnungswinkel der automatischen Zielerfassung.|°
mgTrailAimRadius|MG-Trefferradius an Spuren|Radius der Ziel-/Trefferprüfung des MG an Spuren.
nextCheckpointGlowIntensity|Leuchten des nächsten Checkpoints|Leuchtstärke des nächsten Parcours-Checkpoint-Rings.|×
pitchSensitivity|Lenkung Hoch/Runter (Pitch)|Empfindlichkeit für die Höhensteuerung; unabhängig von Links/Rechts.
planarLevelCount|Ebenen im 2D-Flugraum|Anzahl der Ebenen für den planaren Flugraum.
planarMode|Planarer Flugraum|Aktiviert die dafür vorgesehene Ebenen-Spielweise.
planeScale|Flugzeuggröße|Größenfaktor der Flugzeugdarstellung.|×
portalBeams|Portalstrahlen|Schaltet die Portalstrahlen ein oder aus.
speed|Fluggeschwindigkeit|Grundgeschwindigkeit der Flugzeuge in Spieleinheiten pro Sekunde.|Einheiten/s
trailLength|Spurlänge|Maximale Segmentanzahl einer Flugspur; mehr Segmente benötigen mehr Ressourcen.|Segmente
trailWidth|Spurbreite|Breite der Flugspur in Spieleinheiten.|Einheiten
turnSensitivity|Lenkung Links/Rechts (Yaw)|Empfindlichkeit für die horizontale Lenkung; unabhängig von Hoch/Runter.
deathmatchKillLimit|Abschüsse bis zum Sieg|Abschussziel für den dafür vorgesehenen Kampfmodus.
respawnEnabled|Wiedereinstieg|Erlaubt den Wiedereinstieg nach einer Niederlage im Kampfmodus.
teamMode|Teamspiel|Aktiviert das Teamspiel im Kampfmodus.
teamObjective|Team-Spielziel|Wählt das Spielziel für die Teams.
teamSize|Teamgröße|Anzahl der Teilnehmer je Team.
timeLimitEnabled|Zeitbegrenzung|Aktiviert die Zeitbegrenzung des Kampfmodus.
winCondition|Siegbedingung|Legt die Siegbedingung des Kampfmodus fest.
mapKey|Karte|Kennung der Startkarte.
mode|Spieler-/Spielvariante|Wählt die Spielerzahl beziehungsweise die Variante des zugehörigen Bereichs.
numBots|KI-Gegner|Anzahl der KI-Gegner im Match.
portalsEnabled|Portale aktiv|Schaltet Portale für den Startaufbau ein oder aus.
exportPreset|Video-Exportformat|Profil für den späteren Videoexport.
hudMode|HUD in Aufnahmen|Legt die Einblendungen in Aufnahmen fest.
orientation|Videoausrichtung|Ausrichtung der Aufnahme, etwa Querformat oder Hochformat.
profile|Aufnahmeprofil|Profil der Aufnahmequalität.
settingsVersion|Einstellungs-Schemaversion|Technische Versionsnummer; beeinflusst Migration und Kompatibilität gespeicherter Einstellungen.
winsNeeded|Rundensiege bis zum Matchsieg|Erforderliche Rundensiege für den Matchgewinn.
gameplay|Zusätzliche Übertragungswerte|Technische Zusatzwerte der Config-Übertragung. Einzelne bekannte Spielwerte stehen in den Fachgruppen.
modePath|Spielauswahl|Wählt Klassisch, Kampf oder Arcade für den Einstieg.
sessionType|Sitzungsart|Wählt die lokale Einzel- oder Mehrspielersitzung.
fixedPresets|Voreinstellungen|Sammlung der vordefinierten Regelkombinationen.
actorId|Bearbeiterkennung|Technische Kennung des Menü-Bearbeiters.
ambienceVolume|Umgebungslautstärke|Lautstärke der Umgebungsgeräusche.|×
engineVolume|Antriebslautstärke|Lautstärke der Antriebsgeräusche.|×
masterVolume|Gesamtlautstärke|Übergeordnete Lautstärke aller Tonkanäle.|×
musicVolume|Musiklautstärke|Lautstärke der Musik.|×
sfxVolume|Effektlautstärke|Lautstärke der Spieleffekte.|×
uiVolume|Menülautstärke|Lautstärke der Menügeräusche.|×
bloomQuality|Leuchteffekt-Qualität|Qualitätsstufe des Bloom-Effekts.
bloomQualityUserSet|Leuchteffekt manuell gesetzt|Interne Markierung, ob die Bloom-Qualität manuell gewählt wurde.
developerModeEnabled|Entwicklermodus|Aktiviert die vorhandenen Entwicklerfunktionen des Menüs.
developerModeVisibility|Sichtbarkeit der Entwicklerfunktionen|Wählt die Sichtbarkeitsregel der Entwicklerfunktionen.
developerThemeId|Entwicklerdesign|Kennung des Designs für Entwicklerfunktionen.
draftStateBySessionType|Menüentwürfe je Sitzungsart|Gespeicherte Startaufbauten für die jeweiligen Sitzungsarten.
activePlaylistId|Aktive Ereignisfolge|Kennung der ausgewählten Ereignisfolge.
lastPresetId|Zuletzt verwendetes Preset|Kennung der zuletzt verwendeten Regelkombination.
nextIndex|Nächster Eintrag der Ereignisfolge|Position des nächsten Eintrags in der Ereignisfolge.
fixedPresetId|Aktives festes Preset|Kennung der gewählten festen Regelkombination.
fixedPresetLockEnabled|Preset-Felder sperren|Hält die vom Preset festgelegten Felder gesperrt.
botCount|Bots im Viererspiel|Anzahl der Bots im planaren Viererspiel.
rollBindings|Rolltasten je Spieler|Linke und rechte Rolltaste je Spieler im Viererspiel.
vehicleId|Fahrzeug im Viererspiel|Kennung des Fahrzeugs im planaren Viererspiel.
gamepadVibration|Controller-Vibration|Erlaubt Vibration auf unterstützten Controllern.
graphicsQuality|Grafikqualität|Gewählte Grafikqualitätsstufe.
graphicsStyle|Grafikstil|Gewählter Darstellungsstil.
colorPreset|HUD-Farbprofil|Farbschema der Spielanzeige.
opacity|HUD-Deckkraft|Deckkraft der Spielanzeige.|×
scale|HUD-Größe|Größenfaktor der Spielanzeige.|×
lanHostLocalPlayerCount|Lokale Spieler beim LAN-Host|Anzahl lokaler Spieler beim Hosten eines LAN-Spiels.
lastLocalSessionType|Letzte lokale Sitzungsart|Merkt sich die zuletzt verwendete lokale Sitzungsart.
lastTeamObjective|Letztes Teamziel|Merkt sich das zuletzt verwendete Team-Spielziel.
mapBrightness|Kartenhelligkeit|Darstellungsstufe der Kartenhelligkeit.
menuScale|Menügröße|Größe der Menüoberfläche.|%
tiltAssistMode|Neigungsunterstützung|Unterstützungsart für die mobile Neigungssteuerung.
tiltDebugVisible|Neigungsdiagnose anzeigen|Zeigt die Diagnose der mobilen Neigungssteuerung.
tiltPitchMode|Höhensteuerung durch Neigung|Steuerungsart für mobile Höhenbewegungen.
tiltSensitivity|Neigungsempfindlichkeit|Empfindlichkeit der mobilen Neigungssteuerung.|×
tiltSensorHzVisible|Sensorfrequenz anzeigen|Zeigt die Messfrequenz des Neigungssensors.
mouseSteering|Maussteuerung|Aktiviert die Maussteuerung.
ownerId|Eigentümerkennung|Technische Eigentümerkennung für die Menüverwaltung.
releasePreviewEnabled|Veröffentlichungsvorschau|Aktiviert die vorhandene Vorschau für Veröffentlichungsstände.
seededModePaths|Vorbereitete Spielauswahlen|Interne Liste bereits vorbereiteter Spielauswahlen.
shadowQuality|Schattenqualität|Qualitätsstufe der Schatten.
smoothSteering|Sanfte Lenkung|Aktiviert die vorhandene Lenkglättung.
splitScreenVariant|Geteilte Bildschirmansicht|Variante der lokalen Bildschirmaufteilung.
arcadeGhostDuelMode|Arcade-Geisterduell|Art des Arcade-Geisterduells.
arcadeGhostTrailCollisionEnabled|Geisterspur-Kollision|Schaltet Kollisionen mit der Geisterspur ein oder aus.
mapFilter|Kartenfilter|Gespeicherter Filter der Kartenauswahl.
mapSearch|Kartensuche|Gespeicherter Suchbegriff der Kartenauswahl.
vehicleFilter|Fahrzeugfilter|Gespeicherter Filter der Fahrzeugauswahl.
vehicleSearch|Fahrzeugsuche|Gespeicherter Suchbegriff der Fahrzeugauswahl.
abortCount|Abgebrochene Startvorgänge|Interner Zähler abgebrochener Menü-Startvorgänge.
backtrackCount|Zurück-Navigationen|Interner Zähler der Zurück-Navigationen.
lastEvents|Letzte Menüereignisse|Interne Liste der zuletzt erfassten Menüereignisse.
quickStartCount|Schnellstarts|Interner Zähler der Schnellstarts.
startAttempts|Startversuche|Interner Zähler der Startversuche.
deviceAssignment|Eingabegeräte je Spieler|Gerätekennungen in Spielerreihenfolge für das Dreierspiel.
viewportLayout|Dreier-Bildschirmaufteilung|Anordnung der drei Spielansichten.
activeSection|Aktiver Werkzeugbereich|Zuletzt geöffneter Werkzeugbereich.
level4Open|Erweiterte Einstellungen geöffnet|Merkt sich, ob die erweiterten Einstellungen geöffnet waren.
viewDistance|Sichtweite|Darstellungswert der Sichtweite; 0 verwendet die automatische Auswahl.
`.trim().split('\n').map((line) => { const [key, label, help, unit] = line.split('|'); return [key, { label, help, unit }]; }));

export function fieldPresentation(field, language = 'de') {
    const path = field.path || '';
    const parts = path.split('.');
    const leaf = parts.at(-1);
    const entry = TEXT[leaf];
    const english = leaf.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
    let label = language === 'de' ? entry?.label || english : english;
    if (/^PLAYER_\d+$/.test(leaf)) {
        const n = leaf.split('_')[1];
        const kind = path.includes('.vehicles.') ? ['Fahrzeug', 'vehicle'] : path.includes('.invertPitch.') ? ['Höhensteuerung umkehren', 'invert pitch'] : ['Cockpitkamera', 'cockpit camera'];
        label = language === 'de' ? `Spieler ${n} – ${kind[0]}` : `Player ${n} – ${kind[1]}`;
    }
    if (leaf === 'ALPHA' || leaf === 'BRAVO') label = `${language === 'de' ? 'Bot-Stärke Team' : 'Bot difficulty team'} ${leaf}`;
    label = field.label?.[language] || label;
    const help = language === 'de' ? entry?.help || `Legt „${label}“ für den zugehörigen Spieler- oder Profilbereich fest.`
        : field.help?.en || `Sets ${label.toLowerCase()} for this settings scope. The saved value is used when its owning game flow reads these defaults.`;
    let category = field.category;
    if (path.includes('.arcade.')) category = 'arcade';
    else if (path.includes('.audio.')) category = 'audio';
    else if (path.includes('.hud.')) category = 'hud';
    else if (path.includes('.gameplay.')) category = /trail|gap/.test(leaf) ? 'trails' : /fight|fire|lockOn|mgTrail|item/.test(leaf) ? 'weapons' : 'flight';
    else if (/vehicles|cockpitCamera|invertPitch|threePlayerSplit|fourPlayerPlanar/.test(path)) category = 'players';
    else if (/tilt|mouseSteering|gamepad|smoothSteering/.test(path)) category = 'controls';
    else if (/Quality|graphics|viewDistance|Brightness|menuScale/.test(leaf)) category = 'graphics';
    else if (/telemetry|developer|toolsState|ownerId|actorId|settingsVersion|draftState|seededMode/.test(path)) category = 'technical';
    else if (category === 'base' || category === 'local') category = 'match';
    return { label, help, category, unit: field.unit || entry?.unit || '', english };
}

export const GROUP_LABELS = {
    match: ['Match & Einstieg', 'Match & start'], arcade: ['Arcade & Fortschritt', 'Arcade & progression'],
    trails: ['Spur & Lücken', 'Trails & gaps'], weapons: ['Waffen & Gegenstände', 'Weapons & items'],
    flight: ['Flug & Lenkung', 'Flight & steering'], players: ['Spieler & Fahrzeuge', 'Players & vehicles'],
    audio: ['Klang', 'Audio'], hud: ['Spielanzeige', 'HUD'], graphics: ['Grafik & Darstellung', 'Graphics & appearance'],
    technical: ['Erweitert & Diagnose', 'Advanced & diagnostics'], controls: ['Eingabegeräte', 'Input devices'],
};
export function groupLabel(category, language, fallback) { return GROUP_LABELS[category]?.[language === 'en' ? 1 : 0] || fallback; }

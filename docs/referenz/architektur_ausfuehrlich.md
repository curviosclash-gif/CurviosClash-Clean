# Architektur (Aktiver Einstieg)

Stand: 2026-06-07

Dieses Dokument ist der aktive Einstiegspfad fuer die Architektur.
Es ist ein Kompass und keine zweite Architektur-Wahrheit: Details bleiben in
`docs/referenz/ai_architecture_context.md`, maschinelle Grenzen in
`scripts/architecture/**` und Plan-/Governance-Entscheidungen in den aktiven
VXX-Bloecken.

## Kanonischer Leseweg

Fuer aktuelle Arbeit mit KI-Assistenz zuerst lesen:

1. `docs/referenz/ai_project_onboarding.md`
2. dieses Dokument
3. `docs/referenz/ai_architecture_context.md` nur gezielt fuer den betroffenen
   Scope
4. `docs/Umsetzungsplan.md`

Die detaillierte historische Langfassung liegt unter:

- `docs/archive/architektur_ausfuehrlich.md`

## Architektur-Kompass

- Three.js + Vanilla JavaScript (ES Modules) bleiben die technische Basis.
- Strukturprinzip: Functional Core (`*Ops.js`) plus Imperative Shell
  (Controller/Manager/Adapter).
- `src/shared/contracts/**` ist die seiteneffektfreie Vertragsschicht fuer IDs,
  Payloads, Snapshots, Capability-Descriptoren und Versionen.
- `src/core/**` orchestriert Runtime, Bootstrap, GameLoop und Lifecycle, besitzt
  aber keine UI- oder Plattform-Details als freie Seiteneffekte.
- `src/ui/**` rendert, sammelt Intents und konsumiert read-only Projektionen;
  Runtime-Entscheidungen laufen ueber Contracts, Ports, Commands oder Snapshots.
- `electron/**` und spaeter `src/platform/**` besitzen Desktop-Capabilities wie
  Host, Discovery, Save und Recording. Renderer-Code liest Plattformobjekte nur
  ueber benannte Capability-Vertraege.
- Neue Features erweitern bestehende Contracts/Ports statt direkte
  `game.*`-, `runtimeBundle`-, `runtimeFacade`-, `window.GAME_RUNTIME`-,
  `curviosApp`- oder `getActiveRuntimeConfig`-Pfade zu verbreitern.
- Legacy-Surfaces bleiben nur als explizite Transition-Adapter mit Besitzer,
  Nachfolger und Sunset-Kriterium erlaubt.
- Desktop ist das Hauptprodukt. Browser-Demo- oder Online-Parity entsteht nur
  ueber Surface-Policy-/Capability-Vertraege und darf die Vollversion nicht
  aufweiten.

## Architektur-Startcheck

Vor architekturrelevantem Code-Scope kurz klaeren:

1. Welche Schichten beruehrt der Diff (`core`, `state`, `entities`, `ui`,
   `application`, `platform`, `shared/contracts`)?
2. Entsteht eine neue Dependency-Kante oder nur eine bestehende Kante mit
   gleichem Vertrag?
3. Wird ein Legacy-Surface gelesen, geschrieben oder als neuer Consumer
   eingefuehrt?
4. Gibt es bereits einen passenden Contract, Port, Command, Event oder Snapshot?
5. Welcher Guard belegt die Grenze am kleinsten sinnvoll?

## Maschinenpruefbare Anker

Primaere Guard-Signale:

- `npm run check:architecture:boundaries`
- `npm run check:architecture:touched-strict`
- `npm run check:architecture:ratchet`
- `npm run check:architecture:metrics`
- `npm run architecture:guard` fuer breite Boundary-/Ratchet-Slices

Bei Scope-, Dependency- oder Surface-Fragen zuerst den Knowledge-Graph oder die
Graph-Query-Skripte nutzen; Textdoku erklaert, Guards und Graph machen die
Grenzen operational.


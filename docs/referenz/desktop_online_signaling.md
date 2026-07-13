# Desktop Online Signaling

Stand: 2026-04-15

Diese Referenz definiert den verbindlichen Desktop-Pfad fuer `online` in `V64 64.5.1`.
LAN, `single` und `splitscreen` bleiben davon fachlich getrennt; nur der Online-Transport
benoetigt einen externen Signaling- und optional TURN-Vertrag.

## Konfigurationsvertrag

Der Desktop-Renderer bekommt seine Online-Konfiguration beim App-Build ueber `vite --mode app`.
Quelle dafuer ist `.env.app` plus explizite Shell-Overrides.

| Variable | Pflicht | Bedeutung | Default |
| --- | --- | --- | --- |
| `VITE_SIGNALING_URL` | ja fuer `online` | WebSocket-Endpoint des Online-Signaling-Servers | leer |
| `VITE_TURN_URL` | optional | TURN-Server fuer NAT-Traversal | leer |
| `VITE_TURN_USER` | optional | bevorzugter TURN-Benutzername | leer |
| `VITE_TURN_USERNAME` | optional | Legacy-Alias fuer `VITE_TURN_USER` | leer |
| `VITE_TURN_CREDENTIAL` | optional | TURN-Credential/Passwort | leer |

Verbindliche Regeln:

- `online` ist nur dann produktiv konfiguriert, wenn `VITE_SIGNALING_URL` auf einen erreichbaren `ws://`- oder `wss://`-Endpoint zeigt.
- Fuer verteilte Desktop-Builds und Installer ist `wss://` der erwartete Standard. `ws://localhost:9090` bleibt auf lokale Dev-/Smoke-Sessions beschraenkt.
- Wenn `VITE_TURN_URL` gesetzt wird, muessen Benutzername und Credential zusammen gepflegt werden.
- Ohne TURN bleibt der Desktop-Client auf die eingebauten STUN-Defaults begrenzt; das ist kein Garant fuer Internet-NAT-Kompatibilitaet.

## Override-Strategie

Es gibt genau zwei zulaessige Konfigurationsquellen fuer Desktop-Online:

1. Repo-Baseline in `.env.app` fuer lokale Standard-Builds.
2. Shell- oder CI-Overrides unmittelbar vor `build:app`, `app:start:build` oder `app:package`.

PowerShell-Beispiele:

```powershell
$env:VITE_SIGNALING_URL='ws://localhost:9090'
npm run app:start:build
```

```powershell
$env:VITE_SIGNALING_URL='wss://signal.example.com'
$env:VITE_TURN_URL='turn:turn.example.com:3478?transport=udp'
$env:VITE_TURN_USER='curvios'
$env:VITE_TURN_CREDENTIAL='replace-me'
npm run app:package
```

```powershell
Remove-Item Env:VITE_SIGNALING_URL, Env:VITE_TURN_URL, Env:VITE_TURN_USER, Env:VITE_TURN_CREDENTIAL -ErrorAction SilentlyContinue
```

Nicht vorgesehen:

- Online-Secrets fest im Repo hinterlegen.
- Nachtraegliches Aendern eines bereits gebauten `dist/` oder eines bereits paketierten Installers ohne Neubuild.
- Zweite Desktop-Sonderpfade ausserhalb von `.env.app` plus expliziten Shell-Overrides.

## Packaging-Vertrag

`npm run build:app` liest `.env.app` und die aktuell gesetzten Shell-Variablen und backt diese Werte in den Renderer-Build.
`npm run app:package` paketiert genau diesen App-Build zusammen mit Electron.

Das bedeutet:

- Konfigurationsaenderungen fuer `VITE_SIGNALING_URL` oder TURN erfordern vor einem Release immer einen neuen `npm run build:app`.
- Ein Installer oder Paket darf nur aus einem Build erzeugt werden, dessen Online-Endpoint bewusst fuer die Zielumgebung gesetzt wurde.
- Lokale Entwickler-Smokes duerfen `ws://localhost:9090` verwenden; Release-Artefakte fuer andere Rechner nicht.

## Diagnose-Matrix

| Zustand | Erwartetes Verhalten |
| --- | --- |
| `VITE_SIGNALING_URL` leer | `online` ist nicht produktionsbereit; LAN und Offline bleiben unberuehrt |
| `VITE_SIGNALING_URL` zeigt auf falschen Host | Online-Lobby/Session scheitern am Endpoint |
| TURN nicht gesetzt | Online kann in einfachen Netzen funktionieren, NAT-reiche Netze bleiben riskant |
| TURN unvollstaendig gesetzt | Online ist fehlkonfiguriert und muss vor Packaging korrigiert werden |

## Release-Check fuer Desktop Online

- Ziel-Endpoint (`wss://...`) vor `npm run build:app` gesetzt
- optionale TURN-Werte nur ueber lokale oder CI-Secrets injiziert
- `npm run build:app` erfolgreich
- erst danach `npm run app:package`

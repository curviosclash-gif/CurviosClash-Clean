VITE_APP_MODE=app

# Desktop-Online-Baseline fuer `npm run build:app` und `npm run app:package`.
# Der App-Build liest wegen `--mode app` automatisch diese Datei.
#
# Override-Strategie:
# - repo-default hier pflegen
# - einmalige Abweichung vor dem Build/Packaging per Shell-Env setzen
#   PowerShell:
#   $env:VITE_SIGNALING_URL='wss://signal.example.com'; npm run app:package
# - fuer Remote-Deployments keine Secrets committen; TURN-Credentials lokal/CI injizieren

# Produktiver Online-Signaling-Endpunkt fuer Desktop.
# Lokal darf fuer Smoke/Dev `ws://localhost:9090` genutzt werden,
# fuer verteilte Builds/Installer ist `wss://...` der erwartete Standard.
# VITE_SIGNALING_URL=

# TURN ist optional. Ohne TURN laufen nur die Default-STUN-Server;
# das reicht oft fuer LAN/offene Netze, aber nicht verlaesslich fuer NAT-reiche Internetpfade.
# Wenn `VITE_TURN_URL` gesetzt ist, sollten Username + Credential mitkommen.
# Alias: `VITE_TURN_USER` wird bevorzugt, `VITE_TURN_USERNAME` bleibt kompatibel.
# VITE_TURN_URL=turn:turn.example.com:3478?transport=udp
# VITE_TURN_USER=curvios
# VITE_TURN_CREDENTIAL=replace-me

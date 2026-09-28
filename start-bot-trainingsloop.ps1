# start-bot-trainingsloop.ps1
# Startet den seriellen Heuristik-Suchlauf (npm run bot:improve:auto) bis Ziel, Plateau,
# Zeit- oder Iterationslimit. Der Suchzustand liegt im Temp-Ordner
# (curviosclash-heuristic-improvement-state.json, oder HEURISTIC_LOOP_STATE_PATH);
# nichts wird ins Repository geschrieben und kein Produktwert veraendert.
#
# Aufruf:
#   ./start-bot-trainingsloop.ps1
#   ./start-bot-trainingsloop.ps1 -MaxIterations 6 -TimeoutMinutes 30
#
# Exit-Codes des Laufs: 0 Ziel, 1 Fehler, 2 Zeitlimit, 3 Plateau, 4 Iterationslimit.

param(
    [int]$Bots = 0,
    [int]$MaxIterations = 0,
    [int]$TimeoutMinutes = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root 'dev\training\scripts\heuristic-improvement-runner.mjs'

if (-not (Test-Path -LiteralPath $script)) {
    Write-Error "Suchlauf-Skript nicht gefunden: $script"
    exit 1
}

if ($Bots -gt 0) { $env:HEURISTIC_LOOP_NUM_BOTS = $Bots }
if ($MaxIterations -gt 0) { $env:HEURISTIC_RUNNER_MAX_ITERATIONS = $MaxIterations }
if ($TimeoutMinutes -gt 0) { $env:HEURISTIC_RUNNER_TIMEOUT_MS = $TimeoutMinutes * 60 * 1000 }

Write-Host 'Starte Heuristik-Suchlauf ...' -ForegroundColor Green
node $script
exit $LASTEXITCODE

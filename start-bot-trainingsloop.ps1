# start-bot-trainingsloop.ps1
# Startet den Heuristic-Improvement-Loop und speichert am Ende einen Markdown-Bericht
# unter dev/training/reports/bot-trainingsloop/.
#
# Aufruf:
#   ./start-bot-trainingsloop.ps1
#   ./start-bot-trainingsloop.ps1 -Profiles balanced -Seeds 3,17,41 -Quick
#   ./start-bot-trainingsloop.ps1 -Profiles defensive,balanced,aggressive -Full
#
# Schalter:
#   -Quick      2 Seeds, 1 Pass, 1800 Ticks  (ca. 30s pro Profil)
#   -Medium     4 Seeds, 1 Pass, 2700 Ticks   (ca. 2-5 Min pro Profil)
#   -Full       Defaults (12 Seeds, 3 Paesse, 5400 Ticks)  - Standard

param(
    [string]$Profiles = '',
    [string]$Seeds = '',
    [string]$Passes = '',
    [int]$MaxTicks = 0,
    [int]$NumBots = 0,
    [switch]$Quick,
    [switch]$Medium,
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root 'dev\training\scripts\heuristic-improvement-loop.mjs'

if (-not (Test-Path -LiteralPath $script)) {
    Write-Error "Trainingsloop-Skript nicht gefunden: $script"
    exit 1
}

if ($Profiles) { $env:HEURISTIC_LOOP_PROFILES = $Profiles }
if ($Seeds)    { $env:HEURISTIC_LOOP_SEEDS = $Seeds }
if ($Passes)   { $env:HEURISTIC_LOOP_PASSES = $Passes }
if ($MaxTicks -gt 0) { $env:HEURISTIC_LOOP_MAX_TICKS = $MaxTicks }
if ($NumBots -gt 0)  { $env:HEURISTIC_LOOP_NUM_BOTS = $NumBots }

if ($Quick) {
    $env:HEURISTIC_LOOP_SEEDS    = if ($Seeds) { $Seeds } else { '3,31' }
    $env:HEURISTIC_LOOP_PASSES   = if ($Passes) { $Passes } else { '0.20' }
    $env:HEURISTIC_LOOP_MAX_TICKS = if ($MaxTicks -gt 0) { $MaxTicks } else { '1800' }
    Write-Host 'Modus: QUICK ( Smoke, ~30s pro Profil )' -ForegroundColor Cyan
} elseif ($Medium) {
    $env:HEURISTIC_LOOP_SEEDS    = if ($Seeds) { $Seeds } else { '3,17,41,67' }
    $env:HEURISTIC_LOOP_PASSES   = if ($Passes) { $Passes } else { '0.15,0.07' }
    $env:HEURISTIC_LOOP_MAX_TICKS = if ($MaxTicks -gt 0) { $MaxTicks } else { '2700' }
    Write-Host 'Modus: MEDIUM ( ~2-5 Min pro Profil )' -ForegroundColor Cyan
} else {
    if (-not $Seeds)  { if (-not $env:HEURISTIC_LOOP_SEEDS)    { $env:HEURISTIC_LOOP_SEEDS    = '3,7,11,17,23,31,41,53,67,79,97,113' } }
    if (-not $Passes) { if (-not $env:HEURISTIC_LOOP_PASSES)   { $env:HEURISTIC_LOOP_PASSES   = '0.20,0.10,0.05' } }
    if ($MaxTicks -le 0) { if (-not $env:HEURISTIC_LOOP_MAX_TICKS) { $env:HEURISTIC_LOOP_MAX_TICKS = '5400' } }
    Write-Host 'Modus: FULL ( Standard, ~30-90 Min gesamt )' -ForegroundColor Cyan
}

function Resolve-EnvOrDefault($value, $default) {
    if ($value) { return $value } else { return $default }
}
Write-Host ("Profile : " + (Resolve-EnvOrDefault $env:HEURISTIC_LOOP_PROFILES 'defensive,balanced,aggressive'))
Write-Host ("Seeds   : " + (Resolve-EnvOrDefault $env:HEURISTIC_LOOP_SEEDS ''))
Write-Host ("Passes  : " + (Resolve-EnvOrDefault $env:HEURISTIC_LOOP_PASSES ''))
Write-Host ("MaxTicks: " + (Resolve-EnvOrDefault $env:HEURISTIC_LOOP_MAX_TICKS ''))
Write-Host ("Bots    : " + (Resolve-EnvOrDefault $env:HEURISTIC_LOOP_NUM_BOTS '4'))
Write-Host ''
Write-Host 'Starte Trainingsloop ...' -ForegroundColor Green
Write-Host ''

node $script
$exit = $LASTEXITCODE
if ($exit -ne 0) {
    Write-Error "Trainingsloop endete mit Fehlercode $exit"
    exit $exit
}

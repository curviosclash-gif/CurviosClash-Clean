<#
.SYNOPSIS
  Prueft, ob dieser Rechner als CurviosClash-Testrechner bereit ist. Aendert nichts.

.DESCRIPTION
  Meldet je Punkt OK, WARNUNG oder FEHLER: Konto ohne Adminrechte, angemeldete Sitzung,
  Git, freier Speicher, Grafikkarte und Treiber, Verbindung zu GitHub und ob der Runner
  schon eingerichtet ist und laeuft. Anleitung: scripts/remote-runner/README.md

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\remote-runner\check-remote-machine.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\remote-runner\check-remote-machine.ps1 -ReportPath remote-test\berichte\001-check.json
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\cc-runner',
    [string]$ReportPath = ''
)

$ErrorActionPreference = 'Stop'
$script:failures = 0
$script:warnings = 0
$script:entries = New-Object System.Collections.ArrayList

function Report([string]$Level, [string]$Text) {
    $color = @{ OK = 'Green'; WARNUNG = 'Yellow'; FEHLER = 'Red'; INFO = 'Gray' }[$Level]
    if ($Level -eq 'FEHLER') { $script:failures += 1 }
    if ($Level -eq 'WARNUNG') { $script:warnings += 1 }
    [void]$script:entries.Add([ordered]@{ level = $Level; text = $Text })
    Write-Host ('{0,-8} {1}' -f $Level, $Text) -ForegroundColor $color
}

Write-Host 'CurviosClash Testrechner - Pruefung' -ForegroundColor Cyan
Write-Host ''

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal $identity
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Report 'FEHLER' 'PowerShell laeuft mit Adminrechten. Normal starten, nicht "Als Administrator".'
} else {
    Report 'OK' "Konto $env:USERNAME ohne erhoehte Rechte."
}
$adminGroup = New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'
if ($identity.Groups -contains $adminGroup) {
    Report 'WARNUNG' 'Dieses Konto ist Administrator. Sicherer ist ein eigenes Standardkonto (z. B. ccrunner).'
}
if ($env:USERNAME -match '^[A-Za-z]+\.[A-Za-z]+$' -or $env:USERNAME.Length -gt 12) {
    Report 'INFO' "Der Kontoname '$env:USERNAME' steht in oeffentlichen Testprotokollen. Kein echter Name verwenden."
}
if ((Get-Process -Id $PID).SessionId -eq 0) {
    Report 'FEHLER' 'Keine angemeldete Desktop-Sitzung (Dienst oder Fernsitzung ohne Desktop).'
} else {
    Report 'OK' 'Angemeldete Desktop-Sitzung.'
}
if (-not [Environment]::Is64BitOperatingSystem) { Report 'FEHLER' '64-Bit-Windows noetig.' }

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    Report 'OK' ((& git --version) -join ' ')
} else {
    Report 'FEHLER' 'Git fehlt: https://git-scm.com/download/win installieren.'
}

# Node is only needed for local test runs from a clone; the runner installs its own copy per job.
$nvmrc = Join-Path $PSScriptRoot '..\..\.nvmrc'
$node = Get-Command node -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $nvmrc) {
    $wantedMajor = ((Get-Content -LiteralPath $nvmrc -TotalCount 1).Trim() -replace '^v', '').Split('.')[0]
    if (-not $node) { Report 'INFO' "Node fehlt (nur fuer lokale Testlaeufe noetig, Version $wantedMajor)." }
    else {
        $nodeVersion = (& node --version).Trim()
        if ($nodeVersion -match "^v$wantedMajor\.") { Report 'OK' "Node $nodeVersion passt zu .nvmrc." }
        else { Report 'WARNUNG' "Node $nodeVersion, das Repo erwartet Version $wantedMajor (.nvmrc)." }
    }
}

$drive = Get-PSDrive -Name $InstallDir.Substring(0, 1)
$freeGb = [math]::Round($drive.Free / 1GB, 1)
if ($freeGb -lt 15) { Report 'FEHLER' "Nur $freeGb GB frei auf $($drive.Name):, mindestens 25 GB noetig." }
elseif ($freeGb -lt 25) { Report 'WARNUNG' "$freeGb GB frei auf $($drive.Name):, empfohlen sind 25 GB." }
else { Report 'OK' "$freeGb GB frei auf $($drive.Name):." }

$memoryGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
if ($memoryGb -lt 8) { Report 'WARNUNG' "$memoryGb GB Arbeitsspeicher; 16 GB sind fuer Builds angenehmer." }
else { Report 'OK' "$memoryGb GB Arbeitsspeicher." }

foreach ($gpu in Get-CimInstance Win32_VideoController) {
    $driverDate = if ($gpu.DriverDate) { $gpu.DriverDate.ToString('yyyy-MM-dd') } else { 'unbekannt' }
    $age = if ($gpu.DriverDate) { ((Get-Date) - $gpu.DriverDate).TotalDays } else { 9999 }
    $text = "Grafik: $($gpu.Name), Treiber $($gpu.DriverVersion) vom $driverDate"
    if ($gpu.Name -match 'Basic Display|Basic Render') { Report 'FEHLER' "$text - kein echter Grafiktreiber installiert." }
    elseif ($age -gt 365) { Report 'WARNUNG' "$text - Treiber aelter als ein Jahr." }
    else { Report 'OK' $text }
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Method Head -Uri 'https://github.com' -TimeoutSec 15 | Out-Null
    Report 'OK' 'github.com erreichbar.'
} catch {
    Report 'FEHLER' "github.com nicht erreichbar: $($_.Exception.Message)"
}

if (Test-Path -LiteralPath (Join-Path $InstallDir '.runner')) {
    $listener = Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue
    if ($listener) { Report 'OK' "Runner in $InstallDir eingerichtet und gestartet." }
    else { Report 'WARNUNG' "Runner in $InstallDir eingerichtet, aber nicht gestartet: $InstallDir\run.cmd starten." }
    $shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'CurviosClash Testrechner.lnk'
    if (-not (Test-Path -LiteralPath $shortcut)) { Report 'INFO' 'Kein Autostart fuer dieses Konto angelegt.' }
} else {
    Report 'INFO' "Noch kein Runner in $InstallDir. Naechster Schritt: install-remote-runner.ps1."
}

Report 'INFO' 'Energiesparmodus bitte selbst pruefen: Einstellungen > System > Netzbetrieb und Energiesparen > "Nie".'

if ($ReportPath) {
    $os = Get-CimInstance Win32_OperatingSystem
    $report = [ordered]@{
        checkedAt = (Get-Date).ToString('o')
        ready = ($script:failures -eq 0)
        failures = $script:failures
        warnings = $script:warnings
        machine = [ordered]@{
            os = "$($os.Caption) $($os.Version)"
            cpu = ((Get-CimInstance Win32_Processor | Select-Object -First 1).Name).Trim()
            memoryGb = $memoryGb
            gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) ($($_.DriverVersion))" })
            freeGb = $freeGb
        }
        entries = $script:entries
    }
    $fullPath = if ([IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path (Get-Location) $ReportPath }
    $fullPath = [IO.Path]::GetFullPath($fullPath)
    New-Item -ItemType Directory -Force -Path (Split-Path $fullPath) | Out-Null
    [IO.File]::WriteAllText($fullPath, ($report | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
    Write-Host "Bericht: $fullPath"
}

Write-Host ''
if ($script:failures -gt 0) {
    Write-Host "Nicht bereit: $($script:failures) Fehler, $($script:warnings) Warnungen." -ForegroundColor Red
    exit 1
}
Write-Host "Bereit ($($script:warnings) Warnungen)." -ForegroundColor Green
exit 0

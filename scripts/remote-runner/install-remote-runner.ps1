<#
.SYNOPSIS
  Richtet diesen Rechner als Testrechner fuer CurviosClash ein (GitHub Actions Runner).

.DESCRIPTION
  Laedt den offiziellen GitHub-Runner in einer festen, per SHA256 geprueften Version,
  meldet ihn mit einem einmaligen Token am Repository an und legt auf Wunsch einen
  Autostart an. Der Runner laeuft als normales Programm in der angemeldeten Sitzung,
  nie als Windows-Dienst und nie mit Adminrechten.
  Anleitung: scripts/remote-runner/README.md

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-remote-runner.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-remote-runner.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\cc-runner',
    [string]$RunnerName = 'curvios-remote-1',
    [switch]$NoAutoStart,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# Keep in sync with tests/remote-runner.contract.test.mjs and .github/workflows/remote-desktop.yml.
$RepoUrl = 'https://github.com/curviosclash-gif/CurviosClash-Clean'
$RunnerLabel = 'curvios-remote'
$RunnerVersion = '2.337.0'
$RunnerSha256 = '1150692afa94e71f872017e254ea55b6eece1eece3fe7e3a6d4c93d0a1b85cfc'
$RunnerZipUrl = "https://github.com/actions/runner/releases/download/v$RunnerVersion/actions-runner-win-x64-$RunnerVersion.zip"
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'CurviosClash Testrechner.lnk'

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Stop-WithError([string]$Text) { Write-Host "FEHLER: $Text" -ForegroundColor Red; exit 1 }

function Read-Token([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal $identity
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Stop-WithError 'Bitte NICHT als Administrator starten. Ein normales Benutzerkonto reicht und ist sicherer.'
}
if (-not [Environment]::Is64BitOperatingSystem) { Stop-WithError 'Es wird ein 64-Bit-Windows gebraucht.' }

if ($Uninstall) {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'config.cmd'))) { Stop-WithError "Kein Runner in $InstallDir gefunden." }
    Write-Step 'Runner abmelden'
    $token = Read-Token 'Entfernungs-Token (vom Repository-Besitzer)'
    Push-Location $InstallDir
    try { & .\config.cmd remove --token $token } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'Abmelden fehlgeschlagen. Ist der Token noch gueltig (1 Stunde)?' }
    if (Test-Path -LiteralPath $ShortcutPath) { Remove-Item -LiteralPath $ShortcutPath }
    Write-Host ''
    Write-Host "Fertig. Der Ordner $InstallDir kann jetzt von Hand geloescht werden." -ForegroundColor Green
    exit 0
}

Write-Step 'Voraussetzungen pruefen'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-WithError 'Git fehlt. Bitte Git for Windows installieren (https://git-scm.com/download/win) und das Skript neu starten.'
}
$drive = Get-PSDrive -Name $InstallDir.Substring(0, 1)
if ($drive.Free -lt 25GB) {
    Write-Host ("Warnung: nur {0:N0} GB frei auf {1}:. Empfohlen sind mindestens 25 GB." -f ($drive.Free / 1GB), $drive.Name) -ForegroundColor Yellow
}
if (Test-Path -LiteralPath (Join-Path $InstallDir '.runner')) {
    Stop-WithError "In $InstallDir ist schon ein Runner eingerichtet. Zum Neuaufsetzen erst mit -Uninstall entfernen."
}

Write-Step "Ordner $InstallDir anlegen und nur fuer dieses Konto freigeben"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
# Folders below C:\ inherit "Authenticated Users: Modify"; another local account could then swap run.cmd.
$userSid = $identity.User.Value
& icacls $InstallDir /inheritance:r /grant:r "*${userSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Zugriffsrechte fuer den Ordner konnten nicht gesetzt werden.' }

Write-Step "GitHub-Runner $RunnerVersion herunterladen"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$zipPath = Join-Path $InstallDir "actions-runner-win-x64-$RunnerVersion.zip"
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -UseBasicParsing -Uri $RunnerZipUrl -OutFile $zipPath
$actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $RunnerSha256) {
    Remove-Item -LiteralPath $zipPath
    Stop-WithError "Pruefsumme stimmt nicht (erwartet $RunnerSha256, erhalten $actualHash). Abbruch."
}
Write-Host 'Pruefsumme stimmt.'
Expand-Archive -LiteralPath $zipPath -DestinationPath $InstallDir -Force
Remove-Item -LiteralPath $zipPath

Write-Step 'Runner am Repository anmelden'
Write-Host 'Den Token bekommst du vom Repository-Besitzer. Er gilt eine Stunde und nur zum Anmelden.'
$token = Read-Token 'Anmelde-Token'
if (-not $token) { Stop-WithError 'Kein Token eingegeben.' }
Push-Location $InstallDir
try {
    # Deliberately no service flag: a service has no desktop session, and Electron would not draw there.
    & .\config.cmd --unattended --url $RepoUrl --token $token --name $RunnerName --labels $RunnerLabel --work _work --replace
} finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Anmeldung fehlgeschlagen. Ist der Token richtig und noch gueltig?' }

$runCmd = Join-Path $InstallDir 'run.cmd'
if (-not $NoAutoStart) {
    Write-Step 'Autostart bei der Anmeldung anlegen'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $runCmd
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'CurviosClash Testrechner (GitHub Actions Runner)'
    $shortcut.Save()
}

Write-Step 'Runner starten'
Start-Process -FilePath $runCmd -WorkingDirectory $InstallDir -WindowStyle Minimized
Write-Host ''
Write-Host 'Fertig. Der Testrechner wartet jetzt auf Auftraege.' -ForegroundColor Green
Write-Host 'Das minimierte schwarze Fenster offen lassen. Schliessen = Pause.'
if (-not $NoAutoStart) { Write-Host 'Nach jeder Anmeldung an diesem Konto startet er automatisch.' }

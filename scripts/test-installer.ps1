param(
    [ValidateSet('x64', 'arm64')]
    [string]$Arch = '',
    [string]$Installer = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Arch) {
    $inline = $args | Where-Object { $_ -like '--arch=*' } | Select-Object -First 1
    if ($inline) { $Arch = $inline.Substring('--arch='.Length) }
}
if ($Arch -notin @('x64', 'arm64')) { throw 'Use --arch=x64 or --arch=arm64.' }

$rootPackage = Get-Content -Raw -LiteralPath (Join-Path $PWD 'package.json') | ConvertFrom-Json
if (-not $Installer) {
    $Installer = Join-Path $PWD "release\CurviosClash-Setup-$($rootPackage.version)-$Arch.exe"
}
$sourceInstaller = (Resolve-Path -LiteralPath $Installer).Path
$releaseDirectory = Split-Path $sourceInstaller -Parent
$installerHash = (Get-FileHash -LiteralPath $sourceInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$profilePath = Join-Path $temporaryRoot "curvios-installer-profile-$Arch-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $profilePath | Out-Null
$artifactDirectory = Join-Path $profilePath 'artifact-outside-checkout'
New-Item -ItemType Directory -Path $artifactDirectory | Out-Null
$Installer = Join-Path $artifactDirectory (Split-Path $sourceInstaller -Leaf)
Copy-Item -LiteralPath $sourceInstaller -Destination $Installer
if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $installerHash) {
    throw 'Installer bytes changed while copying outside the checkout.'
}

$process = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "Installer failed with exit $($process.ExitCode)." }

$uninstallKey = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' |
    Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'CurviosClash*' } |
    Select-Object -First 1
if (-not $uninstallKey) { throw 'Registered CurviosClash uninstaller is missing.' }
$uninstallProperties = Get-ItemProperty $uninstallKey.PSPath
$installDirectory = [string]$uninstallProperties.InstallLocation
if (-not $installDirectory) {
    $installDirectory = Split-Path ([string]$uninstallProperties.DisplayIcon).Trim('"') -Parent
}
$executable = Join-Path $installDirectory 'CurviosClash.exe'
foreach ($requiredPath in @(
    $executable,
    (Join-Path $installDirectory 'resources\dist-app\index.html'),
    (Join-Path $installDirectory 'resources\dist-app\hangar.html'),
    (Join-Path $installDirectory 'resources\server\lan-signaling.js'),
    (Join-Path $installDirectory 'resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe')
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Installed resource is missing: $requiredPath" }
}

$machineBytes = [System.IO.File]::ReadAllBytes($executable)
$peOffset = [BitConverter]::ToInt32($machineBytes, 0x3c)
$machine = [BitConverter]::ToUInt16($machineBytes, $peOffset + 4)
$expectedMachine = if ($Arch -eq 'arm64') { 0xAA64 } else { 0x8664 }
if ($machine -ne $expectedMachine) { throw ('Installed PE architecture mismatch: 0x{0:X4}' -f $machine) }

$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'CurviosClash.lnk'
$startMenuShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CurviosClash.lnk'
foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
    if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { throw "Installer shortcut is missing: $shortcut" }
}

node (Join-Path $PSScriptRoot 'test-installed-game.mjs') "--exe=$executable" "--profile=$profilePath" "--arch=$Arch"
if ($LASTEXITCODE -ne 0) { throw 'Installed-product smoke failed.' }

$uninstallCommand = [string]$uninstallProperties.UninstallString
if ($uninstallCommand -match '^"([^"]+)"\s*(.*)$') {
    $uninstaller = $Matches[1]
    $uninstallArguments = "$($Matches[2]) /S".Trim()
} else {
    $commandParts = $uninstallCommand -split '\s+', 2
    $uninstaller = $commandParts[0]
    $uninstallArguments = "$(if ($commandParts.Count -gt 1) { $commandParts[1] }) /S".Trim()
}
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList $uninstallArguments -PassThru -Wait -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed with exit $($uninstall.ExitCode)." }
if (Test-Path -LiteralPath $installDirectory) { throw "Program files remain after uninstall: $installDirectory" }
if (Test-Path -LiteralPath $desktopShortcut) { throw 'Desktop shortcut remains after uninstall.' }
if (Test-Path -LiteralPath $startMenuShortcut) { throw 'Start menu shortcut remains after uninstall.' }
if (Test-Path -LiteralPath $uninstallKey.PSPath) { throw 'Uninstall registry entry remains after uninstall.' }
if (-not (Test-Path -LiteralPath (Join-Path $profilePath 'keep-after-uninstall.txt'))) { throw 'User profile was deleted by uninstall.' }

$proof = [ordered]@{
    schemaVersion = 'curviosclash-installer-proof.v1'
    architecture = $Arch
    installerFile = Split-Path $Installer -Leaf
    installerSha256 = $installerHash
    installedPeMachine = ('0x{0:X4}' -f $machine)
    install = 'ok'
    installedProductSmoke = 'ok'
    uninstall = 'ok'
    profilePreserved = $true
}
$proofPath = Join-Path $releaseDirectory "installer-proof-$Arch.json"
$proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
Write-Output ($proof | ConvertTo-Json -Compress)

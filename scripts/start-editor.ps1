[CmdletBinding()]
param(
    [string]$HostName = "127.0.0.1",
    [ValidateRange(1, 65535)]
    [int]$Port = 5173,
    [ValidateRange(1, 120)]
    [int]$StartupTimeoutSeconds = 30,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$editorUrl = "http://${HostName}:${Port}/editor/map-editor-3d.html"
$viteProcess = $null

function Test-TcpPort {
    param([string]$Address, [int]$TcpPort)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect($Address, $TcpPort, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(300)) {
            return $false
        }
        $client.EndConnect($result)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Test-EditorEndpoint {
    try {
        $request = [System.Net.HttpWebRequest]::Create($editorUrl)
        $request.Timeout = 1000
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try {
                $body = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }
            return $body -match "Curvios Clash 3D Map Editor"
        }
        finally {
            $response.Dispose()
        }
    }
    catch {
        return $false
    }
}

function Open-Editor {
    if (-not $NoBrowser) {
        Start-Process $editorUrl
    }
}

Write-Host "=== CurviosClash - Editor (Entwicklung) ===" -ForegroundColor Cyan
Write-Host "URL: $editorUrl"
Write-Host ""

if (Test-TcpPort -Address $HostName -TcpPort $Port) {
    if (Test-EditorEndpoint) {
        Write-Host "Der Editor-Server laeuft bereits. Es wird kein zweiter Server gestartet." -ForegroundColor Green
        Open-Editor
        exit 0
    }

    Write-Host "FEHLER: Port $Port ist bereits durch einen anderen Dienst belegt." -ForegroundColor Red
    exit 2
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "FEHLER: Node.js wurde nicht gefunden. Benoetigt wird Node.js gemaess .nvmrc." -ForegroundColor Red
    exit 1
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Host "FEHLER: npm wurde nicht gefunden. Bitte Node.js inklusive npm installieren." -ForegroundColor Red
    exit 1
}

Set-Location $root
$vitePath = Join-Path $root "node_modules\vite\bin\vite.js"
if (-not (Test-Path $vitePath -PathType Leaf)) {
    Write-Host "Installiere fehlende Root-Abhaengigkeiten aus package-lock.json..."
    & $npm.Source ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FEHLER: Die Root-Abhaengigkeiten konnten nicht installiert werden." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

try {
    $viteArguments = '"{0}" --host {1} --port {2} --strictPort' -f $vitePath, $HostName, $Port
    $viteProcess = Start-Process `
        -FilePath $node.Source `
        -ArgumentList $viteArguments `
        -WorkingDirectory $root `
        -NoNewWindow `
        -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($viteProcess.HasExited) {
            throw "Der Vite-Server wurde vorzeitig mit Exitcode $($viteProcess.ExitCode) beendet."
        }
        if (Test-EditorEndpoint) {
            Write-Host "Editor-Server ist erreichbar: $editorUrl" -ForegroundColor Green
            Open-Editor
            Write-Host "Zum Beenden dieses Servers Ctrl+C druecken." -ForegroundColor DarkGray
            $viteProcess.WaitForExit()
            exit $viteProcess.ExitCode
        }
        Start-Sleep -Milliseconds 200
    }

    throw "Der Editor-Server war nach $StartupTimeoutSeconds Sekunden nicht erreichbar."
}
catch {
    Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($viteProcess -and -not $viteProcess.HasExited) {
        Stop-Process -Id $viteProcess.Id -Force -ErrorAction SilentlyContinue
    }
}

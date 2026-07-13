@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

if exist "%ROOT%release\win-unpacked\CurviosClash.exe" (
  echo Starte vorhandenes Windows-Paket...
  start "" "%ROOT%release\win-unpacked\CurviosClash.exe"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo FEHLER: Node.js wurde nicht gefunden. Bitte Node.js 24 installieren.
  goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo FEHLER: npm wurde nicht gefunden. Bitte Node.js inklusive npm installieren.
  goto :fail
)

if not exist "%ROOT%node_modules\vite\bin\vite.js" (
  echo Installiere Spiel-Abhaengigkeiten...
  call npm ci
  if errorlevel 1 goto :fail
)

if not exist "%ROOT%electron\node_modules\electron\dist\electron.exe" (
  echo Installiere Desktop-Abhaengigkeiten...
  call npm --prefix electron ci
  if errorlevel 1 goto :fail
)

echo Baue CurviosClash...
call npm run build:app
if errorlevel 1 goto :fail

echo Starte CurviosClash...
call npm --prefix electron run start
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo CurviosClash konnte nicht gestartet werden. Die Fehlermeldung steht oben.
pause
exit /b 1


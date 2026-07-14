@echo off
setlocal

set "ROOT=%~dp0"
set "PACKAGE_EXE=%ROOT%release\win-unpacked\CurviosClash.exe"
cd /d "%ROOT%"
if errorlevel 1 (
    echo FEHLER: Das Repository konnte nicht geoeffnet werden: "%ROOT%"
    exit /b 1
)

call :package_is_valid
if not errorlevel 1 goto :launch_package

echo ==================================================
echo   CurviosClash - fertige Windows-Paketversion
echo ==================================================
echo.
echo Kein gueltiges Paket gefunden. Die Paketversion wird jetzt gebaut.
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo FEHLER: Node.js wurde nicht gefunden. Benoetigt wird Node.js gemaess .nvmrc.
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo FEHLER: npm wurde nicht gefunden. Bitte Node.js inklusive npm installieren.
    exit /b 1
)

if not exist "%ROOT%node_modules\vite\bin\vite.js" goto :install_dependencies
if not exist "%ROOT%electron\node_modules\electron\dist\electron.exe" goto :install_dependencies
if not exist "%ROOT%electron\node_modules\.bin\electron-builder.cmd" goto :install_dependencies
if not exist "%ROOT%electron\node_modules\ffmpeg-static\ffmpeg.exe" goto :install_dependencies
if not exist "%ROOT%server\node_modules\ws\package.json" goto :install_dependencies
goto :build_package

:install_dependencies
echo Installiere fehlende Abhaengigkeiten aus den Lockfiles...
call "%ROOT%install.bat" --no-pause
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" goto :build_package
echo FEHLER: Die Abhaengigkeiten konnten nicht installiert werden.
exit /b %EXIT_CODE%

:build_package
echo Baue die fertige Windows-Paketversion...
call npm run app:package
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" goto :validate_built_package
echo FEHLER: Die Windows-Paketversion konnte nicht gebaut werden.
exit /b %EXIT_CODE%

:validate_built_package
call :package_is_valid
if errorlevel 1 (
    echo FEHLER: Der Build endete ohne ein gueltiges Windows-Paket.
    exit /b 1
)

:launch_package
echo ==================================================
echo   CurviosClash - fertige Windows-Paketversion
echo ==================================================
echo Paket: "%PACKAGE_EXE%"
echo Fuer aktuelle Quellcodeaenderungen start_development.bat verwenden.
echo.

"%PACKAGE_EXE%" %*
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" echo FEHLER: Die Paketversion wurde mit Exitcode %EXIT_CODE% beendet.
exit /b %EXIT_CODE%

:package_is_valid
if not exist "%PACKAGE_EXE%" exit /b 1
if not exist "%ROOT%release\win-unpacked\resources\app.asar" exit /b 1
if not exist "%ROOT%release\win-unpacked\resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe" exit /b 1
if not exist "%ROOT%release\win-unpacked\resources\dist-app\index.html" exit /b 1
if not exist "%ROOT%release\win-unpacked\resources\server\lan-signaling.js" exit /b 1
if not exist "%ROOT%release\win-unpacked\resources\package.json" exit /b 1
exit /b 0

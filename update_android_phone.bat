@echo off
setlocal
cd /d "%~dp0"
npm run android:update:phone -- --watch %*

@echo off
setlocal
cd /d "%~dp0.."
if not defined FORMMORPHEUS_PORT set "FORMMORPHEUS_PORT=9494"
start "formmorpheus backend" cmd /k "%cd%\backend\boot_backend.bat"
start "formmorpheus frontend" cmd /k "%cd%\frontend\boot_frontend.bat"
echo [formmorpheus] frontend http://localhost:5194 and backend http://127.0.0.1:%FORMMORPHEUS_PORT%

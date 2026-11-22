@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%cd%"
if not exist "%ROOT%\frontend\dist\index.html" ( call "%ROOT%\setup\build_frontend.bat" || exit /b 1 )
if not exist "%ROOT%\backend\venv\Scripts\activate.bat" ( echo [formmorpheus] error: backend venv missing, run formmorpheus.bat install 1>&2 & exit /b 1 )
call "%ROOT%\backend\venv\Scripts\activate.bat"
cd /d "%ROOT%\backend"
if not defined FORMMORPHEUS_PORT set "FORMMORPHEUS_PORT=9494"
echo [formmorpheus] serving the built interface on http://127.0.0.1:%FORMMORPHEUS_PORT%
uvicorn app.main:app --timeout-graceful-shutdown 3 --host 127.0.0.1 --port %FORMMORPHEUS_PORT%

@echo off
cd /d "%~dp0"
if not exist venv\Scripts\activate.bat (
  echo [formmorpheus] backend venv missing, run formmorpheus_oc_install.bat
  exit /b 1
)
call venv\Scripts\activate.bat
if "%FORMMORPHEUS_PORT%"=="" set FORMMORPHEUS_PORT=9494
uvicorn app.main:app --reload --host 127.0.0.1 --port %FORMMORPHEUS_PORT%

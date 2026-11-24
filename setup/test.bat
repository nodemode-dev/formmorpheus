@echo off
setlocal
set "LAYER=%~1"
if "%LAYER%"=="" set "LAYER=all"
if /i "%LAYER%"=="interface" goto :interface
if /i "%LAYER%"=="engine" goto :engine
if /i "%LAYER%"=="all" goto :all
echo [formmorpheus] error: unknown layer: %LAYER% (interface, engine, or nothing for both)
exit /b 2

:all
call :interface || exit /b 1
call :engine || exit /b 1
exit /b 0

:interface
echo [formmorpheus] interface tests (vitest)
pushd "%~dp0..\frontend"
call npx vitest run
set "RC=%errorlevel%"
popd
exit /b %RC%

:engine
set "FM_VPY=%~dp0..\backend\venv\Scripts\python.exe"
if not exist "%FM_VPY%" (
  echo [formmorpheus] error: backend venv missing, run formmorpheus.bat install
  exit /b 1
)
"%FM_VPY%" -c "import pytest, httpx" 2>nul || "%FM_VPY%" -m pip install -q -r "%~dp0..\backend\requirements-test.txt" || exit /b 1
echo [formmorpheus] engine tests (pytest)
pushd "%~dp0..\backend"
"%FM_VPY%" -m pytest
set "RC=%errorlevel%"
popd
exit /b %RC%

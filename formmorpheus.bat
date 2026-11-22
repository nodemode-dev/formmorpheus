@echo off
setlocal
cd /d "%~dp0"
set "CMD=%~1"
if "%CMD%"=="" set "CMD=boot"
if /i "%CMD%"=="boot" goto :boot
if /i "%CMD%"=="dev" goto :boot
if /i "%CMD%"=="install" goto :install
if /i "%CMD%"=="install-desktop" goto :install_desktop
if /i "%CMD%"=="backend" goto :backend
if /i "%CMD%"=="frontend" goto :frontend
if /i "%CMD%"=="build" goto :build
if /i "%CMD%"=="serve" goto :serve
if /i "%CMD%"=="freeze" goto :freeze
if /i "%CMD%"=="desktop" goto :desktop
if /i "%CMD%"=="ios" goto :ios
if /i "%CMD%"=="doctor" goto :doctor
if /i "%CMD%"=="lint" goto :lint
if /i "%CMD%"=="clean" goto :clean
if /i "%CMD%"=="version" goto :version
if /i "%CMD%"=="--version" goto :version
if /i "%CMD%"=="-V" goto :version
if /i "%CMD%"=="help" goto :help
if /i "%CMD%"=="-h" goto :help
if /i "%CMD%"=="--help" goto :help
echo [formmorpheus] unknown command: %CMD%
echo.
call :usage
exit /b 2

:boot
call setup\boot_all.bat
exit /b %errorlevel%

:install
call setup\install_all.bat
exit /b %errorlevel%

:install_desktop
call setup\install_desktop.bat
exit /b %errorlevel%

:backend
call backend\boot_backend.bat
exit /b %errorlevel%

:frontend
call frontend\boot_frontend.bat
exit /b %errorlevel%

:build
call setup\build_frontend.bat
exit /b %errorlevel%

:serve
call setup\serve.bat
exit /b %errorlevel%

:freeze
call setup\freeze_backend.bat
exit /b %errorlevel%

:desktop
set "SUB=%~2"
if "%SUB%"=="" set "SUB=dev"
if /i "%SUB%"=="dev" goto :desktop_dev
if /i "%SUB%"=="build" goto :desktop_build
call :usage
exit /b 2

:desktop_dev
shift
shift
call setup\desktop_dev.bat %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%

:desktop_build
shift
shift
call build_app.bat %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%

:ios
echo [formmorpheus] ios builds the iPad app and runs only on macOS; run ./formmorpheus ios on a Mac with Xcode.
exit /b 2

:doctor
call setup\doctor.bat
exit /b %errorlevel%

:lint
call setup\find_python.bat || exit /b 1
%FM_PY% setup\lint_text %2 %3 %4 %5 %6 %7 %8 %9
exit /b %errorlevel%

:clean
call setup\clean.bat %2
exit /b %errorlevel%

:version
call :read_version
set "FMC="
for /f %%c in ('git rev-parse --short HEAD 2^>nul') do set "FMC= (%%c)"
echo formmorpheus %FMV%%FMC%
exit /b 0

:help
call :usage
exit /b 0

:read_version
set "FMV="
for /f "tokens=2 delims='" %%v in ('findstr /b /c:"export const VERSION" frontend\src\version.ts 2^>nul') do set "FMV=%%v"
exit /b 0

:usage
call :read_version
echo formmorpheus %FMV% - animation studio
echo.
echo usage: formmorpheus.bat [command]
echo.
echo   (none) ^| boot       boot backend (9494) and frontend (5194) together
echo   install             install backend and frontend
echo   install-desktop     install the desktop build packages into backend\venv
echo   backend             boot the backend only
echo   frontend            boot the frontend only
echo   build               production build of the frontend into frontend\dist
echo   serve               serve the built frontend from the backend on 127.0.0.1:9494
echo   freeze              freeze the backend into the desktop engine folder src-tauri\engine
echo   desktop dev         run the desktop app against the dev servers
echo   desktop build       build the desktop installers (same as build_app.bat)
echo   ios                 macOS only; on Windows it says so and stops
echo   doctor              check the toolchain, installs and ports
echo   lint                text lint: no em dash, emoji, attribution trailers or banned names
echo   version             the version and build
echo   clean [--all]       remove build output (--all also venv and node_modules)
echo   help                this text
exit /b 0

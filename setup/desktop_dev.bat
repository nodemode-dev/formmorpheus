@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%cd%"
set "TRIPLE="
for /f "tokens=2" %%t in ('rustc -vV 2^>nul ^| findstr /b "host:"') do set "TRIPLE=%%t"
if not defined TRIPLE ( echo [formmorpheus] error: rustc not found; install Rust from https://rustup.rs 1>&2 & exit /b 1 )
if exist "%ROOT%\frontend\node_modules\.bin\tauri.cmd" goto :cli_ready
pushd "%ROOT%\frontend"
call npm ci
if errorlevel 1 ( popd & exit /b 1 )
popd
:cli_ready
if not defined FORMMORPHEUS_DEV_URL goto :engine_check
if not exist "%ROOT%\src-tauri\binaries" mkdir "%ROOT%\src-tauri\binaries"
if not exist "%ROOT%\src-tauri\engine" mkdir "%ROOT%\src-tauri\engine"
if not exist "%ROOT%\src-tauri\binaries\formmorpheus-engine-%TRIPLE%.exe" type nul > "%ROOT%\src-tauri\binaries\formmorpheus-engine-%TRIPLE%.exe"
goto :run
:engine_check
if exist "%ROOT%\src-tauri\engine\formmorpheus-engine.exe" goto :run
call "%ROOT%\setup\freeze_backend.bat" || exit /b 1
:run
cd /d "%ROOT%"
call "%ROOT%\frontend\node_modules\.bin\tauri.cmd" dev %*

@echo off
rem Builds the formmorpheus desktop app on Windows: msi and nsis installers. Output goes to build_app.log too.
rem Signing is optional: set WINDOWS_CERT_THUMBPRINT to sign; leave it unset for an unsigned build.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set LOG=%~dp0build_app.log
echo [formmorpheus] build_app started > "%LOG%"

call :say checking the tools
where node >nul 2>&1 || (call :die Node 20.19 or newer is required & exit /b 1)
where npm >nul 2>&1 || (call :die npm is missing & exit /b 1)
where python >nul 2>&1 || (call :die Python 3.12 or newer is required & exit /b 1)
where cargo >nul 2>&1 || (call :die cargo is missing, install Rust from https://rustup.rs & exit /b 1)

call :say installing dependencies
if not exist backend\venv\Scripts\activate.bat (
  python -m venv backend\venv >> "%LOG%" 2>&1 || (call :die venv failed & exit /b 1)
)
call backend\venv\Scripts\activate.bat
pip install -q -r backend\requirements.txt -r backend\requirements_desktop.txt >> "%LOG%" 2>&1 || (call :die pip install failed & exit /b 1)
pushd frontend
if not exist node_modules call npm install >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die npm install failed & exit /b 1)
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die the frontend build failed & exit /b 1)
popd
if not exist frontend\node_modules\.bin\tauri.cmd (call :die the Tauri command line is missing & exit /b 1)

call :say freezing the engine
for /f "tokens=2" %%t in ('rustc -vV ^| findstr /b "host:"') do set TRIPLE=%%t
if defined FORMMORPHEUS_TARGET set TRIPLE=%FORMMORPHEUS_TARGET%
pushd backend
if exist build\pyinstaller rmdir /s /q build\pyinstaller
if exist dist-engine rmdir /s /q dist-engine
pyinstaller --noconfirm --clean --onefile --name formmorpheus-engine --distpath dist-engine --workpath build\pyinstaller --specpath build\pyinstaller --add-data "%~dp0frontend\dist;frontend_dist" --collect-submodules app --collect-submodules uvicorn --collect-submodules keyring formmorpheus_engine.py >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die freezing the engine failed & exit /b 1)
popd
if not exist src-tauri\binaries mkdir src-tauri\binaries
copy /y backend\dist-engine\formmorpheus-engine.exe "src-tauri\binaries\formmorpheus-engine-%TRIPLE%.exe" >nul
"src-tauri\binaries\formmorpheus-engine-%TRIPLE%.exe" --selfcheck >> "%LOG%" 2>&1
if errorlevel 1 (call :die the frozen engine failed its self check & exit /b 1)

call :say building the desktop app, msi and nsis
set CFG=
if defined WINDOWS_CERT_THUMBPRINT (
  set CFG=--config "{\"bundle\":{\"windows\":{\"certificateThumbprint\":\"%WINDOWS_CERT_THUMBPRINT%\"}}}"
  call :say signing with WINDOWS_CERT_THUMBPRINT
) else (
  call :say no WINDOWS_CERT_THUMBPRINT: unsigned build
)
pushd src-tauri
call ..\frontend\node_modules\.bin\tauri.cmd build --bundles msi,nsis !CFG! >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die tauri build failed, see build_app.log & exit /b 1)
popd

if defined CARGO_TARGET_DIR (set BUNDLE=%CARGO_TARGET_DIR%\release\bundle) else (set BUNDLE=%~dp0src-tauri\target\release\bundle)
call :say done. bundles are in %BUNDLE%
dir /b /s "%BUNDLE%\*.msi" "%BUNDLE%\*.exe" 2>nul | findstr /i "bundle"
exit /b 0

:say
echo [formmorpheus] %*
echo [formmorpheus] %*>> "%LOG%"
exit /b 0

:die
echo [formmorpheus] error: %* 1>&2
echo [formmorpheus] error: %*>> "%LOG%"
exit /b 1

@echo off
rem Builds the formmorpheus desktop app on Windows: msi and nsis installers. Output goes to build_app.log too.
rem Signing is optional: set WINDOWS_CERT_THUMBPRINT to sign; leave it unset for an unsigned build.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "CLEAN=0"
set "BUNDLES=msi,nsis"
set "CONFIG_ARGS="
:args
if "%~1"=="" goto :argsdone
if /i "%~1"=="--clean" ( set "CLEAN=1" & shift & goto :args )
if /i "%~1"=="--bundles" goto :arg_bundles
if /i "%~1"=="--config" goto :arg_config
if /i "%~1"=="-h" ( call :usage & exit /b 0 )
if /i "%~1"=="--help" ( call :usage & exit /b 0 )
call :usage 1>&2
exit /b 2
:arg_bundles
if "%~2"=="" ( call :usage 1>&2 & exit /b 2 )
set "BUNDLES=%~2"
shift
shift
rem cmd splits an unquoted a,b into two arguments, so join the pieces back.
:arg_bundles_more
set "NEXT=%~1"
if not defined NEXT goto :args
if "!NEXT:~0,2!"=="--" goto :args
set "BUNDLES=!BUNDLES!,!NEXT!"
shift
goto :arg_bundles_more
:arg_config
if "%~2"=="" ( call :usage 1>&2 & exit /b 2 )
set "CONFIG_ARGS=!CONFIG_ARGS! --config "%~2""
shift
shift
goto :args
:argsdone
set LOG=%~dp0build_app.log
echo [formmorpheus] build_app started > "%LOG%"

call :say checking the tools
where node >nul 2>&1 || (call :die Node 20.19 or newer is required & exit /b 1)
where npm >nul 2>&1 || (call :die npm is missing & exit /b 1)
call setup\find_python.bat 2>nul || (call :die Python 3.12 or newer is required & exit /b 1)
where cargo >nul 2>&1 || (call :die cargo is missing, install Rust from https://rustup.rs & exit /b 1)

call :say installing dependencies
if not exist backend\venv\Scripts\activate.bat (
  %FM_PY% -m venv backend\venv >> "%LOG%" 2>&1 || (call :die venv failed & exit /b 1)
)
call backend\venv\Scripts\activate.bat
pip install -q -r backend\requirements.txt -r backend\requirements_desktop.txt >> "%LOG%" 2>&1 || (call :die pip install failed & exit /b 1)
if not "%CLEAN%"=="1" goto :cleaned
call :say cleaning earlier builds
pushd src-tauri
cargo clean >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die cargo clean failed & exit /b 1)
popd
if exist backend\build\pyinstaller rmdir /s /q backend\build\pyinstaller
if exist backend\dist-engine rmdir /s /q backend\dist-engine
if exist src-tauri\engine rmdir /s /q src-tauri\engine
del /q src-tauri\binaries\formmorpheus-engine-* 2>nul
:cleaned
pushd frontend
if not exist node_modules call npm ci >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die npm ci failed & exit /b 1)
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die the frontend build failed & exit /b 1)
popd
if not exist frontend\node_modules\.bin\tauri.cmd (call :die the Tauri command line is missing & exit /b 1)

call :say freezing the engine into src-tauri\engine
call setup\freeze_backend.bat >> "%LOG%" 2>&1
if errorlevel 1 (call :die freezing the engine or its self check failed, see build_app.log & exit /b 1)

call :say building the desktop app: %BUNDLES%
set CFG=
set SIGNCMD=
if exist src-tauri\tauri.windows.conf.json findstr /c:"signCommand" src-tauri\tauri.windows.conf.json >nul 2>&1 && set SIGNCMD=1
if defined SIGNCMD (
  call :say signing with the signCommand in tauri.windows.conf.json
) else if defined WINDOWS_CERT_THUMBPRINT (
  set CFG=--config "{\"bundle\":{\"windows\":{\"certificateThumbprint\":\"%WINDOWS_CERT_THUMBPRINT%\"}}}"
  call :say signing with WINDOWS_CERT_THUMBPRINT
) else (
  call :say no WINDOWS_CERT_THUMBPRINT: unsigned build
)
pushd src-tauri
call ..\frontend\node_modules\.bin\tauri.cmd build --bundles !BUNDLES! !CFG! !CONFIG_ARGS! >> "%LOG%" 2>&1
if errorlevel 1 (popd & call :die tauri build failed, see build_app.log & exit /b 1)
popd

if defined CARGO_TARGET_DIR (set BUNDLE=%CARGO_TARGET_DIR%\release\bundle) else (set BUNDLE=%~dp0src-tauri\target\release\bundle)
call :say done. bundles are in %BUNDLE%
dir /b /s "%BUNDLE%\*.msi" "%BUNDLE%\*.exe" 2>nul | findstr /i "bundle"
exit /b 0

:usage
echo build_app.bat              build the formmorpheus desktop app on Windows, start to finish
echo   --clean                  rebuild the Rust side and the frozen engine from nothing
echo   --bundles a,b            override the bundle list (default msi,nsis)
echo   --config X               extra Tauri settings passed on to tauri build, a file path or JSON; may be given more than once
echo Signing is optional: set WINDOWS_CERT_THUMBPRINT for a signed build. Output goes to build_app.log too.
exit /b 0

:say
echo [formmorpheus] %*
echo [formmorpheus] %*>> "%LOG%"
exit /b 0

:die
echo [formmorpheus] error: %* 1>&2
echo [formmorpheus] error: %*>> "%LOG%"
exit /b 1

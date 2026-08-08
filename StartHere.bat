@echo off
rem Audio Edit & Tag - Windows launcher.
rem
rem Double-click this file. It starts the local server, opens your browser at
rem it, and keeps running until you close this window or press Ctrl-C.
rem
rem Everything the app remembers - your tags, presets, sessions and the library
rem path - lives in the "data" folder next to this launcher. It is deliberately
rem NOT inside core\target, because "cargo clean" would delete it.

setlocal
cd /d "%~dp0"
set "AUDIOLAB_DATA=%CD%\data"

rem A shipped binary is preferred; a locally built one is the fallback for
rem anyone working on the source.
set "BIN="
if exist "bin\audiolab.exe" set "BIN=bin\audiolab.exe"
if not defined BIN if exist "core\target\x86_64-pc-windows-gnu\release\audiolab.exe" set "BIN=core\target\x86_64-pc-windows-gnu\release\audiolab.exe"
if not defined BIN if exist "core\target\release\audiolab.exe" set "BIN=core\target\release\audiolab.exe"

if not defined BIN (
  echo.
  echo Could not find audiolab.exe.
  echo.
  echo It should be at bin\audiolab.exe next to this file. If you have the
  echo source and Rust installed, you can build it with:
  echo.
  echo     cargo build --release --manifest-path core\Cargo.toml
  echo.
  pause
  exit /b 1
)

rem First run only: point it at the bundled library so it opens on something
rem rather than an empty picker. Once a library has been chosen it is stored in
rem data\config.json, and passing one on the command line would override it.
set "ARGS=%*"
if not defined ARGS if not exist "data\config.json" if exist "Audio Library" set "ARGS="Audio Library""

"%BIN%" %ARGS%

rem The server has stopped. Hold the window open so any error stays readable.
echo.
echo The Audio Library server has stopped.
pause

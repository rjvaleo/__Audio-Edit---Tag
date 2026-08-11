@echo off
setlocal enabledelayedexpansion
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

rem Whichever binary is NEWER, rather than whichever comes first. Preferring
rem bin/ outright is a quiet trap for anyone working on the source: rebuild,
rem double-click, and the launcher runs a shipped copy from weeks ago while
rem every change you just made appears to have done nothing.
set "BIN="
for %%C in ("bin\audiolab.exe" "core\target\x86_64-pc-windows-gnu\release\audiolab.exe" "core\target\release\audiolab.exe") do (
  if exist %%C (
    if not defined BIN (
      set "BIN=%%~C"
    ) else (
      for %%A in (%%C) do for %%B in ("!BIN!") do (
        if %%~tA GTR %%~tB set "BIN=%%~C"
      )
    )
  )
)

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
rem "\*" rather than the bare name: "if exist" on a plain directory name is
rem unreliable, the wildcard form is not.
if not defined ARGS if not exist "data\config.json" if exist "Audio Library\*" set "ARGS="Audio Library""

"%BIN%" %ARGS%

rem The server has stopped. Hold the window open so any error stays readable.
echo.
echo The Audio Library server has stopped.
pause

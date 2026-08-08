@echo off
setlocal
cd /d "%~dp0app"

set PY=
where python >nul 2>&1 && set PY=python
if not defined PY (where py >nul 2>&1 && set PY=py)
if not defined PY (
  echo.
  echo Python was not found on this PC.
  echo Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup.
  echo.
  pause
  exit /b 1
)

echo Starting the Audio Library browser on http://localhost:8737/
echo Close this window to stop the server.
echo.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start \"\" http://localhost:8737/"
%PY% serve_library.py
pause

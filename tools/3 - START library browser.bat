@echo off
cd /d "%~dp0"
start "" http://localhost:8737/
python serve_library.py || py serve_library.py
pause

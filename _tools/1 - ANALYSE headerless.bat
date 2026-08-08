@echo off
cd /d "%~dp0"
echo Analysing headerless files - writes nothing.
python convert_headerless.py --analyze || py convert_headerless.py --analyze
echo.
echo Review _HEADERLESS-PLAN.tsv in the Audio Library folder, then run "2 - CONVERT headerless.bat"
pause

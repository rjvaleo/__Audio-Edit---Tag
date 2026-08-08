@echo off
cd /d "%~dp0"
echo Inferring specs for headerless files. Writes nothing but a plan.
python convert_headerless.py --analyze || py convert_headerless.py --analyze
echo.
echo Review HEADERLESS-PLAN.tsv, then run CONVERT-headerless.bat
pause

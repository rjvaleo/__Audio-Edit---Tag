@echo off
cd /d "%~dp0"
echo Writing AIFF headers next to each headerless file. Originals are NOT touched.
python convert_headerless.py --convert || py convert_headerless.py --convert
pause

@echo off
cd /d "%~dp0"
echo Writing AIFF headers beside each headerless file. Originals untouched.
python convert_headerless.py --convert || py convert_headerless.py --convert
pause

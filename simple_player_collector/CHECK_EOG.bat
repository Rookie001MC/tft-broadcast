@echo off
cd /d "%~dp0"
python collector.py --once --capture-only
echo.
echo Read the result above. This check only reads REAL LCU and does not upload.
pause

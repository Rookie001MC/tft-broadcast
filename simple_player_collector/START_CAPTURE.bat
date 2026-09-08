@echo off
cd /d "%~dp0"
python collector.py --mode capture
pause

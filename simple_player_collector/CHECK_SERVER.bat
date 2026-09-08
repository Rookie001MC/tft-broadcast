@echo off
cd /d "%~dp0"
python collector.py --check-server
pause

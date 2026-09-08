@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
 echo Install Python 3.10+ and enable Add Python to PATH first.
 pause
 exit /b 1
)
python collector.py --mode relay
pause

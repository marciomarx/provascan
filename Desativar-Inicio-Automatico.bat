@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv-lan\Scripts\pythonw.exe" (
 echo Conclua primeiro a instalacao inicial com Iniciar-ProvaScan-WiFi.bat.
 pause
 exit /b 1
)
start "" ".venv-lan\Scripts\pythonw.exe" "local\launcher.py" --uninstall

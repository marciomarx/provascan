@echo off
setlocal
cd /d "%~dp0"
if not exist "%LOCALAPPDATA%\ProvaScan\certificates\ProvaScan-CA.crt" (
 echo Conclua primeiro a instalacao inicial com Iniciar-ProvaScan-WiFi.bat.
 pause
 exit /b 1
)
if not exist ".venv-lan\Scripts\python.exe" (
 where py >nul 2>&1
 if errorlevel 1 goto :failure
 py -3 -m venv .venv-lan
 if errorlevel 1 goto :failure
)
.venv-lan\Scripts\python.exe -c "import sys; assert sys.version_info[0:2].__ge__((3,12)), 'Instale Python 3.12 ou superior'"
if errorlevel 1 goto :failure
if not exist ".venv-lan\deps-ready" (
 .venv-lan\Scripts\python.exe -m pip install -r local\requirements.txt
 if errorlevel 1 goto :failure
 type nul > .venv-lan\deps-ready
)
start "" ".venv-lan\Scripts\pythonw.exe" "local\launcher.py" --install
exit /b 0
:failure
echo Nao foi possivel preparar o inicio automatico. Envie uma foto desta janela.
pause
exit /b 1

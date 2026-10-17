@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 (
 echo Instale o Python 3.12 ou superior em https://www.python.org/downloads/windows/
 echo Marque a opcao de instalar o Python Launcher. Depois abra este arquivo novamente.
 pause
 exit /b 1
)
if not exist ".venv-lan\Scripts\python.exe" (
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
.venv-lan\Scripts\python.exe local\server.py --cert-only
if errorlevel 1 goto :failure
echo.
echo O ProvaScan usa HTTPS local para permitir a camera do celular.
echo Autorize SOMENTE o certificado criado neste notebook. A chave privada nao deve ser compartilhada.
choice /c SN /m "Confiar no certificado pessoal ProvaScan no Windows?"
if errorlevel 2 goto :end
certutil -user -addstore Root "%LOCALAPPDATA%\ProvaScan\certificates\ProvaScan-CA.crt"
if errorlevel 1 goto :failure
.venv-lan\Scripts\python.exe local\server.py
goto :end
:failure
echo Nao foi possivel iniciar. Envie uma foto desta janela para conferir o erro.
:end
pause
